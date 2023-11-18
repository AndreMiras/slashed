create table
  public.validators (
    id int primary key generated always as identity,
    chain_id int not null,
    moniker character varying(64),
    account_address character varying(64),
    valoper_address character varying(64),
    valcons_address character varying(64),
    consensus_pubkey character varying(128),
    foreign key (chain_id) references chains (id),
    unique (chain_id, consensus_pubkey)
  );
