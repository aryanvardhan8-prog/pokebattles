-- Easy (from 2026-10-17): players build their own team, saved with the result so the battle can be replayed.
alter table public.results add column if not exists team jsonb;
