// Local stats & streaks (stored in this browser), plus the shareable result text.

import type {Battle} from './engine/battle';

export interface DayResult { won: boolean; left: number; turns: number; hp: number[]; v2?: boolean } // hp: % per mon, 0 = fainted

/** The switch-over day (new Fight Red went live mid-day): an old-system result for that day is dropped so it
 *  can be played again; the replay (marked v2) is the one that counts. */
const SWITCH_DAY = '2026-10-16';
function clean(s: Stats): Stats {
  const h = s.history?.[SWITCH_DAY];
  if (!h || h.v2) return s;
  const history = {...s.history};
  delete history[SWITCH_DAY];
  return {...fromHistory(history), maxStreak: s.maxStreak};
}
export interface Stats {
  played: number;
  wins: number;
  streak: number;
  maxStreak: number;
  lastDate: string | null;
  history: Record<string, DayResult>;
}

let KEY = 'pokebattles:stats';
/** Dev builds keep their own stats so testing doesn't touch real streaks. */
export function useStatsKey(key: string) {
  KEY = key;
}
const empty = (): Stats => ({played: 0, wins: 0, streak: 0, maxStreak: 0, lastDate: null, history: {}});

export function loadStats(): Stats {
  try {
    return clean({...empty(), ...JSON.parse(localStorage.getItem(KEY) ?? '{}')});
  } catch {
    return empty();
  }
}

function prevDay(date: string) {
  return new Date(Date.parse(date) - 864e5).toISOString().slice(0, 10);
}

export function resultOf(b: Battle): DayResult {
  const team = b.sides.player.team;
  return {
    won: b.winner === 'player',
    left: team.filter(m => m.hp > 0).length,
    turns: b.turn,
    hp: team.map(m => (m.hp === 0 ? 0 : Math.max(1, Math.round((m.hp / m.maxHp) * 100)))),
    ...(b.day.date >= SWITCH_DAY ? {v2: true} : {}),
  };
}

/** Records today's finished battle once. */
export function recordResult(date: string, r: DayResult): Stats {
  const s = loadStats();
  if (s.history[date]) return s;
  s.history[date] = r;
  s.played++;
  if (r.won) {
    s.wins++;
    s.streak = s.lastDate === prevDay(date) && s.history[prevDay(date)]?.won ? s.streak + 1 : 1;
    s.maxStreak = Math.max(s.maxStreak, s.streak);
  } else {
    s.streak = 0;
  }
  s.lastDate = date;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* storage blocked */ }
  return s;
}

/** Current streak, counting a missed day as a break. */
export function currentStreak(s: Stats, today: string) {
  if (!s.lastDate) return 0;
  return s.lastDate === today || s.lastDate === prevDay(today) ? s.streak : 0;
}

export function shareText(dayNumber: number, level: string, r: DayResult, url: string): string {
  const squares = r.hp.map(p => (p === 0 ? '⬛' : p > 50 ? '🟩' : p > 20 ? '🟨' : '🟥')).join('');
  const tag = `DailyBattles #${dayNumber} ${level.toUpperCase()}`;
  const head = r.won ? `${tag} ✅ ${r.left}/6 left` : `${tag} ❌ Red won`;
  return `${head}\n${squares}\n⚔️ ${r.turns} turns\n${url}`;
}

/** One message for the whole day: every difficulty on its own line. */
export function dayShareText(dayNumber: number, results: Record<string, DayResult | undefined>, url: string): string {
  const squares = (r: DayResult) => r.hp.map(p => (p === 0 ? '⬛' : p > 50 ? '🟩' : p > 20 ? '🟨' : '🟥')).join('');
  const levels = Object.keys(results);
  const done = levels.filter(l => results[l]);
  const wins = done.filter(l => results[l]!.won).length;
  const pad = Math.max(...levels.map(l => l.length));
  const lines = levels.map(l => {
    const r = results[l];
    const name = l.toUpperCase().padEnd(pad, ' ');
    if (!r) return `${name} ⏳ not played yet`;
    return `${name} ${r.won ? '✅' : '❌'} ${squares(r)}${r.won ? ` ${r.left}/6` : ''}`;
  });
  return `DailyBattles #${dayNumber} · ${wins}/${levels.length} beaten\n${lines.join('\n')}\n${url}`;
}

/** Reads / writes one stats record by its storage key (used when syncing with the account). */
export function loadStatsAt(key: string): Stats {
  try {
    return clean({...empty(), ...JSON.parse(localStorage.getItem(key) ?? '{}')});
  } catch {
    return empty();
  }
}
export function saveStatsAt(key: string, s: Stats) {
  try { localStorage.setItem(key, JSON.stringify(s)); } catch { /* storage blocked */ }
}

/** Rebuilds the totals and streaks from a day-by-day history. */
export function fromHistory(history: Record<string, DayResult>): Stats {
  const s = empty();
  s.history = history;
  let prev: string | null = null;
  for (const date of Object.keys(history).sort()) {
    const r = history[date];
    s.played++;
    if (r.won) {
      s.wins++;
      s.streak = prev && prevDay(date) === prev && history[prev]?.won ? s.streak + 1 : 1;
      s.maxStreak = Math.max(s.maxStreak, s.streak);
    } else {
      s.streak = 0;
    }
    prev = date;
    s.lastDate = date;
  }
  return s;
}

/** Combines two histories (e.g. this device and the account); a day already recorded is kept as is. */
export function mergeStats(a: Stats, b: Stats): Stats {
  return clean(fromHistory({...clean(b).history, ...clean(a).history}));
}
