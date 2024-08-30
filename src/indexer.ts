import assert from "assert";
import * as dotenv from "dotenv";
import _ from "lodash";
import { chains } from "chain-registry";
import { Chain } from "@chain-registry/types";
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
import supportedChains from "./chains";
import { SlashEvent, CosmosValidator } from "./types";
import {
  getEnvVariable,
  handleHttpError,
  retry,
  pubKeyToBench32,
  operatorAddressToAccount,
} from "./utils";
import {
  selectChain,
  upsertChains,
  getLatestSynchronizedBlock,
  updateLatestSynchronizedBlock,
  upsertBlocks,
  upsertBlock,
  insertSlashEvent,
  upsertValidators,
  upsertValidator,
  selectNullTimestamps,
} from "./database";

dotenv.config();

const CHAIN_NAME = getEnvVariable("CHAIN_NAME");
const TENDERMINT_RPC_URL = getEnvVariable("TENDERMINT_RPC_URL");
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
  const attributeKey = obj.beginBlockEvents[0]?.attributes[0]?.key;
  // if obj.beginBlockEvents has no events then we are OK with it being any type since we can't
  // go through it anyway
  return (
    obj?.beginBlockEvents !== undefined &&
    (attributeKey === undefined || attributeKey instanceof Uint8Array)
  );
};

const isBlockResultsResponse37 = (
  obj: BlockResultsResponse,
): obj is BlockResultsResponse37 =>
  typeof obj.beginBlockEvents[0]?.attributes[0]?.key === "string";

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

const getChainRestUrl = (chainName: string): string => {
  const chainInfo = getChainInfo(chainAlias(chainName));
  const restList = chainInfo?.apis?.rest || [];
  assert.ok(restList.length > 0, `No REST for this chain (${chainName})`);
  const rest = _.sample(restList);
  return rest!.address;
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
  const validators = await retry(
    () => fetchAllValidators(getChainRestUrl(chainName)),
    retryCount,
  );
  const validatorsRows = validators.map(
    ({ operator_address, consensus_pubkey, description }) => ({
      chainId,
      moniker: description.moniker,
      account: operatorAddressToAccount(operator_address),
      valoper: operator_address,
      valcons: validatorValcons(prefix, consensus_pubkey.key),
      consensusPubkey: consensus_pubkey.key,
    }),
  );
  await upsertValidators(validatorsRows);
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
  const [major, minor] = version.split(".").map(Number);
  const majorMinor = parseFloat(`${major}.${minor}`);
  const ClientClass =
    majorMinor < 0.37 ? Tendermint34Client : Tendermint37Client;
  return ClientClass.connect(rpcUrl);
};

const main = async () => {
  const chainName = CHAIN_NAME;
  await upsertChains(supportedChains);
  const { id: chainId } = await selectChain(chainName);
  await syncAddressBook(chainId, chainName);
  const client = await getTendermintClient(TENDERMINT_RPC_URL);
  const startHeight = await getStartHeight(chainId);
  const endHeight = await getEndHeight(client);
  console.log("main()");
  console.log({ chainName, startHeight, endHeight });
  await processChain(client, chainId, startHeight, endHeight);
  client.disconnect();
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
