import { Chain } from "@chain-registry/types";
import { CometClient } from "@cosmjs/tendermint-rpc";
import assert from "assert";
import { chains } from "chain-registry";
import _ from "lodash";

import {
  insertSlashEvents,
  processBlockRange,
  processChain,
  processMissingTimestamps,
} from "./chain-processor";
import supportedChains from "./chains";
import {
  CHAIN_NAME,
  FETCH_BATCH_SIZE,
  PROCESS_CHAIN_BATCH_SIZE,
  TENDERMINT_RPC_URLS,
} from "./config";
import {
  getLatestSynchronizedBlock,
  selectChain,
  updateLatestSynchronizedBlock,
  upsertChains,
  upsertValidators,
} from "./database";
import { logDecodeSlashEvents, logSlashEvents } from "./logging";
import {
  findSlashEventsViaSigningInfo,
  queryAllSigningInfos,
} from "./signing-info-heuristic";
import { BlockEvent, CosmosValidator } from "./types";
import {
  formatDuration,
  formatEta,
  handleHttpError,
  operatorAddressToAccount,
  pubKeyToBench32,
  retry,
  retryWithRotation,
} from "./utils";

/**
 * Returns START_HEIGHT environment variable or defaults to DB latest synchronized block.
 */
const getStartHeight = async (chainId: number): Promise<number> => {
  const startHeight = Number(process.env.START_HEIGHT);
  if (!isNaN(startHeight)) return startHeight;
  console.log("No valid START_HEIGHT, using DB latest synchronized");
  return getLatestSynchronizedBlock(chainId);
};

/**
 * Returns END_HEIGHT environment variable or defaults to latest mined block.
 */
const getEndHeight = async (rpcUrls: string[]): Promise<number> => {
  const endHeight = Number(process.env.END_HEIGHT);
  if (!isNaN(endHeight)) return endHeight;
  console.log("No valid END_HEIGHT, using latest mined");
  const status = await retryWithRotation(
    (client: CometClient) => client.status(),
    rpcUrls,
  );
  return status.syncInfo.latestBlockHeight;
};

/**
 * Maps our application chain name to the chain-registry one.
 */
const chainAlias = (chainName: string): string =>
  ({
    gravity: "gravitybridge",
  })[chainName] || chainName;

const getChainInfo = (chainName: string): Chain | undefined =>
  chains.find(({ chain_name }) => chain_name === chainName);

/**
 * Checks if the given REST URL is healthy by hitting the node_info endpoint.
 */
const isRestUrlHealthy = async (restUrl: string): Promise<boolean> => {
  try {
    const response = await fetch(
      `${restUrl}/cosmos/base/tendermint/v1beta1/node_info`,
    );
    return response.ok;
  } catch {
    return false;
  }
};

/**
 * Filters and returns only the healthy REST URLs from the given list.
 */
const getHealthyRestUrls = async (restUrls: string[]): Promise<string[]> => {
  const healthChecks = restUrls.map(async (url) =>
    (await isRestUrlHealthy(url)) ? url : null,
  );
  const results = await Promise.all(healthChecks);
  return results.filter((url): url is string => url !== null);
};

/**
 * Returns a healthy REST URL for the given chain or fails if none found.
 */
const getChainRestUrl = async (chainName: string): Promise<string> => {
  const chainInfo = getChainInfo(chainAlias(chainName));
  const restList = chainInfo?.apis?.rest || [];
  const restUrls = restList.map(({ address }) => address);
  const healthyRestUrls = await getHealthyRestUrls(restUrls);
  assert.ok(
    healthyRestUrls.length > 0,
    `No healthy REST for this chain (${chainName})`,
  );
  const restUrl = _.sample(healthyRestUrls);
  return restUrl!;
};

/**
 * Fetches validators metadata (moniker, consensus pubkey, operator address...).
 */
const fetchValidators = async (restUrl: string, paginationOffset = 0) => {
  const params = new URLSearchParams({
    "pagination.offset": paginationOffset.toString(),
  });
  const url = `${restUrl}/cosmos/staking/v1beta1/validators?${params.toString()}`;
  const response = await fetch(url);
  handleHttpError(response);
  const { validators } = await response.json();
  return validators;
};

