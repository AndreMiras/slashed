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
  SlashEvent,
  CosmosValidatorDescription,
  CosmosValidatorCommissionRate,
  CosmosValidatorCommission,
  CosmosValidator,
};
