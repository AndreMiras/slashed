/**
 * Signing Info Heuristic for finding slash events efficiently.
 *
 * Instead of scanning every block sequentially O(n), this module uses
 * the SigningInfos query to identify jailed validators and binary search
 * for the exact block where they were jailed O(log n).
 *
 * Key insight: The `jailedUntil` field in ValidatorSigningInfo changes
 * when a validator is jailed (or re-jailed). By comparing signing info
 * at different heights, we can detect jail events and binary search
 * for the exact block.
 */
import { CometClient } from "@cosmjs/tendermint-rpc";
import { PageRequest } from "cosmjs-types/cosmos/base/query/v1beta1/pagination";
import {
  QuerySigningInfoRequest,
  QuerySigningInfoResponse,
  QuerySigningInfosRequest,
  QuerySigningInfosResponse,
} from "cosmjs-types/cosmos/slashing/v1beta1/query";
import { ValidatorSigningInfo } from "cosmjs-types/cosmos/slashing/v1beta1/slashing";

import { formatDuration, formatEta } from "./utils";

/**
 * Represents a detected jail event with its estimated block range.
 */
export interface DetectedJailEvent {
  address: string;
  jailedUntil: Date;
  previousJailedUntil: Date | null;
  startHeight: bigint;
  estimatedJailBlock: number | null;
  isReJail: boolean;
}

/**
 * Query signing infos at a specific height using ABCI query.
 */
export const querySigningInfos = async (
  client: CometClient,
  height = 0,
  paginationOffset = 0,
): Promise<QuerySigningInfosResponse> => {
  const path = "/cosmos.slashing.v1beta1.Query/SigningInfos";
  const paginationRequest = PageRequest.fromPartial({
    offset: BigInt(paginationOffset),
  });
  const signingInfoRequest = QuerySigningInfosRequest.fromPartial({
    pagination: paginationRequest,
  });
  const requestData =
    QuerySigningInfosRequest.encode(signingInfoRequest).finish();

  const response = await client.abciQuery({
    path,
    data: requestData,
    prove: false,
    height,
  });

  return QuerySigningInfosResponse.decode(response.value);
};

/**
 * Query all signing infos by paginating through results.
 */
export const queryAllSigningInfos = async (
  client: CometClient,
  height = 0,
): Promise<ValidatorSigningInfo[]> => {
  let allSigningInfos: ValidatorSigningInfo[] = [];
  let signingInfos: ValidatorSigningInfo[] = [];

  do {
    const response = await querySigningInfos(
      client,
      height,
      allSigningInfos.length,
    );
    signingInfos = response.info;
    allSigningInfos = [...allSigningInfos, ...signingInfos];
  } while (signingInfos.length > 0);

  return allSigningInfos;
};

/**
 * Query signing info for a single validator by consensus address at a specific height.
 * More efficient than querySigningInfos() when looking up a specific validator.
 */
export const querySigningInfo = async (
  client: CometClient,
  consAddress: string,
  height = 0,
): Promise<ValidatorSigningInfo | null> => {
  const path = "/cosmos.slashing.v1beta1.Query/SigningInfo";
  const signingInfoRequest = QuerySigningInfoRequest.fromPartial({
    consAddress,
  });
  const requestData =
    QuerySigningInfoRequest.encode(signingInfoRequest).finish();

  try {
    const response = await client.abciQuery({
      path,
      data: requestData,
      prove: false,
      height,
    });

    const decoded = QuerySigningInfoResponse.decode(response.value);
    return decoded.valSigningInfo;
  } catch {
    // Validator not found at this height
    return null;
  }
};

/**
 * Get the jailedUntil timestamp in seconds from a ValidatorSigningInfo.
 */
const getJailedUntilSeconds = (info: ValidatorSigningInfo): number => {
  return Number(info.jailedUntil?.seconds || 0);
};

/**
 * Find a validator by address in a list of signing infos.
 */
const findValidatorByAddress = (
  infos: ValidatorSigningInfo[],
  address: string,
): ValidatorSigningInfo | undefined => {
  return infos.find((info) => info.address === address);
};

/**
 * Binary search to find the exact block where a validator's jailedUntil changed.
 * Uses single-validator query for efficiency (avoids pagination issues).
 * @param onProgress Optional callback for progress updates (iteration, range remaining)
 */
