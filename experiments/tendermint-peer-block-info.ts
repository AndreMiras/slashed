/**
 * This script retrieves and analyzes block information from a Tendermint network.
 *
 * Given a `TENDERMINT_RPC_URL` environment variable pointing to a Tendermint RPC endpoint,
 * the script performs the following tasks:
 *
 * 1. Retrieves the list of peers connected to the node specified by `TENDERMINT_RPC_URL`.
 * 2. For each peer, checks if their RPC endpoint is publicly accessible.
 * 3. Retrieves both the minimum (earliest) and maximum (latest) block heights from each accessible peer.
 * 4. Aggregates and logs the block height information for all discovered nodes, including the original node.
 *
 * The script is designed to help identify the block ranges available across different nodes in a Tendermint network.
 * Usage:
 * ```
 * TENDERMINT_RPC_URL=http://localhost:26657 \
 * npx ts-node experiments/tendermint-peer-block-info.ts
 * ```
 */

/**
 * Interface representing basic information about a peer node.
 */
interface PeerInfo {
  node_info: {
    moniker: string;
  };
  remote_ip: string;
}

/**
 * Interface representing the response from the /net_info endpoint.
 */
interface NetInfoResponse {
  result: {
    peers: PeerInfo[];
  };
}

/**
 * Interface representing an error response from the /block and /block_results endpoint.
 */
interface RpcError {
  jsonrpc: string;
  id: number;
  error: {
    code: number;
    message: string;
    data: string;
  };
}

/**
 * Interface representing the response from the /block_results endpoint.
 */
interface BlockResultsResponse {
  result: {
    height: string;
  };
}

/**
 * Interface representing the simplified response from the /block endpoint,
 * focusing only on chain_id and height.
 */
interface BlockResponse {
  result: {
    block: {
      header: {
        chain_id: string;
        height: string;
      };
    };
  };
}

/**
 * Interface representing the response from the /status endpoint.
 */
interface StatusResponse {
  result: {
    node_info: {
      moniker: string;
      network: string;
    };
  };
}

/**
 * Interface representing block information for a peer node.
 */
interface PeerBlockInfo {
  moniker: string;
  network: string | null;
  address: string;
  height: number | null;
  minBlockHeight: number | null;
}

/**
 * Type representing a map of peers to their block information.
 */
type PeersBlocksMap = Record<
  string,
  {
    network: string | null;
    address: string;
    height: number | null;
    minBlockHeight: number | null;
  }
>;

/**
 * Retrieves the moniker of the node serving the given RPC endpoint.
 *
 * @param rpcUrl - The URL of the RPC endpoint.
 * @returns The moniker of the node, or null if the request fails.
 */
const getNodeMoniker = async (rpcUrl: string): Promise<string | null> => {
  const response = await fetch(`${rpcUrl}/status`);
  if (!response.ok) {
    console.error(
      `Error fetching node (${rpcUrl}) moniker, response status: ${response.statusText}`,
    );
    return null;
  }
  const data: StatusResponse = await response.json();
  return data.result.node_info.moniker;
};

/**
 * Retrieves the list of peers from the given RPC endpoint.
 *
 * @param rpcUrl - The URL of the RPC endpoint.
 * @returns An array of PeerInfo objects representing the peers.
 */
const getPeers = async (rpcUrl: string): Promise<PeerInfo[]> => {
  const response = await fetch(`${rpcUrl}/net_info`);
  if (!response.ok) {
    console.error("Error listing peers, response status:", response.status);
    return [];
  }
  const data: NetInfoResponse = await response.json();
  return data.result.peers;
};

/**
 * Fetches the block results for a given height from the RPC endpoint.
 *
 * @param rpcUrl - The URL of the RPC endpoint.
 * @param height - The block height to fetch (optional).
 * @returns An object containing either the data or an error.
 */
const getBlockResults = async (
  rpcUrl: string,
  height?: number,
): Promise<{
  data: BlockResultsResponse | null;
  error: RpcError | null;
}> => {
  const params = height
    ? {
        height: height.toString(),
      }
    : {};
  const url = new URL(`${rpcUrl}/block_results`);
  url.search = new URLSearchParams(params as Record<string, string>).toString();
  const response = await fetch(url);
  const responseJson = await response.json();
  const [data, error] = response.ok
    ? [responseJson, null]
    : [null, responseJson];
  return { data, error };
};

