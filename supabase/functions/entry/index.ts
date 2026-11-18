// Supabase Edge Function: details of one leaderboard entry, for the "view a trainer" page.
// Battle logs stay private; this replays the saved battle here and returns only a summary:
// the trainer's team (in their order) with HP left, Red's team, and the trainer's overall record.

import {createClient} from 'npm:@supabase/supabase-js@2';
import {generateDay, Battle, replayElite, ELITE, eliteHardTeam} from './engine.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {...cors, 'Content-Type': 'application/json'}});

const pct = (hp: number, max: number) => (hp === 0 ? 0 : Math.max(1, Math.round((hp / max) * 100)));

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: cors});
  if (req.method !== 'POST') return json({error: 'POST only'}, 405);
  let id: number;
  let body: any;
  try {
    body = await req.json();
    id = Number(body.id);
  } catch {
    return json({error: 'Bad request.'}, 400);
  }

  // {mine: date} (logged in): my own finished battles that day, with their logs, so another device of mine
  // knows they're done (one try per day per account, not per device).
  if (typeof body.mine === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.mine)) {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const {data: auth} = token.split('.').length === 3 ? await db.auth.getUser(token) : {data: {user: null}};
    if (!auth?.user) return json({error: 'Log in first.'}, 401);
    const {data: rows} = await db.from('results').select('level, log, team').eq('client_id', auth.user.id).eq('day', body.mine).eq('legacy', false);
    return json({battles: rows ?? []}, 200);
  }

  // Leaderboard rows: {ids: [...]} → each trainer's team HP % at the end (in their team order), for the health balls.
  if (Array.isArray(body.ids)) {
    const ids = body.ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0).slice(0, 80);
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const {data: rows} = ids.length ? await db.from('results').select('id, day, level, log, team, legacy').in('id', ids) : {data: []};
    const hp: Record<number, number[]> = {};
    for (const r of rows ?? []) {
      try {
        const b = Battle.replay(generateDay(r.day, r.day, r.level, r.team ?? undefined, !!r.legacy), r.log);
        hp[r.id] = b.sides.player.team.map(m => pct(m.hp, m.maxHp));
      } catch { /* skip */ }
    }
    return json({hp}, 200);
  }

  // {elite: id}: one Elite Four run — the team they built (with moves), how each room went, the items they took and used.
  if (body.elite !== undefined) {
    const eid = Number(body.elite);
    if (!Number.isInteger(eid) || eid <= 0) return json({error: 'Bad id.'}, 400);
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const {data: row} = await db.from('results').select('id, day, day_number, level, client_id, name, won, mons_left, turns, stage, log, team').eq('id', eid).in('level', ['elite', 'elite-hard']).maybeSingle();
    if (!row) return json({error: 'That run was not found.'}, 404);
    // deno-lint-ignore no-explicit-any
    let run: any;
    const mode = row.level === 'elite-hard' ? 'hard' : 'easy';
    try { run = replayElite(row.day, mode === 'hard' ? eliteHardTeam(row.day) : row.team, row.log, mode); } catch { return json({error: 'Could not load that run.'}, 500); }
    const rooms = run.battles.map((b: Battle, i: number) => ({
      foe: ELITE[i].name, won: b.winner === 'player', turns: b.turn,
      left: b.sides.player.team.filter(m => m.hp > 0).length,
      foeLeft: b.sides.red.team.filter(m => m.hp > 0).length,
    }));
    const used: Record<string, number> = {};
    for (const b of run.battles as Battle[]) for (const a of b.log) if (a.type === 'item') used[a.item] = (used[a.item] ?? 0) + 1;
    const last = run.battles[run.battles.length - 1] as Battle | undefined;
    const team = (row.team.mons as {species: string; moves: string[]}[]).map(m => {
      const now = last?.sides.player.team.find(x => x.species === m.species);
      return {species: m.species, level: 100, moves: m.moves, hp: now ? pct(now.hp, now.maxHp) : 100};
    });
    const {data: all} = await db.from('results').select('won, stage').eq('client_id', row.client_id).eq('level', row.level).limit(5000);
    const record = {runs: all?.length ?? 0, champion: (all ?? []).filter(r => r.won).length, best: Math.max(0, ...(all ?? []).map(r => r.stage ?? 0))};
    return json({mode, id: row.id, name: row.name, day: row.day, dayNumber: row.day_number, won: row.won, stage: row.stage, left: row.mons_left,
      turns: row.turns, team, bag: row.team.bag ?? {}, used, itemsUsed: run.itemsUsed, rooms, record});
  }

  if (!Number.isInteger(id) || id <= 0) return json({error: 'Bad id.'}, 400);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const {data: row} = await db.from('results').select('id, day, day_number, level, client_id, name, won, mons_left, turns, log, team, legacy').eq('id', id).maybeSingle();
  if (!row) return json({error: 'That result was not found.'}, 404);

  let battle: Battle;
  try {
    battle = Battle.replay(generateDay(row.day, row.day, row.level, row.team ?? undefined, !!row.legacy), row.log);
  } catch {
    return json({error: 'Could not load that battle.'}, 500);
  }
  const side = (s: 'player' | 'red') => battle.sides[s].team.map(m => ({species: m.species, level: m.level, hp: pct(m.hp, m.maxHp), moves: m.moves}));

  // The trainer's record across every day, per difficulty (same account).
  const {data: all} = await db.from('results').select('day, level, won').eq('client_id', row.client_id).eq('replaced', false).limit(5000);
  const record: Record<string, {played: number; wins: number}> = {easy: {played: 0, wins: 0}, medium: {played: 0, wins: 0}, hard: {played: 0, wins: 0}};
  const days = new Set<string>(), wonDays = new Set<string>();
  for (const r of all ?? []) {
    const rec = record[r.level];
    if (!rec) continue;
    rec.played++;
    days.add(r.day);
    if (r.won) { rec.wins++; wonDays.add(r.day); }
  }

  return json({
    id: row.id, name: row.name, day: row.day, dayNumber: row.day_number, level: row.level,
    won: row.won, left: row.mons_left, turns: row.turns,
    team: side('player'), red: side('red'),
    record, daysPlayed: days.size, daysWon: wonDays.size,
  });
});
