-- :recycle: Update validator fields size
--
-- Increase validator fields max size from 64 to 128 chars.
-- Kujira has a least one validator with the account address over 64 chars:
-- kujira1mc4xh5k86aa8h7fasxqs2g5m68w83n0vgz83a7xr5kf5r8lawj2smtp4h3
-- The validator address is also larger with 72 chars:
-- kujiravaloper1mc4xh5k86aa8h7fasxqs2g5m68w83n0vgz83a7xr5kf5r8lawj2s9v2rwj
-- While we're at it we also increase moniker max size to match.
ALTER TABLE public.validators
ALTER COLUMN moniker TYPE character varying(128);

ALTER TABLE public.validators
ALTER COLUMN account_address TYPE character varying(128);

ALTER TABLE public.validators
ALTER COLUMN valoper_address TYPE character varying(128);

ALTER TABLE public.validators
ALTER COLUMN valcons_address TYPE character varying(128);
