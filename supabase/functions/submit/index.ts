// Supabase Edge Function: checks a finished battle by replaying it, then saves it.
// The client only sends its moves; the result is worked out here, so it can't be faked.

import {createClient} from 'npm:@supabase/supabase-js@2';
import {generateDay, Battle, LEVELS, EASY_OPTIONS, isV2, V2_FROM, teamError, replayElite, ELITE_OPTIONS, eliteHardTeam, ELITE_LEVEL} from './engine.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {...cors, 'Content-Type': 'application/json'}});

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: cors});
  if (req.method !== 'POST') return json({error: 'POST only'}, 405);

  let body: {date?: string; level?: string; log?: unknown};
  try {
    body = await req.json();
  } catch {
    return json({error: 'Bad JSON'}, 400);
  }
  const {date, log} = body;
  // Easy: the team the player built (checked against the rules, saved with the result so it can be replayed).
  const team = body.team ?? null;
  const level = body.level ?? 'hard';
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Only players with an account can join the leaderboard; their username is what's shown.
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const {data: auth} = token ? await db.auth.getUser(token) : {data: {user: null}};
  const user = auth?.user;
  if (!user) return json({error: 'Log in to join the leaderboard.'}, 401);
  const clientId = user.id; // one entry per account, per day, per level
  const name = String(user.user_metadata?.username ?? '').slice(0, 10);

  // Only today's island (or yesterday's, for anyone finishing just after midnight UTC).
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  if (date !== today && date !== yesterday) return json({error: 'That island is closed.'}, 400);
  if (level === 'elite' || level === 'elite-hard') return submitElite(db, date, clientId, name, body, level === 'elite-hard' ? 'hard' : 'easy');
  if (!LEVELS.includes(level)) return json({error: 'Bad level.'}, 400);
  if (!name) return json({error: 'Your account has no username.'}, 400);
  if (!Array.isArray(log) || log.length === 0 || log.length > 3000) return json({error: 'Bad battle.'}, 400);

  const ownTeam = level === 'easy' && isV2(date);
  if (ownTeam) {
    const err = teamError(team, EASY_OPTIONS, [100, 100, 100, 100, 100, 100]);
    if (err) return json({error: err}, 400);
  }
  const check = (legacy: boolean) => {
    try {
      const b = Battle.replay(generateDay(date, date, level, ownTeam && !legacy ? team : undefined, legacy), log);
      // Every action must have been legal, and the battle must be over.
      return b.log.length === log.length && b.winner ? b : null;
    } catch { return null; }
  };
  let battle = check(false);
  // The switch-over day: a battle played on the old rules (old version of the site) still counts, as legacy.
  const legacy = !battle && date === V2_FROM;
  if (legacy) battle = check(true);
  if (!battle) return json({error: 'Battle did not check out.'}, 400);

  const mons = battle.sides.player.team;
  const row = {
    day: date,
    day_number: generateDay(date).number,
    level,
    client_id: clientId,
    name,
    won: battle.winner === 'player',
    mons_left: mons.filter(m => m.hp > 0).length,
    turns: battle.turn,
    log,
    ...(ownTeam && !legacy ? {team: {mons: team.mons, bag: team.bag ?? {}}} : {}),
    legacy,
  };

  const {error} = await db.from('results').insert(row);
  // A new-system result replaces this player's old-system one from earlier that day (kept, but hidden).
  if (!error && !legacy) await db.from('results').update({replaced: true}).eq('day', date).eq('level', level).eq('client_id', clientId).eq('legacy', true);
  if (error) {
    if (error.code === '23505') return json({error: 'Already submitted this level today.'}, 409);
    return json({error: 'Could not save.'}, 500);
  }

  // Rank: wins first, then most POKéMON left, then fewest turns, then who finished first.
  const {data} = await db.from('results').select('won, mons_left, turns, client_id, created_at')
    .eq('day', date).eq('level', level).eq('replaced', false)
    .order('won', {ascending: false}).order('mons_left', {ascending: false})
    .order('turns', {ascending: true}).order('created_at', {ascending: true})
    .limit(100000);
  const all = data ?? [];
  const rank = all.findIndex(r => r.client_id === clientId) + 1;
  return json({rank, total: all.length, won: row.won, left: row.mons_left, turns: row.turns});
});


/** An Elite Four run: replay all of it (team + one log per battle), then rank by rooms cleared → Pokémon left → turns. */
// deno-lint-ignore no-explicit-any
async function submitElite(db: any, date: string, clientId: string, name: string, body: any, mode: 'easy' | 'hard') {
  const logs = body.logs;
  // Hard: the day's random team (everyone gets the same one); Easy: the player's own legal team.
  const team = mode === 'hard' ? eliteHardTeam(date) : body.team;
  if (!name) return json({error: 'Your account has no username.'}, 400);
  const err = mode === 'hard' ? null : teamError(team, ELITE_OPTIONS, [100, 100, 100, 100, 100, 100]);
  if (err) return json({error: err}, 400);
  if (!Array.isArray(logs) || logs.length < 1 || logs.length > 5 || logs.some((l: unknown) => !Array.isArray(l) || l.length > 3000)) return json({error: 'Bad run.'}, 400);
  let run;
  try { run = replayElite(date, team, logs, mode); } catch { return json({error: 'Run did not check out.'}, 400); }
  if (!run.over) return json({error: 'Finish the run first.'}, 400);
  const row = {day: date, day_number: generateDay(date).number, level: ELITE_LEVEL[mode], client_id: clientId, name,
    won: run.won, mons_left: run.monsLeft, turns: run.turns, stage: run.cleared, items_used: run.itemsUsed, log: logs, team: {mons: team.mons, bag: team.bag ?? {}}};
  const {error} = await db.from('results').insert(row);
  if (error) return json({error: error.code === '23505' ? 'Already submitted a run today.' : 'Could not save.'}, error.code === '23505' ? 409 : 500);
  return json({stage: run.cleared, won: run.won});
}
