import assert from "assert";
import * as dotenv from "dotenv";
import _ from "lodash";
import {
  Tendermint34Client,
  Event as BlockEvent,
  Attribute as BlockEventAttribute,
  BlockResultsResponse,
} from "@cosmjs/tendermint-rpc";
import { SlashEvent } from "./types";
import { selectChain, insertSlashEvent } from "./database";

dotenv.config();

const CHAIN_NAME = process.env.CHAIN_NAME;
assert.ok(CHAIN_NAME);
const TENDERMINT_RPC_URL = process.env.TENDERMINT_RPC_URL;
assert.ok(TENDERMINT_RPC_URL);
const FETCH_BATCH_SIZE = Number(process.env.FETCH_BATCH_SIZE ?? 100);
assert.ok(!isNaN(FETCH_BATCH_SIZE));

const decodeAttribute = (
  decoder: TextDecoder,
  attribute: BlockEventAttribute,
) => {
  const key = decoder.decode(attribute.key);
  const value = decoder.decode(attribute.value);
  return { key, value };
};

const decodeBlockEvent2Array = (
  blockEvent: BlockEvent,
): Record<string, string>[] => {
  const { attributes } = blockEvent;
  const decoder = new TextDecoder();
  return attributes.map((attribute) => decodeAttribute(decoder, attribute));
};

const decodeBlockEvent2Object = (
  blockEvent: BlockEvent,
): Record<string, string> =>
  _.chain(decodeBlockEvent2Array(blockEvent))
    .keyBy("key")
    .mapValues("value")
    .value();

const logBlockEvent = (blockEvent: BlockEvent) => {
  const attributes = decodeBlockEvent2Array(blockEvent);
  attributes.forEach((attribute) => {
    const { key, value } = attribute;
    console.log("Key:", key, "Value:", value);
  });
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

const logSlashEvents = (slashEvents: Record<number, BlockEvent[]>) => {
  const slashHeights = _.sortBy(Object.keys(slashEvents).map(Number));
  slashHeights.forEach((slashHeight: number) => {
    console.log("Slash event(s) at block", slashHeight);
    slashEvents[slashHeight].forEach((slashEvent) => logBlockEvent(slashEvent));
  });
};

const decodeSlashEvent = (
  slashEvent: BlockEvent,
  slashHeight: number,
): SlashEvent => {
  const decodedSlashEvent = decodeBlockEvent2Object(slashEvent);
  const { address, power: rawPower, reason } = decodedSlashEvent;
  assert.ok(address && rawPower && reason);
  const power = Number(rawPower);
  return { blockHeight: slashHeight, address, power, reason };
};

const decodeSlashEvents = (
  slashEvents: BlockEvent[],
  slashHeight: number,
): SlashEvent[] =>
  slashEvents.map((slashEvent) => decodeSlashEvent(slashEvent, slashHeight));

const logDecodeSlashEvents = (slashEvents: Record<number, BlockEvent[]>) => {
  const slashHeights = _.sortBy(Object.keys(slashEvents).map(Number));
  slashHeights.forEach((slashHeight: number) => {
    console.log("Slash event(s) at block", slashHeight);
    const decodedSlashEvents = decodeSlashEvents(
      slashEvents[slashHeight],
      slashHeight,
    );
    console.log({ decodedSlashEvents });
  });
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
    decodedSlashEvents.forEach((slashEvent) => {
      insertSlashEvent(chainId, slashEvent);
    });
  });
};

const processChain = async (
  chainName: string,
  startHeight: number,
  endHeight: number,
) => {
  const client = await Tendermint34Client.connect(TENDERMINT_RPC_URL);
  const slashEvents = await processBlockRangeChunks(
    client,
    startHeight,
    endHeight,
    FETCH_BATCH_SIZE,
  );
  logSlashEvents(slashEvents);
  logDecodeSlashEvents(slashEvents);
  const { id: chainId } = await selectChain(chainName);
  insertSlashEvents(chainId, slashEvents);
  client.disconnect();
};

const main = async () => {
  const startHeight = 5148552;
  const endHeight = startHeight + 100;
  const chainName = CHAIN_NAME;
  processChain(chainName, startHeight, endHeight);
};

main().catch(console.error);
