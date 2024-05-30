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
