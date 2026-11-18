-- Elite Four Hard mode (2026-10-22): results level 'elite-hard'; Elite badges count both modes;
-- the all-time Elite board is per mode.
alter table public.results drop constraint if exists results_level_check;
alter table public.results add constraint results_level_check check (level in ('easy', 'medium', 'hard', 'elite', 'elite-hard'));
drop materialized view if exists public.player_stats;
create materialized view public.player_stats as
with latest as (
  select distinct on (client_id) client_id, name from public.results order by client_id, created_at desc
), red as (select * from public.red_ranked),
win_days as (select distinct client_id, day from red where won),
islands as (select client_id, day - (row_number() over (partition by client_id order by day))::int as grp from win_days),
streaks as (select client_id, max(n) as streak from (select client_id, grp, count(*) n from islands group by 1, 2) x group by 1),
triples as (select client_id, count(*) as triples from (select client_id, day from red where won group by 1, 2 having count(distinct level) >= 3) t group by 1),
elite as (select client_id, max(coalesce(stage, 0)) best, count(*) filter (where won) champs,
            count(*) filter (where won and coalesce(items_used, 999) <= 10) light
          from public.results where level in ('elite', 'elite-hard') group by 1),
days as (select client_id, count(distinct day) n from public.results where coalesce(legacy, false) = false and coalesce(replaced, false) = false group by 1)
select l.client_id, l.name, lower(l.name) as name_lower,
  coalesce(count(red.*) filter (where red.won), 0)::int as red_wins,
  coalesce(count(red.*) filter (where red.won and red.level = 'medium'), 0)::int as medium_wins,
  coalesce(count(red.*) filter (where red.won and red.level = 'hard'), 0)::int as hard_wins,
  coalesce(count(red.*) filter (where red.won and red.mons_left = 6), 0)::int as sweeps,
  coalesce(max(t.triples), 0)::int as triples,
  coalesce(count(red.*) filter (where red.won and red.mons_left = 1), 0)::int as comebacks,
  coalesce(max(e.best), 0)::int as elite_best, coalesce(max(e.champs), 0)::int as champions, coalesce(max(e.light), 0)::int as light_champions,
  coalesce(max(s.streak), 0)::int as streak, coalesce(max(d.n), 0)::int as days,
  coalesce(count(red.*) filter (where red.won and red.day_rank <= 10), 0)::int as top10,
  coalesce(count(red.*) filter (where red.won and red.day_rank = 1), 0)::int as firsts
from latest l
left join red on red.client_id = l.client_id
left join triples t on t.client_id = l.client_id
left join elite e on e.client_id = l.client_id
left join streaks s on s.client_id = l.client_id
left join days d on d.client_id = l.client_id
group by l.client_id, l.name;
create unique index player_stats_id on public.player_stats (client_id);
create index player_stats_name on public.player_stats (name_lower);

drop materialized view if exists public.alltime_red;
create materialized view public.alltime_red as
select level, lower(name) as name_lower,
  (array_agg(name order by created_at desc))[1] as name,
  count(*)::int as played, count(*) filter (where won)::int as wins,
  coalesce(sum(mons_left) filter (where won), 0)::int as left_sum,
  (array_agg(id order by id desc))[1] as last_id, max(created_at) as last_at
from public.results
where level in ('easy', 'medium', 'hard') and coalesce(replaced, false) = false
group by level, lower(name);
create unique index alltime_red_key on public.alltime_red (level, name_lower);

drop materialized view if exists public.alltime_elite;
create materialized view public.alltime_elite as
with best as (
  select level, lower(name) n, max(coalesce(stage, 0)) best from public.results where level in ('elite', 'elite-hard') group by 1, 2
)
select r.level, lower(r.name) as name_lower, (array_agg(r.name order by r.created_at desc))[1] as name,
  count(*)::int as runs, count(*) filter (where r.won)::int as wins, max(b.best)::int as best,
  min(coalesce(r.items_used, 999)) filter (where coalesce(r.stage, 0) = b.best)::int as fewest,
  (array_agg(r.id order by r.id desc))[1] as last_id
from public.results r join best b on b.n = lower(r.name) and b.level = r.level
where r.level in ('elite', 'elite-hard')
group by r.level, lower(r.name);
create unique index alltime_elite_key on public.alltime_elite (level, name_lower);

grant select on public.player_stats, public.alltime_red, public.alltime_elite to anon, authenticated;
select public.refresh_stats();
