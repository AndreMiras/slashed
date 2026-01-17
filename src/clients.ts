/**
 * Functions and classes related to Tendermint client setup and REST API interaction.
 */
import { CometClient, connectComet } from "@cosmjs/tendermint-rpc";

/**
 * Connects to the appropriate Tendermint/CometBFT client version automatically.
 * Uses connectComet for auto-detection of backend version (0.34, 0.37, 0.38+).
 */
const getTendermintClient = async (rpcUrl: string): Promise<CometClient> => {
  return connectComet(rpcUrl);
};

export { getTendermintClient };
