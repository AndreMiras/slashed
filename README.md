# Slashed Indexer

[![Docker](https://github.com/AndreMiras/slashed/actions/workflows/docker.yml/badge.svg)](https://github.com/AndreMiras/slashed/actions/workflows/docker.yml)
[![Tests](https://github.com/AndreMiras/slashed/actions/workflows/tests.yml/badge.svg)](https://github.com/AndreMiras/slashed/actions/workflows/tests.yml)

The indexer for Slashed.
Looks for slashing events using an archive node RPC, stores the events in database.

## Usage

```sh
CHAIN_NAME=kujira \
TENDERMINT_RPC_URL=https://archive.kujira.network \
npm run dev
```

## Add new chain

Add the new `chain_name` to `src/chains.ts` and start the indexer with `CHAIN_NAME` and `TENDERMINT_RPC_URL`.

On the infra side update `terraform/variables.tf` with the new `chain_name`.
We also need to create a new `slashed-chain_name-tendermint-rpc` entry in GCP Secret Manager.

## Local database

Start the local database with:

```sh
npm run supabase start
```

## DB backup & restore

Backup everything:

```sh
docker run -it --env=PGPASSWORD --rm postgres \
pg_dump -h db.decrqnsfynvibkranfzq.supabase.co -p 5432 -d postgres -U postgres \
> backup_all.sql
```

Backup data only on a subset of tables:

```sh
docker run -it --env=PGPASSWORD --rm postgres \
pg_dump -h db.decrqnsfynvibkranfzq.supabase.co -p 5432 -d postgres -U postgres \
--data-only --table blocks --table chains --table slashing_events --table sync_statuses --table validators \
> backup_data.sql
```

Or using `pg_dump` custom format:

```sh
docker run -it --rm --env=PGPASSWORD --volume $(pwd)/dump:/tmp/dump postgres \
pg_dump -h db.decrqnsfynvibkranfzq.supabase.co -p 5432 -d postgres -U postgres \
-Fc --table blocks --table chains --table slashing_events --table sync_statuses --table validators \
--file /tmp/dump/backup_data.dump
```

Restore:

```sh
cat backup_data.sql | \
docker run -i --env=PGPASSWORD --add-host=host.docker.internal:host-gateway \
--rm postgres psql -h host.docker.internal -p 54322 -d postgres -U postgres
```

Restore from custom format:

```sh
cat dump/backup_data.dump | \
docker run -i --env=PGPASSWORD --add-host=host.docker.internal:host-gateway \
--rm postgres pg_restore -h host.docker.internal -p 54322 -d postgres -U postgres
```

## Tests

```sh
npm run test
```

## How it works

It works by querying the `block_results` RPC endpoint for each blocks and look for a slash event.
For instance Canto got a slash event at block 10834497 which can be extracted like so:

```sh
http://localhost:26657/block_results?height=10834497 | \
jq '.result.finalize_block_events[] | select(.type == "slash")'
```

Output:

```
{
  "type": "slash",
  "attributes": [
    {
      "key": "address",
      "value": "cantovalcons1720m87a44r6h37pmuhkkwfs3d4x4str7g0acah",
      "index": true
    },
    {
      "key": "power",
      "value": "1415",
      "index": true
    },
    {
      "key": "reason",
      "value": "missing_signature",
      "index": true
    },
    {
      "key": "jailed",
      "value": "cantovalcons1720m87a44r6h37pmuhkkwfs3d4x4str7g0acah",
      "index": true
    },
    {
      "key": "mode",
      "value": "BeginBlock",
      "index": false
    }
  ]
}
```

## Detection Modes

The indexer supports two slash detection modes:

### Heuristic Mode (Default - O(log n))

Uses the SigningInfos query to detect jail events efficiently:

1. **Find signing info availability** - Binary search to find earliest height with signing info data
2. **Detect jail events** - Compare signing infos at start/end heights to identify jailed validators
3. **Binary search exact blocks** - For each jailed validator, binary search to find the exact jail block
4. **Verify blocks** - Fetch actual block results to confirm slash events

This is O(log n) per slash event instead of O(n) for sequential scanning.

**Usage**: This mode is enabled by default. Run normally:

```sh
CHAIN_NAME=kujira \
TENDERMINT_RPC_URL=https://archive.kujira.network \
npm run dev
```

### Sequential Mode (O(n))

Traditional block-by-block scanning that queries every block in the range.

**Usage**: Set `USE_HEURISTIC=false`:

```sh
USE_HEURISTIC=false \
CHAIN_NAME=kujira \
TENDERMINT_RPC_URL=https://archive.kujira.network \
npm run dev
```

### Signing Info Technical Details

The heuristic uses the signing info query which provides the most recent slashing information for each validator:

- Using the REST API: <http://localhost:1317/cosmos/slashing/v1beta1/signing_infos>
- Using RPC: <http://localhost:26657/abci_query?path=%22/cosmos.slashing.v1beta1.Query/SigningInfos%22>
- Using gRPC: grpcurl -plaintext localhost:9090 cosmos.slashing.v1beta1.Query/SigningInfos
- Using the CLI: cantod query slashing signing-infos

When using the CLI, you can supply the `--height` flag to query at specific heights.
The indexer uses the RPC ABCI query with height parameter to enable the binary search algorithm.

For more details, refer to the documentation:
[Cosmos SDK Slashing Module](https://docs.cosmos.network/main/build/modules/slashing).
