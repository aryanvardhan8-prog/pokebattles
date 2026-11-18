-- Fast owner stats page: time on site and friend-battle summaries live in tables instead of hundreds of files,
-- friend counts sit on players, and the whole stats page is pre-built every 5 minutes.
create table if not exists public.activity (
  key text primary key,            -- user id, or guest-<device id>
  username text not null default '',
  total int not null default 0,     -- seconds
  days jsonb not null default '{}', -- {"2026-10-20": seconds}
  visits int not null default 0,
  first bigint not null default 0,  -- ms
  last bigint not null default 0
);
alter table public.activity enable row level security; -- service role only

create table if not exists public.match_summary (
  id text primary key,
  host text not null default '', guest text not null default '',
  created bigint not null default 0, declined boolean not null default false,
  team_host boolean not null default false, team_guest boolean not null default false,
  picks_host text[] not null default '{}', picks_guest text[] not null default '{}',
  rounds int not null default 0, forfeit boolean not null default false,
  options jsonb, updated_at timestamptz not null default now()
);
alter table public.match_summary enable row level security; -- service role only

alter table public.players add column if not exists friend_count int not null default 0;

-- Adds seconds to a player's time on site in one step (no read-modify-write races).
create or replace function public.add_activity(p_key text, p_username text, p_seconds int, p_day text, p_now bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into activity (key, username, total, days, visits, first, last)
  values (p_key, p_username, p_seconds, jsonb_build_object(p_day, p_seconds), 1, p_now, p_now)
  on conflict (key) do update set
    username = case when p_username <> '' then p_username else activity.username end,
    total = activity.total + p_seconds,
    days = activity.days || jsonb_build_object(p_day, coalesce((activity.days->>p_day)::int, 0) + p_seconds),
    visits = activity.visits + case when p_now - activity.last > 1800000 then 1 else 0 end,
    last = p_now;
end $$;
revoke all on function public.add_activity from anon, authenticated;

-- Every 5 minutes: rebuild the owner's stats page in the background (admin function, cron secret from Vault).
select cron.unschedule('admin-cache') where exists (select 1 from cron.job where jobname = 'admin-cache');
select cron.schedule('admin-cache', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://uddzqxdgpgraisdlioqf.supabase.co/functions/v1/admin?job=build',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000)
$$);
