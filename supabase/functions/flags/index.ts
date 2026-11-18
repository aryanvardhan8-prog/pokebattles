// Supabase Edge Function: each player's country (for leaderboard flags), as {username (lowercase): "IN"}.
// With ?badges=1: each player's equipped badges, as {username: ["champ-1", …]}.
// With ?trainers=1: each player's chosen trainer picture instead, as {username (lowercase): "dawn"}.
// Only usernames, country codes and trainer ids are returned; nothing private.

import {createClient} from 'npm:@supabase/supabase-js@2';
import {fromRow, verified} from './rules.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: cors});
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const trainers = new URL(req.url).searchParams.has('trainers');
  const badges = new URL(req.url).searchParams.has('badges');
  const out: Record<string, string | string[]> = {};
  // One quick read of the players table (kept in sync with accounts), instead of listing every account.
  // Badges are only shown if the player's results prove them (friend badges can't be checked, so they stay).
  const stats = new Map<string, Record<string, number>>();
  if (badges) {
    const {data: ps} = await db.from('player_stats').select('*').limit(100000);
    for (const r of (ps ?? []) as Record<string, number & string>[]) stats.set(String(r.name_lower), r);
  }
  const {data} = await db.from('players').select('username, country, trainer, badges').neq('username', '').limit(100000);
  for (const u of (data ?? []) as {username: string; country: string; trainer: string; badges: string[]}[]) {
    const name = u.username.toLowerCase();
    if (badges) { out[name] = verified((u.badges ?? []).filter(x => /^[a-z0-9-]{1,24}$/.test(x)), fromRow(stats.get(name))).slice(0, 4); continue; }
    if (trainers) { if (/^[a-z]{1,12}$/.test(u.trainer)) out[name] = u.trainer; continue; }
    if (/^[A-Z]{2}$/.test(u.country)) out[name] = u.country;
  }
  return new Response(JSON.stringify(out), {headers: {...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
});
