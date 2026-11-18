-- Elite Four: how many items the player used over the whole run (shown on the Elite Four board).
alter table public.results add column if not exists items_used smallint;
grant select (items_used) on public.results to anon, authenticated;
