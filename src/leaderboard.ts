// Talks to the Supabase leaderboard.

import {SUPABASE_URL, SUPABASE_KEY} from './config';
import type {Action} from './engine/battle';
import type {Level} from './engine/daily';
import {accessToken, currentUser} from './account';

export interface Entry { id: number; name: string; won: boolean; mons_left: number; turns: number; created_at: string }
export interface AllTimeEntry { name: string; played: number; wins: number; left: number; lastId: number; last: string }
export interface EntryMon { species: string; level: number; hp: number; moves: string[] }
export interface EntryDetail {
  id: number; name: string; day: string; dayNumber: number; level: Level;
  won: boolean; left: number; turns: number; team: EntryMon[]; red: EntryMon[];
  record: Record<Level, {played: number; wins: number}>; daysPlayed: number; daysWon: number;
}
export interface Submitted { name: string; rank: number; total: number }

const headers = {apikey: SUPABASE_KEY, 'Content-Type': 'application/json'};

function safeGet(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
}

export function submittedFor(date: string, level: Level): Submitted | null {
  try { return JSON.parse(safeGet(`pokebattles:submitted:${date}:${level}`) ?? 'null'); } catch { return null; }
}

/** Sends a finished battle to the leaderboard. Needs an account (the server shows its username). */
export async function submit(date: string, level: Level, log: Action[], team: unknown = null): Promise<Submitted> {
  const token = await accessToken();
  if (!token) throw new Error('Log in to join the leaderboard.');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/submit`, {
    method: 'POST', headers: {...headers, Authorization: `Bearer ${token}`}, body: JSON.stringify({date, level, log, ...(team ? {team} : {})}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Could not reach the server.');
  const out: Submitted = {name: currentUser()?.username ?? '', rank: body.rank, total: body.total};
  safeSet(`pokebattles:submitted:${date}:${level}`, JSON.stringify(out));
  return out;
}

export async function fetchTop(date: string, level: Level, limit = 10): Promise<{entries: Entry[]; total: number}> {
  const q = `day=eq.${date}&level=eq.${level}&replaced=is.false&select=id,name,won,mons_left,turns,created_at&order=won.desc,mons_left.desc,turns.asc,created_at.asc&limit=${limit}`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/results?${q}`, {headers: {...headers, Prefer: 'count=exact'}});
  if (!res.ok) throw new Error('Could not load the leaderboard.');
  const range = res.headers.get('content-range') ?? '';
  const total = Number(range.split('/')[1]) || 0;
  return {entries: await res.json(), total};
}

/** Every result on a difficulty, added up per trainer: most wins first, then win rate, then Pokémon left. */
export async function fetchAllTime(level: Level, limit = 100000): Promise<{entries: AllTimeEntry[]; total: number}> {
  // One row per trainer, added up on the server (alltime_red, refreshed every 10 minutes).
  const res = await fetch(`${SUPABASE_URL}/rest/v1/alltime_red?level=eq.${level}&select=name,played,wins,left_sum,last_id,last_at&limit=100000`, {headers});
  if (!res.ok) throw new Error('Could not load the leaderboard.');
  const rows: {name: string; played: number; wins: number; left_sum: number; last_id: number; last_at: string}[] = await res.json();
  const all: AllTimeEntry[] = rows.map(r => ({name: r.name, played: r.played, wins: r.wins, left: r.left_sum, lastId: r.last_id, last: r.last_at}))
    .sort((a, b) => b.wins - a.wins || b.wins / b.played - a.wins / a.played || b.left - a.left);
  return {entries: all.slice(0, limit), total: all.length};
}

/** One trainer's battle (replayed on the server): their team, Red's team and their record. */
export async function fetchEntry(id: number): Promise<EntryDetail> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/entry`, {method: 'POST', headers, body: JSON.stringify({id})});
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Could not load that battle.');
  return body;
}

export interface EliteEntry {
  mode?: 'easy' | 'hard';
  id: number; name: string; day: string; dayNumber: number; won: boolean; stage: number; left: number; turns: number;
  team: {species: string; level: number; moves: string[]; hp: number}[];
  bag: Record<string, number>; used: Record<string, number>; itemsUsed: number;
  rooms: {foe: string; won: boolean; turns: number; left: number; foeLeft: number}[];
  record: {runs: number; champion: number; best: number};
}
/** One Elite Four run (replayed on the server). */
export async function fetchEliteEntry(id: number): Promise<EliteEntry> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/entry`, {method: 'POST', headers, body: JSON.stringify({elite: id})});
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Could not load that run.');
  return body;
}

const hpCache = new Map<number, number[]>();
/** Each result's team HP % at the end of the battle (for the leaderboard's health balls). */
export async function fetchHp(ids: number[]): Promise<Map<number, number[]>> {
  const need = [...new Set(ids)].filter(id => !hpCache.has(id));
  for (let i = 0; i < need.length; i += 80) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/entry`, {method: 'POST', headers, body: JSON.stringify({ids: need.slice(i, i + 80)})});
    const body = await res.json().catch(() => ({}));
    for (const [k, v] of Object.entries((body.hp ?? {}) as Record<string, number[]>)) hpCache.set(Number(k), v);
  }
  return hpCache;
}

let trainersCache: Promise<Record<string, string>> | null = null;
/** Each player's chosen trainer picture by lowercase username (cached for this visit). */
export function fetchTrainers(fresh = false): Promise<Record<string, string>> {
  if (!trainersCache || fresh) {
    trainersCache = fetch(`${SUPABASE_URL}/functions/v1/flags?trainers=1`, {headers: {apikey: SUPABASE_KEY}, cache: 'no-store'})
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return trainersCache;
}

let badgesCache: Promise<Record<string, string[]>> | null = null;
/** Each player's equipped badges (up to 4) by lowercase username (cached for this visit). */
export function fetchBadges(fresh = false): Promise<Record<string, string[]>> {
  if (!badgesCache || fresh) {
    badgesCache = fetch(`${SUPABASE_URL}/functions/v1/flags?badges=1`, {headers: {apikey: SUPABASE_KEY}, cache: 'no-store'})
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return badgesCache;
}

let flagsCache: Promise<Record<string, string>> | null = null;
/** Each player's country code by lowercase username (cached for this visit). */
export function fetchFlags(fresh = false): Promise<Record<string, string>> {
  if (!flagsCache || fresh) {
    flagsCache = fetch(`${SUPABASE_URL}/functions/v1/flags`, {headers: {apikey: SUPABASE_KEY}, cache: 'no-store'})
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return flagsCache;
}

/** My own finished battles on a day (any device), with their logs: so a second device knows they're done. */
export async function fetchMine(date: string): Promise<{level: Level; log: Action[]; team: unknown}[]> {
  const token = await accessToken();
  if (!token) return [];
  const res = await fetch(`${SUPABASE_URL}/functions/v1/entry`, {
    method: 'POST', headers: {...headers, Authorization: `Bearer ${token}`}, body: JSON.stringify({mine: date}),
  });
  if (!res.ok) return [];
  return (await res.json()).battles ?? [];
}

/** Sends a finished Elite Four run (the server replays all of it). */
export async function submitElite(date: string, team: unknown, logs: Action[][], level: string = 'elite'): Promise<void> {
  const token = await accessToken();
  if (!token) throw new Error('Log in to join the leaderboard.');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/submit`, {
    method: 'POST', headers: {...headers, Authorization: `Bearer ${token}`}, body: JSON.stringify({date, level, team, logs}),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not reach the server.');
}
