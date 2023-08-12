import assert from "assert";
import * as dotenv from "dotenv";
import { PostgrestError, createClient } from "@supabase/supabase-js";
import { Database } from "./supabase/database.types";
import { SlashEvent } from "./types";

dotenv.config();

const getSupabaseClient = () => {
  const { SUPABASE_PROJECT_ID, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } =
    process.env;
  assert.ok(SUPABASE_PROJECT_ID || SUPABASE_URL);
  assert.ok(SUPABASE_SERVICE_ROLE_KEY);
  const supabaseUrl =
    SUPABASE_URL ?? `https://${SUPABASE_PROJECT_ID}.supabase.co`;
  return createClient<Database>(supabaseUrl, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
};

const handlePostgrestError = (error: PostgrestError | null) => {
  if (error === null) return;
  console.error(error);
  throw new Error(error.message);
};

const selectChain = async (name: string) => {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("chains")
    .select("*")
    .eq("name", name)
    .limit(1)
    .single();
  handlePostgrestError(error);
  return data!;
};

/**
 * Upserts chains, ignores duplicates.
 */
const upsertChains = async (chainNames: string[]) => {
  const supabase = getSupabaseClient();
  const rows = chainNames.map((chainName) => ({
    name: chainName,
  }));
  const { error } = await supabase.from("chains").upsert(rows, {
    onConflict: "name",
    ignoreDuplicates: true,
  });
  handlePostgrestError(error);
};

/**
 * Upserts chain, ignores duplicates.
 */
const upsertChain = async (chainName: string) => upsertChains([chainName]);

/**
 * Returns the latest known synchronized block or 1 if none.
 */
const getLatestSynchronizedBlock = async (chainId: number): Promise<number> => {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("sync_statuses")
    .select("*")
    .eq("chain_id", chainId)
    .single();
  try {
    handlePostgrestError(error);
  } catch {
    // most likely no record found (error code PGRST116)
    return 1;
  }
  return data!.block_height;
};

/**
 * Updates the latest known synchronized block.
 * Creates the record if it doesn't exist.
 */
const updateLatestSynchronizedBlock = async (
  chainId: number,
  blockHeight: number,
) => {
  const supabase = getSupabaseClient();
  const row = {
    chain_id: chainId,
    block_height: blockHeight,
  };
  const { error } = await supabase.from("sync_statuses").upsert(row, {
    onConflict: "chain_id",
    ignoreDuplicates: false,
  });
  handlePostgrestError(error);
};

/**
 * Upserts block to the database, ignores duplicates.
 */
const upsertBlocks = async (
  rows: { chainId: number; height: number; time?: Date }[],
) => {
  const supabase = getSupabaseClient();
  const upsertRows = rows.map(({ chainId: chain_id, height, time }) => ({
    chain_id,
    height,
    ...(time ? { time: time.toISOString() } : {}),
  }));
  const { error } = await supabase.from("blocks").upsert(upsertRows, {
    onConflict: "chain_id,height",
    ignoreDuplicates: false,
  });
  handlePostgrestError(error);
};

const upsertBlock = async (chainId: number, height: number, time?: Date) =>
  upsertBlocks([{ chainId, height, time }]);

/**
 * Upserts slash event to the database, ignores duplicates.
 */
const insertSlashEvent = async (chainId: number, slashEvent: SlashEvent) => {
  const supabase = getSupabaseClient();
  const row = {
    chain_id: chainId,
    block_height: slashEvent.blockHeight,
    address: slashEvent.address,
    power: slashEvent.power,
    reason: slashEvent.reason,
  };
  const { error } = await supabase.from("slashing_events").upsert(row, {
    onConflict: "chain_id,block_height,address",
    ignoreDuplicates: true,
  });
  handlePostgrestError(error);
};

/**
 * Returns rows with null timestamps.
 */
const selectNullTimestamps = async (chainId: number) => {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("blocks")
    .select("*")
    .eq("chain_id", chainId)
    .is("time", null);
  handlePostgrestError(error);
  return data!;
};

export {
  selectChain,
  upsertChain,
  upsertChains,
  getLatestSynchronizedBlock,
  updateLatestSynchronizedBlock,
  upsertBlocks,
  upsertBlock,
  insertSlashEvent,
  selectNullTimestamps,
};