export const binarySearchJailBlock = async (
  client: CometClient,
  address: string,
  lowHeight: number,
  highHeight: number,
  targetJailedUntilSeconds: number,
  onProgress?: (iteration: number, low: number, high: number) => void,
): Promise<number | null> => {
  let iteration = 0;
  while (lowHeight < highHeight) {
    iteration++;
    const midHeight = Math.floor((lowHeight + highHeight) / 2);

    if (onProgress) {
      onProgress(iteration, lowHeight, highHeight);
    }

    // Use single-validator query for efficiency
    const validator = await querySigningInfo(client, address, midHeight);

    if (!validator) {
      return null;
    }

    const jailedSeconds = getJailedUntilSeconds(validator);
    const hasTargetJailDate = jailedSeconds >= targetJailedUntilSeconds;

    if (hasTargetJailDate) {
      highHeight = midHeight;
    } else {
      lowHeight = midHeight + 1;
    }
  }

  return lowHeight;
};

/**
 * Find the earliest height where signing info data is available.
 * Returns null if signing info is available from the earliest block.
 */
export const findSigningInfoStartHeight = async (
  client: CometClient,
  earliestBlockHeight: number,
  latestBlockHeight: number,
): Promise<number> => {
  const startTime = Date.now();
  let lowH = earliestBlockHeight;
  let highH = latestBlockHeight;
  let iteration = 0;
  const initialRange = highH - lowH;

  console.log(
    `[Heuristic] Searching for signing info start height (range: ${lowH.toLocaleString()}-${highH.toLocaleString()})`,
  );

  while (lowH < highH) {
    iteration++;
    const midH = Math.floor((lowH + highH) / 2);
    const currentRange = highH - lowH;
    const progress = Math.round((1 - currentRange / initialRange) * 100);
    const elapsed = Date.now() - startTime;

    // Log every 5 iterations or when significant progress is made
    if (iteration % 5 === 0 || progress >= 90) {
      console.log(
        `[Heuristic]   Binary search iteration ${iteration}: checking height ${midH.toLocaleString()} (${progress}% narrowed, ${formatDuration(
          elapsed,
        )} elapsed)`,
      );
    }

    try {
      const infos = await querySigningInfos(client, midH);
      if (infos.info.length > 0) {
        highH = midH;
      } else {
        lowH = midH + 1;
      }
    } catch {
      lowH = midH + 1;
    }
  }

  const totalTime = Date.now() - startTime;
  console.log(
    `[Heuristic] Found signing info start height: ${lowH.toLocaleString()} (${iteration} iterations, ${formatDuration(
      totalTime,
    )})`,
  );

  return lowH;
};

/**
 * Detect jail events by comparing signing infos at two heights.
 * Returns validators that were jailed (or re-jailed) between the two heights.
 */
export const detectJailEvents = async (
  client: CometClient,
  startHeight: number,
  endHeight: number,
): Promise<DetectedJailEvent[]> => {
  const startTime = Date.now();

  console.log(
    `[Heuristic] Querying signing info at start height ${startHeight.toLocaleString()}...`,
  );
  const startInfos = await queryAllSigningInfos(client, startHeight);
  console.log(
    `[Heuristic]   Found ${startInfos.length} validators at start height`,
  );

  console.log(
    `[Heuristic] Querying signing info at end height ${endHeight.toLocaleString()}...`,
  );
  const endInfos = await queryAllSigningInfos(client, endHeight);
  console.log(
    `[Heuristic]   Found ${endInfos.length} validators at end height`,
  );

  console.log(`[Heuristic] Comparing signing infos to detect jail events...`);

  const detectedEvents: DetectedJailEvent[] = [];

  for (const endValidator of endInfos) {
    const startValidator = findValidatorByAddress(
      startInfos,
      endValidator.address,
    );

    const endJailedSeconds = getJailedUntilSeconds(endValidator);
    const startJailedSeconds = startValidator
      ? getJailedUntilSeconds(startValidator)
      : 0;

    // Check if jailed for first time OR re-jailed with later date
    if (endJailedSeconds > startJailedSeconds) {
      detectedEvents.push({
        address: endValidator.address,
        jailedUntil: new Date(endJailedSeconds * 1000),
        previousJailedUntil:
          startJailedSeconds > 0 ? new Date(startJailedSeconds * 1000) : null,
        startHeight: endValidator.startHeight,
        estimatedJailBlock: null, // To be filled by binary search
        isReJail: startJailedSeconds > 0,
      });
    }
  }

  const totalTime = Date.now() - startTime;
  console.log(
    `[Heuristic] Jail detection complete: ${
      detectedEvents.length
    } events found (${formatDuration(totalTime)})`,
  );

  return detectedEvents;
};

