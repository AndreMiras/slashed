create table
  public.blocks (
    id int primary key generated always as identity,
    chain_id int not null,
    height int not null check (height > 0),
    time timestamptz,
    foreign key (chain_id) references chains (id),
    unique (chain_id, height)
  );

insert into
  blocks (chain_id, height)
select distinct
  chain_id,
  block_height as height
from
  slashing_events on conflict (chain_id, height) do nothing;

alter table public.slashing_events add constraint slashing_events_chain_id_block_height_fkey foreign key (chain_id, block_height) references blocks (chain_id, height);
