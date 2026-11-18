-- 2026-10-16: the new Fight Red (Red's real team) went live mid-day. Results already posted that day on the old
-- system are kept as "legacy": hidden from that day's leaderboard, still replayable, and players can post again.
alter table public.results add column if not exists legacy boolean not null default false;
update public.results set legacy = true where day = '2026-10-16';
alter table public.results drop constraint if exists results_day_client_level_key;
create unique index if not exists results_one_live on public.results (day, client_id, level) where not legacy;
create unique index if not exists results_one_legacy on public.results (day, client_id, level) where legacy;
grant select (id, day, day_number, level, name, won, mons_left, turns, created_at, legacy) on public.results to anon, authenticated;
