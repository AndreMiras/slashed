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

export { selectChain, insertSlashEvent };
