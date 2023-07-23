import assert from "assert";
import * as dotenv from "dotenv";
import {
  Tendermint34Client,
  Event as BlockEvent,
} from "@cosmjs/tendermint-rpc";

dotenv.config();

const TENDERMINT_RPC_URL = process.env.TENDERMINT_RPC_URL;
assert.ok(TENDERMINT_RPC_URL);

const logBlockEvent = (blockEvent: BlockEvent) => {
  const attributes = blockEvent.attributes;
  const decoder = new TextDecoder();
  for (const attribute of attributes) {
    const key = decoder.decode(attribute.key);
    const value = decoder.decode(attribute.value);
    console.log("Key:", key, "Value:", value);
  }
};

const main = async () => {
  console.log("main");
  const client = await Tendermint34Client.connect(TENDERMINT_RPC_URL);
  const height = 5148602;
  const blockResults = await client.blockResults(height);
  const beginBlockEvents = blockResults.beginBlockEvents;
  const slashEvents = beginBlockEvents.filter(
    (event) => event.type === "slash",
  );
  if (slashEvents.length !== 0) {
    console.log("Slash event(s) at block", height);
    slashEvents.forEach((slashEvent) => logBlockEvent(slashEvent));
  }
  client.disconnect();
};

main().catch(console.error);
