-- :sparkles: slashing_events.address -> validators.valcons_address
--
-- Update slashing_events.address column as a foreign key to
-- validators.valcons_address.
-- The migration script will copy all validators found from
-- `public.slashing_events` to `public.validators`.
--
-- There're two validators row upsert path. The original one at job start
-- consuming data from `/cosmos/staking/v1beta1/validators` and a new one
-- when a slashing event is found. The later will upsert only the chain ID
-- and the valcons as it's the only data available from the slashing event.
-- Usually the entire validator data should already available in the DB
-- hence this upsert should be skipped (for conflict), but if not we would
-- at least have access to the validator valcons.
--
-- Also alter existing `public.validators` to make text columns not null as
-- we don't want to deal with both null and blank.
ALTER TABLE public.validators
ALTER COLUMN moniker
SET DEFAULT '',
ALTER COLUMN moniker
SET
  NOT NULL,
ALTER COLUMN account_address
SET DEFAULT '',
ALTER COLUMN account_address
SET
  NOT NULL,
ALTER COLUMN valoper_address
SET DEFAULT '',
ALTER COLUMN valoper_address
SET
  NOT NULL,
ALTER COLUMN consensus_pubkey
SET DEFAULT '',
ALTER COLUMN consensus_pubkey
SET
  NOT NULL,
  ADD CONSTRAINT valcons_address_unique UNIQUE (valcons_address),
DROP CONSTRAINT validators_chain_id_consensus_pubkey_key;

-- Migrate existing public.slashing_events (valcons) address to public.validators.
INSERT INTO
  public.validators (valcons_address, chain_id)
SELECT DISTINCT
  s.address,
  s.chain_id
FROM
  public.slashing_events s
WHERE
  s.address IS NOT NULL
  AND NOT EXISTS (
    SELECT
      1
    FROM
      public.validators v
    WHERE
      v.valcons_address = s.address
  );

ALTER TABLE public.slashing_events ADD CONSTRAINT slashing_events_address_fkey FOREIGN KEY (address) REFERENCES public.validators (valcons_address);