/**
 * Fetches the block for a given height from the RPC endpoint.
 *
 * @param rpcUrl - The URL of the RPC endpoint.
 * @param height - The block height to fetch (optional).
 * @returns An object containing either the data or an error.
 */
const getBlock = async (
  rpcUrl: string,
  height?: number,
): Promise<{
  data: BlockResponse | null;
  error: RpcError | null;
}> => {
  const params = height
    ? {
        height: height.toString(),
      }
    : {};
  const url = new URL(`${rpcUrl}/block`);
  url.search = new URLSearchParams(params as Record<string, string>).toString();
  const response = await fetch(url);
  const responseJson = await response.json();
  const [data, error] = response.ok
    ? [responseJson, null]
    : [null, responseJson];
  return { data, error };
};

/**
 * Determines the minimum block height available on the node.
 *
 * @param rpcUrl - The URL of the RPC endpoint.
 * @returns The minimum block height, or null if it cannot be determined.
 */
const getMinBlockHeight = async (rpcUrl: string): Promise<number | null> => {
  const height = 1;
  const { data: block, error } = await getBlock(rpcUrl, height);
  if (!error) {
    return height;
  }
  const errorMessage = error.error.data;
  const match = errorMessage.match(/lowest height is (\d+)/);
  if (match) {
    const lowestHeight = parseInt(match[1], 10);
    return lowestHeight;
  } else {
    console.error(`Unexpected error fetching block: ${errorMessage}`);
  }
  return null;
};

/**
 * Fetches the block results and minimum block height for a node.
 *
 * @param moniker - The moniker of the node.
 * @param address - The URL of the RPC endpoint.
 * @returns An object containing the block information for the node.
 */
const fetchBlockResults = async (moniker: string, address: string) => {
  let network: string | null = null;
  let height: number | null = null;
  let minBlockHeight: number | null = null;
  try {
    const { data: block, error } = await getBlock(address);
    const header = error ? null : block!.result.block.header;
    network = error ? null : header!.chain_id;
    height = error ? null : Number(header!.height);
    minBlockHeight = height ? await getMinBlockHeight(address) : null;
  } catch (error) {}
  return {
    network,
    moniker,
    address,
    height,
    minBlockHeight,
  };
};

/**
 * Fetches the block results and minimum block height for a peer node.
 *
 * @param peer - The PeerInfo object representing the peer.
 * @returns An object containing the block information for the peer.
 */
const fetchBlockResultsForPeer = async (peer: PeerInfo) => {
  const peerUrl = `http://${peer.remote_ip}:26657`;
  return await fetchBlockResults(peer.node_info.moniker, peerUrl);
};

/**
 * Adds the block information for a peer node to the map.
 *
 * @param acc - The accumulator object (PeersBlocksMap).
 * @param param1 - The PeerBlockInfo object containing block information.
 * @returns The updated accumulator with the new peer block info.
 */
const addPeerBlockInfoToMap = (
  acc: PeersBlocksMap,
  { moniker, network, address, height, minBlockHeight }: PeerBlockInfo,
): PeersBlocksMap => {
  acc[moniker] = { address, network, height, minBlockHeight };
  return acc;
};

/**
 * Main function to execute the logic of fetching and displaying block information for peers.
 */
const main = async () => {
  const rpcUrl = process.env.TENDERMINT_RPC_URL ?? "http://localhost:26657";
  const rpcMoniker = await getNodeMoniker(rpcUrl);
  const peers = await getPeers(rpcUrl);
  const peersBlocks = await Promise.all(peers.map(fetchBlockResultsForPeer));
  const rpcBlockResults =
    rpcMoniker === null ? [] : [await fetchBlockResults(rpcMoniker, rpcUrl)];
  // append the RPC to the peers
  const allBlockResults = [...peersBlocks, ...rpcBlockResults];
  const peersBlocksMap = allBlockResults.reduce<PeersBlocksMap>(
    addPeerBlockInfoToMap,
    {},
  );
  console.log("Highest Available Block Per Node:", peersBlocksMap);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
