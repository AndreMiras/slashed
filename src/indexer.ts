import { Chain } from "@chain-registry/types";
import { TendermintClient } from "@cosmjs/tendermint-rpc";
import assert from "assert";
import { chains } from "chain-registry";
import _ from "lodash";

import { processChain } from "./chain-processor";
import supportedChains from "./chains";
import { getTendermintClient } from "./clients";
import {
  CHAIN_NAME,
  FETCH_BATCH_SIZE,
  PROCESS_CHAIN_BATCH_SIZE,
  TENDERMINT_RPC_URL,
} from "./config";
import {
  getLatestSynchronizedBlock,
  selectChain,
  upsertChains,
  upsertValidators,
} from "./database";
import { CosmosValidator } from "./types";
import {
  handleHttpError,
  operatorAddressToAccount,
  pubKeyToBench32,
  retry,
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
const getEndHeight = async (client: TendermintClient) => {
  const endHeight = Number(process.env.END_HEIGHT);
  if (!isNaN(endHeight)) return endHeight;
  console.log("No valid END_HEIGHT, using latest mined");
  const status = await client.status();
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

const main = async () => {
  const chainName = CHAIN_NAME;
  await upsertChains(supportedChains);
  const { id: chainId } = await selectChain(chainName);
  await syncAddressBook(chainId, chainName);
  const client = await getTendermintClient(TENDERMINT_RPC_URL);
  const startHeight = await getStartHeight(chainId);
  const endHeight = await getEndHeight(client);
  const processChainBatchSize = PROCESS_CHAIN_BATCH_SIZE;
  const fetchBatchSize = FETCH_BATCH_SIZE;
  console.log("main()");
  console.log({ chainName, startHeight, endHeight });
  await processChain(
    client,
    chainId,
    startHeight,
    endHeight,
    processChainBatchSize,
    fetchBatchSize,
  );
  client.disconnect();
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
