// Supabase Edge Function: time spent on the site (for the owner's stats page).
// The page sends {seconds, device} about once a minute while it's open and visible. Logged-in players are
// counted by account (login token in Authorization); guests by a random device id kept in their browser.
// Stored in the `activity` table (sql/012): key, username, total, days {"2026-10-15": seconds}, visits, first, last.
// (Before 2026-10-22 it was one file per player in Storage activity/; the admin function copied those over once.)

import {createClient} from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {...cors, 'Content-Type': 'application/json'}});
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: cors});
  if (req.method !== 'POST') return json({error: 'POST only'}, 405);
  let body: {seconds?: number; device?: string};
  try { body = JSON.parse(await req.text()); } catch { return json({error: 'Bad request.'}, 400); }
  const seconds = Math.max(0, Math.min(300, Math.round(Number(body.seconds) || 0)));
  const device = String(body.device ?? '').replace(/[^a-z0-9-]/gi, '').slice(0, 40);
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const {data: auth} = token && token.split('.').length === 3 ? await db.auth.getUser(token) : {data: {user: null}};
  const user = auth?.user;
  if (!user && !device) return json({error: 'No device.'}, 400);
  const key = user ? user.id : `guest-${device}`;
  // One row per player in the `activity` table (sql/012), added to in a single step.
  const now = Date.now();
  const {error} = await db.rpc('add_activity', {p_key: key, p_username: user ? String(user.user_metadata?.username ?? '') : '',
    p_seconds: seconds, p_day: new Date(now).toISOString().slice(0, 10), p_now: now});
  if (error) return json({error: 'Could not save.'}, 500);
  return json({ok: true});
});
