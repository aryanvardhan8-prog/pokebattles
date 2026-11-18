-- Scheduled notifications (run once; already applied 2026-10-15).
-- The cron secret is kept in Supabase Vault as 'cron_secret' (same value as the CRON_SECRET function secret).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobname) from cron.job where jobname in ('push-daily', 'push-streak');

-- 00:05 UTC every day: "A new island is ready"
select cron.schedule('push-daily', '5 0 * * *', $$
  select net.http_post(
    url := 'https://uddzqxdgpgraisdlioqf.supabase.co/functions/v1/push-cron?job=daily',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb)
$$);

-- 14:30 UTC (8 pm India) every day: streak reminder for players who haven't played today
select cron.schedule('push-streak', '30 14 * * *', $$
  select net.http_post(
    url := 'https://uddzqxdgpgraisdlioqf.supabase.co/functions/v1/push-cron?job=streak',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb)
$$);
