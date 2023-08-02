-- not using the seed.sql, since we also that data on production
insert into
  chains (name)
values
  ('canto') on conflict (name) do nothing;
