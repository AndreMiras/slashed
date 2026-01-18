import _ from "lodash";

import {
  insertSlashEvent,
  selectNullTimestamps,
  updateLatestSynchronizedBlock,
  upsertBlock,
  upsertBlocks,
  upsertValidator,
} from "./database";
import {
  beginBlockEventsFilter,
  decodeSlashEvents,
  isBlockResultsResponse38,
} from "./events";
import { logDecodeSlashEvents, logSlashEvents } from "./logging";
import {
  BlockEvent,
  BlockResultsResponse,
  BlockResultsResponse37,
  BlockResultsResponse38,
} from "./types";
import { retryWithRotation } from "./utils";

/**
 * Filter for slashing events only.
 * Note that Kujira has a bug where the slashing event is split in 2.
 * One of the 2 events contains 3 attributes: "address", "power" and "reason",
 * but not the "jailed" address.
 * The other one contains only 1 attribute: the "jailed" address.
 * Here we are filtering to keep only the former one that contains more info.
 */
const getSlashEventsForBlockResults = (
  blockResults: BlockResultsResponse,
): BlockEvent[] => {
  // CometBFT 0.38+ uses finalizeBlockEvents instead of beginBlockEvents
  if (isBlockResultsResponse38(blockResults)) {
    return (blockResults as BlockResultsResponse38).finalizeBlockEvents.filter(
      beginBlockEventsFilter,
    );
  }
  // Tendermint 0.37 uses beginBlockEvents
  return (blockResults as BlockResultsResponse37).beginBlockEvents.filter(
    beginBlockEventsFilter,
  );
};

const getSlashEvents = async (
  heights: number[],
  rpcUrls: string[],
): Promise<Record<number, BlockEvent[]>> => {
  const promises = heights.map((height) =>
    retryWithRotation(
      async (client) =>
        client.blockResults(height) as Promise<BlockResultsResponse>,
      rpcUrls,
    ),
  );
  const blockResultsList = await Promise.all(promises);
  const slashEvents = blockResultsList.reduce(
    (slashEventsAcc: Record<number, BlockEvent[]>, blockResults) => {
      const slashEventsForBlockResults =
        getSlashEventsForBlockResults(blockResults);
      const newSlashEvents =
        slashEventsForBlockResults.length > 0
          ? { [blockResults.height]: slashEventsForBlockResults }
          : {};
      return { ...slashEventsAcc, ...newSlashEvents };
    },
    {},
  );
  return slashEvents;
};

const processBlocks = (
  heights: number[],
  rpcUrls: string[],
): Promise<Record<number, BlockEvent[]>> => getSlashEvents(heights, rpcUrls);

/**
 * Processes blocks from startHeight to endHeight (inclusive).
 */
export const processBlockRange = async (
  startHeight: number,
  endHeight: number,
  rpcUrls: string[],
): Promise<Record<number, BlockEvent[]>> => {
  const heights = _.range(startHeight, endHeight + 1);
  return processBlocks(heights, rpcUrls);
};

/**
 * Processes blocks from startHeight to endHeight (inclusive) by batchSize chunks.
 */
const processBlockRangeChunks = async (
  startHeight: number,
  endHeight: number,
  batchSize: number,
  rpcUrls: string[],
): Promise<Record<number, BlockEvent[]>> => {
  const allHeights = _.range(startHeight, endHeight + 1);
  const heightsChunks = _.chunk(allHeights, batchSize);

  const slashEventsWithEmpty = [];
  for (let i = 0; i < heightsChunks.length; i++) {
    const heights = heightsChunks[i];
    const progress = Math.round((100 * (i + 1)) / heightsChunks.length);
    console.log(
      `Processing block chunk ${i + 1}/${heightsChunks.length} (${progress}%)`,
    );
    slashEventsWithEmpty.push(await processBlocks(heights, rpcUrls));
  }
  const slashEvents = slashEventsWithEmpty.reduce(
    (acc, curr) => ({ ...acc, ...curr }),
    {},
  );
  return slashEvents;
};

/**
 * Upserts slash events to the database, ignores duplicates.
 */
const insertSlashEvents = (
  chainId: number,
  slashEvents: Record<number, BlockEvent[]>,
) => {
  const slashHeights = _.sortBy(Object.keys(slashEvents).map(Number));
  slashHeights.forEach((slashHeight: number) => {
    const decodedSlashEvents = decodeSlashEvents(
      slashEvents[slashHeight],
      slashHeight,
    );
    decodedSlashEvents.forEach(async (slashEvent) => {
      await upsertValidator(chainId, slashEvent.address);
      await upsertBlock(chainId, slashEvent.blockHeight);
      await insertSlashEvent(chainId, slashEvent);
    });
  });
};

const getBlockTimestamp = async (
  height: number,
  rpcUrls: string[],
): Promise<Date> => {
  const blockResponse = await retryWithRotation(
    (client) => client.block(height),
    rpcUrls,
  );
  return new Date(blockResponse.block.header.time.getTime());
};

/**
 * Add missing timestamps by fetching them using the RPC "block" call.
 */
const processMissingTimestamps = async (chainId: number, rpcUrls: string[]) => {
  const nullTimestampsRows = await selectNullTimestamps(chainId);
  const promises = nullTimestampsRows.map(async ({ height }) => ({
    chainId,
    time: await getBlockTimestamp(height, rpcUrls),
    height,
  }));
  const upsertRows = await Promise.all(promises);
  await upsertBlocks(upsertRows);
};

const processChainChunk = async (
  chainId: number,
  startHeight: number,
  endHeight: number,
  fetchBatchSize: number,
  rpcUrls: string[],
) => {
  console.log("processChainChunk()");
  console.log({ startHeight, endHeight });
  const slashEvents = await processBlockRangeChunks(
    startHeight,
    endHeight,
    fetchBatchSize,
    rpcUrls,
  );
  logSlashEvents(slashEvents);
  logDecodeSlashEvents(slashEvents);
  await insertSlashEvents(chainId, slashEvents);
  await processMissingTimestamps(chainId, rpcUrls);
  await updateLatestSynchronizedBlock(chainId, endHeight);
};

/**
 * Process chain blocks from startHeight to endHeight making sure we don't handle more than
 * processChainBatchSize blocks at a time.
 * This way we know we came full circle from downloading blocks, filtering and saving to DB
 * every processChainBatchSize blocks at most.
 */
const processChain = async (
  chainId: number,
  startHeight: number,
  endHeight: number,
  processChainBatchSize: number,
  fetchBatchSize: number,
  rpcUrls: string[],
) => {
  let currentStart = startHeight;
  let currentEnd = Math.min(startHeight + processChainBatchSize, endHeight);
  while (currentStart <= endHeight) {
    await processChainChunk(
      chainId,
      currentStart,
      currentEnd,
      fetchBatchSize,
      rpcUrls,
    );
    currentStart = currentEnd + 1;
    currentEnd = Math.min(currentStart + processChainBatchSize, endHeight);
  }
};

export { insertSlashEvents, processChain, processMissingTimestamps };