const fetchAllValidators = async (
  restUrl: string,
): Promise<CosmosValidator[]> => {
  let allValidators: CosmosValidator[] = [];
  let validators = [];
  do {
    validators = await fetchValidators(restUrl, allValidators.length);
    allValidators = [...allValidators, ...validators];
  } while (validators.length > 0);
  return allValidators;
};

/**
 * Returns the validator consensus address from the prefix and consensus public key.
 */
const validatorValcons = (prefix: string, consensusPubkey: string): string =>
  pubKeyToBench32(`${prefix}valcons`, consensusPubkey);

/**
 * Fetches and stores validators addresses.
 * - moniker
 * - consensus public key
 * - account address
 * - valoper address
 * - valcons address
 */
const syncAddressBook = async (chainId: number, chainName: string) => {
  const chainInfo = getChainInfo(chainAlias(chainName));
  assert.ok(chainInfo, `Chain not found in the registry (${chainName})`);
  const prefix = chainInfo!.bech32_prefix;
  const retryCount = 5;
  const restUrl = await getChainRestUrl(chainName);
  const validators = await retry(() => fetchAllValidators(restUrl), retryCount);
  const validatorsRows = validators.map(
    ({ operator_address, consensus_pubkey, description }) => ({
      chainId,
      moniker: description.moniker,
      account: operatorAddressToAccount(operator_address),
      valoper: operator_address,
      valcons: validatorValcons(prefix ?? "", consensus_pubkey.key),
      consensusPubkey: consensus_pubkey.key,
    }),
  );
  await upsertValidators(validatorsRows);
};

/**
 * Store and log a single batch of slash events immediately.
 */
const storeVerifiedEvents = async (
  chainId: number,
  slashEvents: Record<number, BlockEvent[]>,
  rpcUrls: string[],
): Promise<void> => {
  if (Object.keys(slashEvents).length === 0) return;

  logSlashEvents(slashEvents);
  logDecodeSlashEvents(slashEvents);
  await insertSlashEvents(chainId, slashEvents);
  await processMissingTimestamps(chainId, rpcUrls);
};

/**
 * Use signing info heuristic to find slash events, then verify and store them.
 * Events are stored incrementally as they're verified for resilience.
 * This is O(log n) per slash event instead of O(n) for sequential scanning.
 */
