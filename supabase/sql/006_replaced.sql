-- Switch-over day: old-system results stay on the board until that player posts a new-system result for the
-- same difficulty, which replaces it (the old row is kept but marked replaced and hidden everywhere).
alter table public.results add column if not exists replaced boolean not null default false;
grant select (id, day, day_number, level, name, won, mons_left, turns, created_at, legacy, replaced) on public.results to anon, authenticated;
