create table
  chains (
    id int primary key generated always as identity,
    name varchar(32) not null unique
  );

create table
  slashing_events (
    id int primary key generated always as identity,
    chain_id int not null,
    block_height int not null check (block_height > 0),
    address varchar(128) not null,
    power int not null,
    reason varchar(64) not null,
    foreign key (chain_id) references chains (id),
    unique (chain_id, block_height, address)
  );
