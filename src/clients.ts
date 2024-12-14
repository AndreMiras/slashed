/**
 * Functions and classes related to Tendermint client setup and REST API interaction.
 */
import {
  Tendermint34Client,
  Tendermint37Client,
  TendermintClient,
} from "@cosmjs/tendermint-rpc";

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

export { cleanVersion, getRpcNodeVersion, getTendermintClient };
