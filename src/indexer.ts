import assert from "assert";
import * as dotenv from "dotenv";
import { Tendermint34Client } from "@cosmjs/tendermint-rpc";

dotenv.config();

const TENDERMINT_RPC_URL = process.env.TENDERMINT_RPC_URL;
assert.ok(TENDERMINT_RPC_URL);

const main = async () => {
  console.log("main");
  const client = await Tendermint34Client.connect(TENDERMINT_RPC_URL);
  const height = 5148602;
  const blockResults = await client.blockResults(height);
  console.log("Block results:", blockResults);
  client.disconnect();
};

main().catch(console.error);
