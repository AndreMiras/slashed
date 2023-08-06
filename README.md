# Slashed Indexer

The indexer for Slashed.
Looks for slashing events using an archive node RPC, stores the events in database.

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
