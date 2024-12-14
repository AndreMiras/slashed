import {
  Event as BlockEvent34,
  TendermintClient,
} from "@cosmjs/tendermint-rpc";
import {
  BlockResultsResponse as BlockResultsResponse37,
  Event as BlockEvent37,
} from "@cosmjs/tendermint-rpc/build/tendermint37/responses";
import assert from "assert";
import _ from "lodash";

import { FETCH_BATCH_SIZE, PROCESS_CHAIN_BATCH_SIZE } from "./config";
import {
  insertSlashEvent,
  selectNullTimestamps,
  updateLatestSynchronizedBlock,
  upsertBlock,
  upsertBlocks,
  upsertValidator,
} from "./database";
import { isBlockResultsResponse34, isBlockResultsResponse37 } from "./events";
import { beginBlockEventsFilter, decodeSlashEvents } from "./events";
import { logDecodeSlashEvents, logSlashEvents } from "./logging";
import { BlockEvent, BlockResultsResponse } from "./types";

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
  if (isBlockResultsResponse34(blockResults)) {
    return (blockResults.beginBlockEvents as BlockEvent34[]).filter(
      beginBlockEventsFilter,
    );
  }
  assert.ok(isBlockResultsResponse37(blockResults));
  return (
    (blockResults as BlockResultsResponse37).beginBlockEvents as BlockEvent37[]
  ).filter(beginBlockEventsFilter);
};

const getSlashEvents = async (
  client: TendermintClient,
  heights: number[],
): Promise<Record<number, BlockEvent[]>> => {
  const promises = heights.map((height) => client.blockResults(height));
  const blockResultsList = await Promise.all(promises);
  const slashEvents = blockResultsList.reduce((slashEvents, blockResults) => {
    const slashEventsForBlockResults =
      getSlashEventsForBlockResults(blockResults);
    const newSlashEvents =
      slashEventsForBlockResults.length > 0
        ? { [blockResults.height]: slashEventsForBlockResults }
        : {};
    return { ...slashEvents, ...newSlashEvents };
  }, {});
  return slashEvents;
};

const processBlocks = (
  client: TendermintClient,
  heights: number[],
): Promise<Record<number, BlockEvent[]>> => getSlashEvents(client, heights);

/**
 * Processes blocks from startHeight to endHeight (inclusive).
 */
export const processBlockRange = async (
  client: TendermintClient,
  startHeight: number,
  endHeight: number,
): Promise<Record<number, BlockEvent[]>> => {
  const heights = _.range(startHeight, endHeight + 1);
  return processBlocks(client, heights);
};

/**
 * Processes blocks from startHeight to endHeight (inclusive) by batchSize chunks.
 */
const processBlockRangeChunks = async (
  client: TendermintClient,
  startHeight: number,
  endHeight: number,
  batchSize: number,
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
    slashEventsWithEmpty.push(await processBlocks(client, heights));
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
  client: TendermintClient,
  height: number,
): Promise<Date> => {
  const blockResponse = await client.block(height);
  return new Date(blockResponse.block.header.time.getTime());
};

/**
 * Add missing timestamps by fetching them using the RPC "block" call.
 */
const processMissingTimestamps = async (
  client: TendermintClient,
  chainId: number,
) => {
  const nullTimestampsRows = await selectNullTimestamps(chainId);
  const promises = nullTimestampsRows.map(async ({ height }) => ({
    chainId,
    time: await getBlockTimestamp(client, height),
    height,
  }));
  const upsertRows = await Promise.all(promises);
  await upsertBlocks(upsertRows);
};

const processChainChunk = async (
  client: TendermintClient,
  chainId: number,
  startHeight: number,
  endHeight: number,
) => {
  console.log("processChainChunk()");
  console.log({ startHeight, endHeight });
  const slashEvents = await processBlockRangeChunks(
    client,
    startHeight,
    endHeight,
    FETCH_BATCH_SIZE,
  );
  logSlashEvents(slashEvents);
  logDecodeSlashEvents(slashEvents);
  await insertSlashEvents(chainId, slashEvents);
  await processMissingTimestamps(client, chainId);
  await updateLatestSynchronizedBlock(chainId, endHeight);
};

/**
 * Process chain blocks from startHeight to endHeight making sure we don't handle more than
 * PROCESS_CHAIN_BATCH_SIZE blocks at a time.
 * This way we know we came full circle from downloading blocks, filtering and saving to DB
 * every PROCESS_CHAIN_BATCH_SIZE blocks at most.
 */
const processChain = async (
  client: TendermintClient,
  chainId: number,
  startHeight: number,
  endHeight: number,
) => {
  let currentStart = startHeight;
  let currentEnd = Math.min(startHeight + PROCESS_CHAIN_BATCH_SIZE, endHeight);
  while (currentStart <= endHeight) {
    await processChainChunk(client, chainId, currentStart, currentEnd);
    currentStart = currentEnd + 1;
    currentEnd = Math.min(currentStart + PROCESS_CHAIN_BATCH_SIZE, endHeight);
  }
};

export { processChain };
