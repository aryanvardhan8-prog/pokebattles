-- A searchable copy of each account's public profile (username, country, trainer, equipped badges),
-- kept in sync with auth.users by a trigger, so functions no longer list every account.
create table if not exists public.players (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null default '',
  country text not null default '',
  trainer text not null default '',
  badges text[] not null default '{}',
  updated_at timestamptz not null default now()
);
create index if not exists players_username_lower on public.players (lower(username));
alter table public.players enable row level security;
drop policy if exists players_read on public.players;
create policy players_read on public.players for select using (true);
grant select on public.players to anon, authenticated;

create or replace function public.sync_player() returns trigger language plpgsql security definer set search_path = public as $$
declare b text[];
begin
  begin
    select coalesce(array_agg(x), '{}') into b from jsonb_array_elements_text(coalesce(new.raw_user_meta_data->'badges', '[]'::jsonb)) x;
  exception when others then b := '{}';
  end;
  insert into public.players (id, username, country, trainer, badges, updated_at)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', ''), coalesce(new.raw_user_meta_data->>'country', ''),
          coalesce(new.raw_user_meta_data->>'trainer', ''), b[1:4], now())
  on conflict (id) do update set username = excluded.username, country = excluded.country,
    trainer = excluded.trainer, badges = excluded.badges, updated_at = now();
  return new;
end $$;
drop trigger if exists on_auth_user_sync on auth.users;
create trigger on_auth_user_sync after insert or update of raw_user_meta_data on auth.users
  for each row execute function public.sync_player();

-- Fill it once from the existing accounts.
insert into public.players (id, username, country, trainer, badges)
select u.id, coalesce(u.raw_user_meta_data->>'username', ''), coalesce(u.raw_user_meta_data->>'country', ''),
       coalesce(u.raw_user_meta_data->>'trainer', ''),
       coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(u.raw_user_meta_data->'badges') = 'array' then u.raw_user_meta_data->'badges' else '[]'::jsonb end) x), '{}')
from auth.users u
on conflict (id) do nothing;
