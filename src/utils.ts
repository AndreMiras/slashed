/**
 * Generic utility functions.
 */
import { sha256 } from "@cosmjs/crypto";
import { fromBase64, fromBech32, toBech32 } from "@cosmjs/encoding";
import { CometClient } from "@cosmjs/tendermint-rpc";
import assert from "assert";

import { getTendermintClient, markCurrentRpcFailed } from "./clients";

/**
 * Handles HTTP error response, raises an exception on non OK status.
 */
const handleHttpError = async (response: Response, consoleError = true) => {
  if (!response.ok) {
    const bodyText = await response.text();
    const errorMessage = `${response.status} ${response.statusText} (${response.url}): ${bodyText}`;
    if (consoleError) console.error(errorMessage);
    throw new Error(errorMessage);
  }
};

const retry = async <T>(fn: () => Promise<T>, retries = 3): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    console.error(error);
    if (retries > 0) {
      return await retry(fn, retries - 1);
    } else {
      throw error;
    }
  }
};

/**
 * Check if an error is an HTTP 429 rate limit error.
 * CosmJS errors include error.cause.status for HTTP errors.
 */
const isRateLimitError = (error: unknown): boolean => {
  if (error instanceof Error) {
    // Access cause through type assertion since it's an ES2022 feature
    const errorWithCause = error as Error & { cause?: { status?: number } };
    if (errorWithCause.cause && errorWithCause.cause.status === 429) {
      return true;
    }
  }
  return false;
};

/**
 * Check if an error is retryable (rate limit or network error)
 */
const isRetryableError = (error: unknown): boolean => {
  if (isRateLimitError(error)) {
    return true;
  }

  // Also retry on network errors, timeouts, etc.
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("timeout") ||
      message.includes("network") ||
      message.includes("fetch") ||
      message.includes("econnrefused") ||
      message.includes("econnreset") ||
      message.includes("socket hang up")
    );
  }

  return false;
};

/**
 * Extract HTTP status code from error if available
 */
const getErrorStatus = (error: unknown): number | null => {
  if (error instanceof Error) {
    // Access cause through type assertion since it's an ES2022 feature
    const errorWithCause = error as Error & { cause?: { status?: number } };
    if (errorWithCause.cause) {
      return errorWithCause.cause.status || null;
    }
  }
  return null;
};

/**
 * Options for retry with rotation
 */
interface RetryWithRotationOptions {
  maxRetries?: number;
  initialBackoffMs?: number;
  backoffMultiplier?: number;
  maxBackoffMs?: number;
}

/**
 * Execute an RPC operation with retry and endpoint rotation.
 *
 * On error:
 * 1. Check if error is retryable (429, network error, etc.)
 * 2. Mark current endpoint as failed
 * 3. Wait with exponential backoff
 * 4. Rotate to next endpoint
 * 5. Retry operation
 *
 * @param fn - Function that takes a CometClient and performs RPC operation
 * @param rpcUrls - Array of RPC URLs to rotate through
 * @param options - Retry configuration options
 * @returns Result of the operation
 * @throws Error if all retries exhausted or error is not retryable
 */
const retryWithRotation = async <T>(
  fn: (client: CometClient) => Promise<T>,
  rpcUrls: string[],
  options: RetryWithRotationOptions = {},
): Promise<T> => {
  const {
    maxRetries = 3,
    initialBackoffMs = 1000,
    backoffMultiplier = 2,
    maxBackoffMs = 30000,
  } = options;

  let lastError: unknown;
  let backoffMs = initialBackoffMs;
  let currentUrl: string | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Get next available client
      const { client, url } = await getTendermintClient(
        attempt === 0 ? rpcUrls : undefined,
      );
      currentUrl = url;

      // Execute operation
      const result = await fn(client);

      // Success! Disconnect client and return result
      client.disconnect();
      return result;
    } catch (error) {
      lastError = error;

      // Get error details for logging
      const status = getErrorStatus(error);
      const errorType = isRateLimitError(error)
        ? "Rate limit (429)"
        : status
        ? `HTTP ${status}`
        : "Network/Unknown";

      console.error(
        `RPC error on attempt ${attempt + 1}: ${errorType}`,
        error instanceof Error ? error.message : error,
      );

      // Check if we should retry
      if (!isRetryableError(error)) {
        console.error("Error is not retryable, failing immediately");
        throw error;
      }

      // Check if we have retries left
      if (attempt >= maxRetries) {
        console.error("Max retries exhausted");
        throw error;
      }

      // Mark current endpoint as failed
      if (currentUrl) {
        markCurrentRpcFailed(currentUrl);
      }

      // Exponential backoff
      const actualBackoff = Math.min(backoffMs, maxBackoffMs);
      console.log(`Waiting ${actualBackoff}ms before retry...`);
      await new Promise((resolve) => setTimeout(resolve, actualBackoff));
      backoffMs *= backoffMultiplier;

      // Pool will automatically rotate to next URL on next getTendermintClient call
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
};

const pubKeyToSha256 = (pubKey: string): Uint8Array => {
  const ed25519PubkeyRaw = fromBase64(pubKey);
  return sha256(ed25519PubkeyRaw).slice(0, 20);
};

const pubKeyToBench32 = (prefix: string, pubKey: string): string => {
  const addressData = pubKeyToSha256(pubKey);
  const bech32Address = toBech32(prefix, addressData);
  return bech32Address;
};

const operatorAddressToAccount = (address: string): string => {
  const { prefix, data } = fromBech32(address);
  const subPrefix = prefix.replace("valoper", "");
  return toBech32(subPrefix, data);
};

/**
 * Helper function to get an environment variable.
 * Asserts that the variable is defined and returns its value.
 *
 * @param {string} varName - The name of the environment variable.
 * @returns {string} - The value of the environment variable.
 */
const getEnvVariable = (varName: string): string => {
  const value = process.env[varName];
  assert.ok(value, `${varName} environment variable is required.`);
  return value;
};

/**
 * Format milliseconds into a human-readable duration string.
 */
const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
};

/**
 * Calculate and format ETA based on elapsed time and progress.
 */
const formatEta = (
  elapsedMs: number,
  completed: number,
  total: number,
): string => {
  if (completed === 0) return "calculating...";
  const msPerItem = elapsedMs / completed;
  const remaining = total - completed;
  const etaMs = msPerItem * remaining;
  return formatDuration(etaMs);
};

export {
  formatDuration,
  formatEta,
  getEnvVariable,
  getErrorStatus,
  handleHttpError,
  isRateLimitError,
  isRetryableError,
  operatorAddressToAccount,
  pubKeyToBench32,
  pubKeyToSha256,
  retry,
  retryWithRotation,
};
