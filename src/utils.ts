import assert from "assert";
import { sha256 } from "@cosmjs/crypto";
import { fromBase64, toBech32, fromBech32 } from "@cosmjs/encoding";

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

export {
  handleHttpError,
  retry,
  pubKeyToSha256,
  pubKeyToBench32,
  operatorAddressToAccount,
  getEnvVariable,
};
