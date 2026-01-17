import { comet1, comet38, tendermint37 } from "@cosmjs/tendermint-rpc";

// CometBFT 1.x types
type BlockResultsResponse1 = comet1.BlockResultsResponse;
type BlockEvent1 = comet1.Event;

// CometBFT 0.38 types
type BlockResultsResponse38 = comet38.BlockResultsResponse;
type BlockEvent38 = comet38.Event;

// Tendermint 0.37 types
type BlockResultsResponse37 = tendermint37.BlockResultsResponse;
type BlockEvent37 = tendermint37.Event;

// Union types for compatibility across versions
// All modern versions use string attributes, so we use a common Event type
type BlockEvent = BlockEvent37 | BlockEvent38 | BlockEvent1;
type BlockEventAttribute = { key: string; value: string };
type BlockResultsResponse =
  | BlockResultsResponse37
  | BlockResultsResponse38
  | BlockResultsResponse1;

export type {
  BlockEvent1,
  BlockEvent37,
  BlockEvent38,
  BlockResultsResponse1,
  BlockResultsResponse37,
  BlockResultsResponse38,
};

interface SlashEvent {
  blockHeight: number;
  address: string;
  power: number;
  reason: string;
}

interface CosmosValidatorDescription {
  moniker: string;
  identity: string;
  website: string;
  details: string;
}

interface CosmosValidatorCommissionRate {
  rate: string;
  max_rate: string;
  max_change_rate: string;
}

interface CosmosValidatorCommission {
  commission_rates: CosmosValidatorCommissionRate;
  update_time: string;
}

interface CosmosValidatorPubKey {
  "@type": string;
  key: string;
}

interface CosmosValidator {
  operator_address: string;
  consensus_pubkey: CosmosValidatorPubKey;
  jailed: boolean;
  status: number;
  tokens: string;
  delegator_shares: string;
  description: CosmosValidatorDescription;
  unbonding_height: string;
  unbonding_time: string;
  commission: CosmosValidatorCommission;
  min_self_delegation: string;
}

export type {
  BlockEvent,
  BlockEventAttribute,
  BlockResultsResponse,
  CosmosValidator,
  CosmosValidatorCommission,
  CosmosValidatorCommissionRate,
  CosmosValidatorDescription,
  SlashEvent,
};
