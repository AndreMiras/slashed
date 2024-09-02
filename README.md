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

We are currently querying each block sequentially to identify slashing events.
However, there are heuristics that can accelerate this process.
For example, the signing info query provides the most recent slashing information for each validator, allowing you to target specific blocks more effectively.

This data is accessible through various methods:

- Using the REST API: <http://localhost:1317/cosmos/slashing/v1beta1/signing_infos>
- Using gRPC: grpcurl -plaintext localhost:9090 cosmos.slashing.v1beta1.Query/SigningInfos
- Using the CLI: cantod query slashing signing-infos

When using the CLI, you can supply the `--height` flag to search prior to the last recorded slashing event for each validator, allowing to backtrack efficiently. Unfortunately the height doesn't seem to be configurable using the REST API or gRPC.

For more details, refer to the documentation:
[Cosmos SDK Slashing Module](https://docs.cosmos.network/main/build/modules/slashing).

This heuristic is not currently implemented, and there may be other strategies that could further optimize the process.
If you know of any, we encourage you to share them.

Note: We are actively looking for a more efficient method to directly query all slashing events across all blocks.
If you have insights or suggestions, please feel free to contribute.
