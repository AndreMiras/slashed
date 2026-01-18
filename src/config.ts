/**
 * Environment variable parsing and default settings (e.g., CHAIN_NAME, FETCH_BATCH_SIZE).
 */
import assert from "assert";
import * as dotenv from "dotenv";

import { getEnvVariable } from "./utils";

dotenv.config();

const CHAIN_NAME = getEnvVariable("CHAIN_NAME");
const TENDERMINT_RPC_URL = getEnvVariable("TENDERMINT_RPC_URL");

/**
 * Parse RPC URLs from environment variable.
 * Supports both single URL and comma-separated list.
 */
const parseRpcUrls = (envValue: string): string[] => {
  return envValue
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
};

const TENDERMINT_RPC_URLS = parseRpcUrls(TENDERMINT_RPC_URL);
const FETCH_BATCH_SIZE = Number(process.env.FETCH_BATCH_SIZE ?? 100);
assert.ok(!isNaN(FETCH_BATCH_SIZE));
const PROCESS_CHAIN_BATCH_SIZE = Number(
  process.env.PROCESS_CHAIN_BATCH_SIZE ?? 100,
);
assert.ok(!isNaN(PROCESS_CHAIN_BATCH_SIZE));

export {
  CHAIN_NAME,
  FETCH_BATCH_SIZE,
  parseRpcUrls,
  PROCESS_CHAIN_BATCH_SIZE,
  TENDERMINT_RPC_URL,
  TENDERMINT_RPC_URLS,
};
