import assert from "assert";
import * as dotenv from "dotenv";
import _ from "lodash";
import {
  TendermintClient,
  Tendermint34Client,
  Tendermint37Client,
  Attribute as BlockEventAttribute34,
  BlockResultsResponse as BlockResultsResponse34,
  Event as BlockEvent34,
} from "@cosmjs/tendermint-rpc";
import {
  EventAttribute as BlockEventAttribute37,
  BlockResultsResponse as BlockResultsResponse37,
  Event as BlockEvent37,
} from "@cosmjs/tendermint-rpc/build/tendermint37/responses";
import chains from "./chains";
import { SlashEvent } from "./types";
import {
  selectChain,
  upsertChains,
  getLatestSynchronizedBlock,
  updateLatestSynchronizedBlock,
  insertSlashEvent,
} from "./database";

dotenv.config();

const CHAIN_NAME = process.env.CHAIN_NAME;
assert.ok(CHAIN_NAME);
const TENDERMINT_RPC_URL = process.env.TENDERMINT_RPC_URL;
assert.ok(TENDERMINT_RPC_URL);
const FETCH_BATCH_SIZE = Number(process.env.FETCH_BATCH_SIZE ?? 100);
assert.ok(!isNaN(FETCH_BATCH_SIZE));
const PROCESS_CHAIN_BATCH_SIZE = Number(
  process.env.PROCESS_CHAIN_BATCH_SIZE ?? 100,
);
assert.ok(!isNaN(PROCESS_CHAIN_BATCH_SIZE));

type BlockEvent = BlockEvent34 | BlockEvent37;
type BlockEventAttribute = BlockEventAttribute34 | BlockEventAttribute37;
type BlockResultsResponse = BlockResultsResponse34 | BlockResultsResponse37;

const decodeAttribute = (
  decoder: TextDecoder,
  attribute: BlockEventAttribute,
) => {
  const key =
    attribute.key instanceof Uint8Array
      ? decoder.decode(attribute.key)
      : attribute.key;
  const value =
    attribute.value instanceof Uint8Array
      ? decoder.decode(attribute.value)
      : attribute.value;
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

const beginBlockEventsFilter = (event: BlockEvent) =>
  event.type === "slash" && event.attributes.length >= 3;

const isBlockResultsResponse34 = (
  obj: BlockResultsResponse,
): obj is BlockResultsResponse34 => {
  const attributeKey = obj.beginBlockEvents[0].attributes[0].key;
  // if obj.beginBlockEvents has no events then we are OK with it being any type since we can't
  // go through it anyway
  return (
    obj?.beginBlockEvents !== undefined &&
    (attributeKey === undefined || attributeKey instanceof Uint8Array)
  );
};

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
  return (blockResults.beginBlockEvents as BlockEvent37[]).filter(
    beginBlockEventsFilter,
  );
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
 * The version of the status endpoint can be inconsistent from one client to another.
 * e.g. "v0.34.24", "0.34.28" or "0.37.1"
 */
const cleanVersion = (version: string) => version.replace(/^v/, "");

const getRpcNodeVersion = async (rpcUrl: string): Promise<string> => {
  const url = `${rpcUrl}/status`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Error fetching RPC node version, status: ${response.status}`,
    );
  }
  const data = await response.json();
  return data.result.node_info.version;
};

/**
 * Connects the right Tendermint client version based on the RPC status endpoint
 * And returns the connection object.
 */
const getTendermintClient = async (
  rpcUrl: string,
): Promise<TendermintClient> => {
  const version = cleanVersion(await getRpcNodeVersion(rpcUrl));
  const [major, minor] = version.split(".");
  const majorMinor = `${major}.${minor}`;
  const clients: Record<
    string,
    typeof Tendermint34Client | typeof Tendermint37Client
  > = {
    "0.34": Tendermint34Client,
    "0.37": Tendermint37Client,
  };
  assert.ok(majorMinor in clients);
  return clients[majorMinor].connect(rpcUrl);
};

const main = async () => {
  const chainName = CHAIN_NAME;
  await upsertChains(chains);
  const client = await getTendermintClient(TENDERMINT_RPC_URL);
  const { id: chainId } = await selectChain(chainName);
  const startHeight = await getStartHeight(chainId);
  const endHeight = await getEndHeight(client);
  console.log("main()");
  console.log({ chainName, startHeight, endHeight });
  processChain(client, chainId, startHeight, endHeight);
  client.disconnect();
};

main().catch(console.error);
