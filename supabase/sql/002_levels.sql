-- Adds Easy / Medium / Hard: one entry per browser, per day, per level.
alter table public.results add column if not exists level text not null default 'hard'
  check (level in ('easy', 'medium', 'hard'));
alter table public.results drop constraint if exists results_day_client_id_key;
alter table public.results drop constraint if exists results_day_client_level_key;
alter table public.results add constraint results_day_client_level_key unique (day, client_id, level);
drop index if exists results_rank;
create index if not exists results_rank_level
  on public.results (day, level, won desc, mons_left desc, turns asc, created_at asc);
grant select (id, day, day_number, level, name, won, mons_left, turns, created_at) on public.results to anon, authenticated;
