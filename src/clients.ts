/**
 * Functions and classes related to Tendermint client setup and REST API interaction.
 */
import { CometClient, connectComet } from "@cosmjs/tendermint-rpc";

/**
 * Pool of RPC endpoints with round-robin rotation
 */
interface RpcClientPool {
  urls: string[];
  currentIndex: number;
  failedInCurrentRound: Set<string>;
}

/**
 * Global RPC client pool state
 */
let rpcPool: RpcClientPool | null = null;

/**
 * Initialize the RPC client pool with URLs from config
 */
const initializeRpcPool = (urls: string[]): RpcClientPool => {
  return {
    urls,
    currentIndex: 0,
    failedInCurrentRound: new Set(),
  };
};

/**
 * Get the next available RPC URL using round-robin strategy.
 * Skips URLs that have failed in the current round.
 * Resets failed set if all URLs have been tried.
 */
const getNextRpcUrl = (pool: RpcClientPool): string | null => {
  const availableUrls = pool.urls.filter(
    (url) => !pool.failedInCurrentRound.has(url),
  );

  // If all URLs failed, reset and try again
  if (availableUrls.length === 0) {
    console.log("All RPC URLs failed in this round, resetting blacklist");
    pool.failedInCurrentRound.clear();
    pool.currentIndex = 0;
    return pool.urls[0] || null;
  }

  // Find next available URL using round-robin
  let attempts = 0;
  while (attempts < pool.urls.length) {
    const url = pool.urls[pool.currentIndex];
    pool.currentIndex = (pool.currentIndex + 1) % pool.urls.length;

    if (!pool.failedInCurrentRound.has(url)) {
      return url;
    }

    attempts++;
  }

  return null;
};

/**
 * Mark an RPC URL as failed (temporarily blacklisted for this round)
 */
const markRpcUrlFailed = (pool: RpcClientPool, url: string): void => {
  pool.failedInCurrentRound.add(url);
  console.log(`Marked RPC URL as failed: ${url}`);
  console.log(
    `Remaining available URLs: ${
      pool.urls.length - pool.failedInCurrentRound.size
    }`,
  );
};

/**
 * Get a Tendermint client using the next available RPC URL from the pool.
 * Creates client on-demand (no connection caching).
 *
 * @param urls - Optional array of RPC URLs (initializes pool if not yet initialized)
 * @returns CometClient connected to next available endpoint
 * @throws Error if no URLs available or connection fails
 */
const getTendermintClient = async (
  urls?: string[],
): Promise<{ client: CometClient; url: string }> => {
  // Initialize pool if needed
  if (!rpcPool && urls) {
    rpcPool = initializeRpcPool(urls);
  }

  if (!rpcPool) {
    throw new Error("RPC pool not initialized");
  }

  const url = getNextRpcUrl(rpcPool);
  if (!url) {
    throw new Error("No available RPC URLs");
  }

  console.log(`Connecting to RPC: ${url}`);
  const client = await connectComet(url);
  return { client, url };
};

/**
 * Export function to mark current RPC URL as failed.
 * Used by retry logic when errors occur.
 */
const markCurrentRpcFailed = (url: string): void => {
  if (rpcPool) {
    markRpcUrlFailed(rpcPool, url);
  }
};

/**
 * Reset the RPC pool (useful for testing)
 */
const resetRpcPool = (): void => {
  rpcPool = null;
};

export { getTendermintClient, markCurrentRpcFailed, resetRpcPool };