/**
 * Find exact jail blocks for detected jail events using binary search.
 */
export const findExactJailBlocks = async (
  client: CometClient,
  events: DetectedJailEvent[],
  searchStartHeight: number,
  searchEndHeight: number,
): Promise<DetectedJailEvent[]> => {
  const results: DetectedJailEvent[] = [];
  const startTime = Date.now();
  const total = events.length;

  console.log(
    `[Heuristic] Finding exact jail blocks for ${total} validators via binary search...`,
  );

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const targetJailedUntilSeconds = Math.floor(
      event.jailedUntil.getTime() / 1000,
    );

    const elapsed = Date.now() - startTime;
    const progress = Math.round(((i + 1) / total) * 100);
    const eta = i > 0 ? formatEta(elapsed, i, total) : "calculating...";

    console.log(
      `[Heuristic]   Searching validator ${
        i + 1
      }/${total} (${progress}%) - ETA: ${eta}`,
    );
    console.log(
      `[Heuristic]     Address: ${event.address.substring(0, 20)}...`,
    );

    const foundBlock = await binarySearchJailBlock(
      client,
      event.address,
      searchStartHeight,
      searchEndHeight,
      targetJailedUntilSeconds,
      // Log binary search progress for each validator
      (iteration, low, high) => {
        if (iteration % 5 === 0) {
          console.log(
            `[Heuristic]       Binary search iteration ${iteration}: range ${low.toLocaleString()}-${high.toLocaleString()}`,
          );
        }
      },
    );

    if (foundBlock) {
      console.log(
        `[Heuristic]     Found jail block: ${foundBlock.toLocaleString()}`,
      );
    } else {
      console.log(`[Heuristic]     Could not find jail block`);
    }

    results.push({
      ...event,
      estimatedJailBlock: foundBlock,
    });
  }

  const totalTime = Date.now() - startTime;
  const foundCount = results.filter(
    (e) => e.estimatedJailBlock !== null,
  ).length;
  console.log(
    `[Heuristic] Binary search complete: found ${foundCount}/${total} exact blocks (${formatDuration(
      totalTime,
    )})`,
  );

  return results;
};

/**
 * Main heuristic function: Find slash events using signing info.
 *
 * This is O(log n) per validator instead of O(n) for sequential block scanning.
 */
export const findSlashEventsViaSigningInfo = async (
  client: CometClient,
  startHeight: number,
  endHeight: number,
): Promise<DetectedJailEvent[]> => {
  const overallStartTime = Date.now();
  const blockRange = endHeight - startHeight;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`[Heuristic] Starting O(log n) slash detection`);
  console.log(
    `[Heuristic] Block range: ${startHeight.toLocaleString()} - ${endHeight.toLocaleString()} (${blockRange.toLocaleString()} blocks)`,
  );
  console.log(`${"=".repeat(60)}\n`);

  // Step 1: Find signing info data availability boundary
  console.log(`[Heuristic] Step 1/3: Finding signing info availability...`);
  const signingInfoStartHeight = await findSigningInfoStartHeight(
    client,
    startHeight,
    endHeight,
  );

  // Step 2: Detect jail events by comparing start and end signing infos
  console.log(`\n[Heuristic] Step 2/3: Detecting jail events...`);
  const detectedEvents = await detectJailEvents(
    client,
    signingInfoStartHeight,
    endHeight,
  );

  if (detectedEvents.length === 0) {
    const totalTime = Date.now() - overallStartTime;
    console.log(`\n${"=".repeat(60)}`);
    console.log(`[Heuristic] Complete: No jail events detected`);
    console.log(`[Heuristic] Total time: ${formatDuration(totalTime)}`);
    console.log(`${"=".repeat(60)}\n`);
    return [];
  }

  // Step 3: Binary search for exact jail blocks
  console.log(`\n[Heuristic] Step 3/3: Binary searching for exact blocks...`);
  const eventsWithBlocks = await findExactJailBlocks(
    client,
    detectedEvents,
    signingInfoStartHeight,
    endHeight,
  );

  const totalTime = Date.now() - overallStartTime;
  const foundCount = eventsWithBlocks.filter(
    (e) => e.estimatedJailBlock !== null,
  ).length;

  console.log(`\n${"=".repeat(60)}`);
  console.log(
    `[Heuristic] Complete: Found ${foundCount}/${eventsWithBlocks.length} jail events`,
  );
  console.log(`[Heuristic] Total time: ${formatDuration(totalTime)}`);
  console.log(`${"=".repeat(60)}\n`);

  return eventsWithBlocks;
};
