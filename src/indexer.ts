import assert from "assert";
import * as dotenv from "dotenv";
import _ from "lodash";
import {
  Tendermint34Client,
  Event as BlockEvent,
  BlockResultsResponse,
} from "@cosmjs/tendermint-rpc";

dotenv.config();

const TENDERMINT_RPC_URL = process.env.TENDERMINT_RPC_URL;
assert.ok(TENDERMINT_RPC_URL);
const FETCH_BATCH_SIZE = Number(process.env.FETCH_BATCH_SIZE ?? 100);
assert.ok(!isNaN(FETCH_BATCH_SIZE));

const logBlockEvent = (blockEvent: BlockEvent) => {
  const attributes = blockEvent.attributes;
  const decoder = new TextDecoder();
  for (const attribute of attributes) {
    const key = decoder.decode(attribute.key);
    const value = decoder.decode(attribute.value);
    console.log("Key:", key, "Value:", value);
  }
};

const getSlashEventsForBlockResults = (
  blockResults: BlockResultsResponse,
): BlockEvent[] =>
  blockResults.beginBlockEvents.filter((event) => event.type === "slash");

const getSlashEvents = async (
  client: Tendermint34Client,
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
  client: Tendermint34Client,
  heights: number[],
): Promise<Record<number, BlockEvent[]>> => getSlashEvents(client, heights);

/**
 * Processes blocks from startHeight to endHeight (inclusive).
 */
export const processBlockRange = async (
  client: Tendermint34Client,
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
  client: Tendermint34Client,
  startHeight: number,
  endHeight: number,
  batchSize: number,
): Promise<Record<number, BlockEvent[]>> => {
  const allHeights = _.range(startHeight, endHeight + 1);
  const heightsChunks = _.chunk(allHeights, batchSize);
  const slashEventsWithEmpty = await Promise.all(
    heightsChunks.map((heights) => processBlocks(client, heights)),
  );
  const slashEvents = slashEventsWithEmpty.reduce(
    (acc, curr) => ({ ...acc, ...curr }),
    {},
  );
  return slashEvents;
};

const logSlashEvents = (slashEvents: Record<number, BlockEvent[]>) => {
  const slashHeights = _.sortBy(Object.keys(slashEvents).map(Number));
  slashHeights.forEach((slashHeight: number) => {
    console.log("Slash event(s) at block", slashHeight);
    slashEvents[slashHeight].forEach((slashEvent) => logBlockEvent(slashEvent));
  });
};

const main = async () => {
  const client = await Tendermint34Client.connect(TENDERMINT_RPC_URL);
  const startHeight = 5148552;
  const endHeight = startHeight + 100;
  const slashEvents = await processBlockRangeChunks(
    client,
    startHeight,
    endHeight,
    FETCH_BATCH_SIZE,
  );
  logSlashEvents(slashEvents);
  client.disconnect();
};

main().catch(console.error);
