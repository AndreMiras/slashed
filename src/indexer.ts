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

const processBlockResults = (blockResults: BlockResultsResponse) => {
  const beginBlockEvents = blockResults.beginBlockEvents;
  const slashEvents = beginBlockEvents.filter(
    (event) => event.type === "slash",
  );
  if (slashEvents.length !== 0) {
    console.log("Slash event(s) at block", blockResults.height);
    slashEvents.forEach((slashEvent) => logBlockEvent(slashEvent));
  }
};

const processBlocks = async (client: Tendermint34Client, heights: number[]) => {
  const promises = heights.map((height) => client.blockResults(height));
  const blockResultsList = await Promise.all(promises);
  blockResultsList.forEach(processBlockResults);
};

const processBlockRange = async (
  client: Tendermint34Client,
  startHeight: number,
  endHeight: number,
) => {
  const heights = _.range(startHeight, endHeight + 1);
  processBlocks(client, heights);
};

const main = async () => {
  const client = await Tendermint34Client.connect(TENDERMINT_RPC_URL);
  const startHeight = 5148552;
  const endHeight = startHeight + FETCH_BATCH_SIZE;
  processBlockRange(client, startHeight, endHeight);
  client.disconnect();
};

main().catch(console.error);
