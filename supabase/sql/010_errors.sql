-- Errors players hit in the game (sent by src/errors.ts through the feedback function), grouped per day.
create table if not exists public.client_errors (
  id bigserial primary key,
  day date not null default current_date,
  sig text not null,
  message text not null,
  stack text not null default '',
  page text not null default '',
  device text not null default '',
  username text not null default '',
  site text not null default '',
  count int not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  unique (day, sig)
);
alter table public.client_errors enable row level security; -- no public access; only the service role
create or replace function public.log_client_error(p_sig text, p_message text, p_stack text, p_page text, p_device text, p_username text, p_site text)
returns void language sql security definer set search_path = public as $$
  insert into client_errors (sig, message, stack, page, device, username, site)
  values (p_sig, p_message, p_stack, p_page, p_device, p_username, p_site)
  on conflict (day, sig) do update set count = client_errors.count + 1, last_at = now(),
    username = case when excluded.username <> '' then excluded.username else client_errors.username end;
$$;
revoke all on function public.log_client_error from anon, authenticated;
