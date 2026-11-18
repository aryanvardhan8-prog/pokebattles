// Supabase Edge Function: scheduled notifications, called by pg_cron (see supabase/sql/003_push_cron.sql).
//   ?job=daily  (00:05 UTC) "A new island is ready" to everyone who allows daily reminders
//   ?job=streak (14:30 UTC = 8 pm India) "Keep your N-day streak" to players who played yesterday but not yet today
// Protected by the CRON_SECRET header so nobody else can trigger it.

import {db, allUserIds, notify} from '../_shared/push.ts';

const LAUNCH = Date.UTC(2026, 9, 12); // Day #1 (12 Oct 2026)
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);

Deno.serve(async req => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('no', {status: 403});
  const job = new URL(req.url).searchParams.get('job');
  const ids = await allUserIds();
  const today = dayStr(Date.now()), yesterday = dayStr(Date.now() - 864e5);
  let sent = 0;
  if (job === 'daily') {
    const n = Math.floor((Date.parse(`${today}T00:00:00Z`) - LAUNCH) / 864e5) + 1;
    for (const id of ids) sent += await notify(id, 'daily', {title: 'A new island is ready 🏝️', body: `Day #${n}: a fresh team of 6 is waiting. Can you beat Red today?`, tag: 'daily'});
  } else if (job === 'streak') {
    // Days each player has played (any difficulty), from the leaderboard.
    const {data} = await db.from('results').select('client_id, day').in('client_id', ids).gte('day', dayStr(Date.now() - 60 * 864e5)).limit(100000);
    const days = new Map<string, Set<string>>();
    for (const r of data ?? []) { if (!days.has(r.client_id)) days.set(r.client_id, new Set()); days.get(r.client_id)!.add(r.day); }
    for (const id of ids) {
      const played = days.get(id);
      if (!played || played.has(today) || !played.has(yesterday)) continue;
      let streak = 0;
      for (let t = Date.now() - 864e5; played.has(dayStr(t)); t -= 864e5) streak++;
      sent += await notify(id, 'streak', {title: `Don’t lose your ${streak}-day streak! 🔥`, body: 'Red is waiting on today’s island. One battle keeps it going.', tag: 'streak'});
    }
  } else return new Response('unknown job', {status: 400});
  return new Response(JSON.stringify({job, sent}), {headers: {'Content-Type': 'application/json'}});
});
