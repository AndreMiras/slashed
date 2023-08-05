create table
  sync_statuses (
    id int primary key generated always as identity,
    chain_id int not null unique,
    -- synced up to this height
    block_height int not null check (block_height > 0),
    foreign key (chain_id) references chains (id)
  );
