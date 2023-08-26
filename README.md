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
--data-only --table chains --table slashing_events --table sync_statuses \
> backup_data.sql
```

Restore:

```sh
cat backup_data.sql | \
docker run -i --env=PGPASSWORD --rm postgres psql -h $IP -p 54322 -d postgres -U postgres
```
