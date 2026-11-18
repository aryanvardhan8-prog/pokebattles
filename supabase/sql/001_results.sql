-- PokeBattles leaderboard. Paste this whole file into Supabase → SQL Editor → Run.

create table if not exists public.results (
  id          bigint generated always as identity primary key,
  day         date        not null,
  day_number  int         not null,
  client_id   uuid        not null,
  name        text        not null check (char_length(name) between 1 and 10),
  won         boolean     not null,
  mons_left   int         not null,
  turns       int         not null,
  log         jsonb       not null,
  created_at  timestamptz not null default now(),
  unique (day, client_id)              -- one entry per browser per day
);

create index if not exists results_rank
  on public.results (day, won desc, mons_left desc, turns asc, created_at asc);

alter table public.results enable row level security;

-- Anyone can read the public columns of the leaderboard...
drop policy if exists "read leaderboard" on public.results;
create policy "read leaderboard" on public.results for select to anon, authenticated using (true);
revoke all on public.results from anon, authenticated;
grant select (id, day, day_number, name, won, mons_left, turns, created_at) on public.results to anon, authenticated;

-- ...but nobody can write directly. Only the "submit" server function
-- (which replays the battle to check it) can add rows.