const processChainWithHeuristic = async (
  chainId: number,
  startHeight: number,
  endHeight: number,
  rpcUrls: string[],
): Promise<number> => {
  // Step 1: Find slash events using signing info heuristic
  const detectedEvents = await findSlashEventsViaSigningInfo(
    rpcUrls,
    startHeight,
    endHeight,
  );

  if (detectedEvents.length === 0) {
    // No events found, but still update sync status to mark range as processed
    console.log(`[Heuristic] Updating sync status to height ${endHeight}...`);
    await updateLatestSynchronizedBlock(chainId, endHeight);
    return 0;
  }

  // Step 2: Get the unique blocks that need verification, sorted by height
  const slashBlocks = detectedEvents
    .filter((e) => e.estimatedJailBlock !== null)
    .map((e) => e.estimatedJailBlock as number)
    .sort((a, b) => a - b);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`[Verification] Starting block verification phase`);
  console.log(
    `[Verification] ${slashBlocks.length} potential slash blocks to verify`,
  );
  console.log(
    `[Verification] Storing events incrementally as they're verified`,
  );
  console.log(`${"=".repeat(60)}\n`);

  // Step 3: Verify each detected slash and store immediately
  const verifyStartTime = Date.now();
  let confirmedCount = 0;
  let storedCount = 0;
  const total = slashBlocks.length;
  let highestVerifiedBlock = startHeight;

  for (let i = 0; i < slashBlocks.length; i++) {
    const slashBlock = slashBlocks[i];
    const elapsed = Date.now() - verifyStartTime;
    const progress = Math.round(((i + 1) / total) * 100);
    const eta = i > 0 ? formatEta(elapsed, i, total) : "calculating...";

    console.log(
      `[Verification] Verifying block ${
        i + 1
      }/${total} (${progress}%) - ETA: ${eta}`,
    );
    console.log(
      `[Verification]   Block height: ${slashBlock.toLocaleString()}`,
    );

    // Fetch block results to confirm slash event
    let confirmedEvents: Record<number, BlockEvent[]> = {};
    const slashEvents = await processBlockRange(
      slashBlock,
      slashBlock,
      rpcUrls,
    );

    if (Object.keys(slashEvents).length > 0) {
      console.log(
        `[Verification]   ✓ Confirmed slash event at block ${slashBlock.toLocaleString()}`,
      );
      confirmedCount++;
      confirmedEvents = slashEvents;
    } else {
      console.log(
        `[Verification]   Block ${slashBlock.toLocaleString()} empty, checking adjacent blocks...`,
      );
      // Try adjacent blocks in case binary search is slightly off
      const adjacentEvents = await processBlockRange(
        slashBlock - 2,
        slashBlock + 2,
        rpcUrls,
      );
      if (Object.keys(adjacentEvents).length > 0) {
        const foundBlocks = Object.keys(adjacentEvents).join(", ");
        console.log(
          `[Verification]   ✓ Found slash event in adjacent blocks: ${foundBlocks}`,
        );
        confirmedCount++;
        confirmedEvents = adjacentEvents;
      } else {
        console.log(
          `[Verification]   ✗ No slash event found in range ${slashBlock - 2}-${
            slashBlock + 2
          }`,
        );
      }
    }

    // Store confirmed events immediately
    if (Object.keys(confirmedEvents).length > 0) {
      await storeVerifiedEvents(chainId, confirmedEvents, rpcUrls);
      storedCount += Object.keys(confirmedEvents).length;
      console.log(
        `[Verification]   📦 Stored to DB (total: ${storedCount} blocks with events)`,
      );
    }

    // Track highest verified block for progress
    highestVerifiedBlock = Math.max(highestVerifiedBlock, slashBlock + 2);

    // Update sync status periodically (every 10 verifications or at the end)
    if ((i + 1) % 10 === 0 || i === slashBlocks.length - 1) {
      await updateLatestSynchronizedBlock(chainId, highestVerifiedBlock);
      console.log(
        `[Verification]   💾 Progress saved (synced to block ${highestVerifiedBlock.toLocaleString()})`,
      );
    }
  }

  const totalTime = Date.now() - verifyStartTime;
  console.log(`\n${"=".repeat(60)}`);
  console.log(
    `[Verification] Complete: ${confirmedCount}/${total} slash events confirmed`,
  );
  console.log(`[Verification] Stored ${storedCount} blocks with slash events`);
  console.log(`[Verification] Verification time: ${formatDuration(totalTime)}`);
  console.log(`${"=".repeat(60)}\n`);

  // Final sync status update to endHeight
  console.log(`[Database] Updating sync status to height ${endHeight}...`);
  await updateLatestSynchronizedBlock(chainId, endHeight);
  console.log(`[Database] Sync status updated`);

  return confirmedCount;
};

const main = async () => {
  const chainName = CHAIN_NAME;
  const rpcUrls = TENDERMINT_RPC_URLS;

  await upsertChains(supportedChains);
  const { id: chainId } = await selectChain(chainName);
  await syncAddressBook(chainId, chainName);

  const startHeight = await getStartHeight(chainId);
  const endHeight = await getEndHeight(rpcUrls);
  const processChainBatchSize = PROCESS_CHAIN_BATCH_SIZE;
  const fetchBatchSize = FETCH_BATCH_SIZE;

  // Check if USE_HEURISTIC env var is set
  const useHeuristic = process.env.USE_HEURISTIC !== "false";

  console.log("main()");
  console.log({ chainName, startHeight, endHeight, useHeuristic });

  if (useHeuristic) {
    // Use heuristic approach: O(log n) signing info-based detection
    await processChainWithHeuristic(chainId, startHeight, endHeight, rpcUrls);
  } else {
    // Use traditional sequential scan: O(n) block-by-block
    await processChain(
      chainId,
      startHeight,
      endHeight,
      processChainBatchSize,
      fetchBatchSize,
      rpcUrls,
    );
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { main, processChainWithHeuristic, queryAllSigningInfos };
