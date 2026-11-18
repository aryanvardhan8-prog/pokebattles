-- Elite Four runs: level 'elite', one per player per day. stage = rooms cleared (5 = Champion).
-- log holds the five battle logs (array of arrays), team the team the player built.
alter table public.results drop constraint if exists results_level_check;
alter table public.results add constraint results_level_check check (level in ('easy', 'medium', 'hard', 'elite'));
alter table public.results add column if not exists stage smallint;
grant select (id, day, day_number, level, name, won, mons_left, turns, created_at, legacy, replaced, stage) on public.results to anon, authenticated;
