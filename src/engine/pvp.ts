// Friend battles (PvP): match options, the Gen 1 TM/HM list, default movesets by level,
// and the rules that decide whether a picked team is legal. Pure logic (also used by the server).

import {SPECIES, MOVES, LEARNSETS, LATER_MOVES, LATER_LEARNERS} from './data';
import EXTRA_TMS_JSON from '../data/extratms.json';
/** Team-builder only (friend battles, Easy): never used for the random daily teams, so those stay unchanged. */
const EXTRA_TMS: Record<string, string[]> = {...(EXTRA_TMS_JSON as Record<string, string[]>), ...LATER_LEARNERS};
import learnLevelsJson from '../data/learnlevels.json';
import {calcStats, type Mon} from './daily';
import {hashString, mulberry32, type Rng} from './rng';

/** [level, move] pairs, sorted by level: the moves each species learns by levelling up. */
export const LEARN_LEVELS = learnLevelsJson as unknown as Record<string, [number, string][]>;

/** Gen 1 TMs 1–50 and HMs 1–5, in order. */
export const TMS: {id: string; label: string; hm: boolean}[] = [
  'megapunch', 'razorwind', 'swordsdance', 'whirlwind', 'megakick', 'toxic', 'horndrill', 'bodyslam', 'takedown', 'doubleedge',
  'bubblebeam', 'watergun', 'icebeam', 'blizzard', 'hyperbeam', 'payday', 'submission', 'counter', 'seismictoss', 'rage',
  'megadrain', 'solarbeam', 'dragonrage', 'thunderbolt', 'thunder', 'earthquake', 'fissure', 'dig', 'psychic', 'teleport',
  'mimic', 'doubleteam', 'reflect', 'bide', 'metronome', 'selfdestruct', 'eggbomb', 'fireblast', 'swift', 'skullbash',
  'softboiled', 'dreameater', 'skyattack', 'rest', 'thunderwave', 'psywave', 'explosion', 'rockslide', 'triattack', 'substitute',
].map((id, i) => ({id, label: `TM${String(i + 1).padStart(2, '0')}`, hm: false}))
  .concat(['cut', 'fly', 'surf', 'strength', 'flash'].map((id, i) => ({id, label: `HM0${i + 1}`, hm: true})))
  // Extra TMs (not in Gen 1): moves Gen 1 Pokémon can learn in some Pokémon game (level-up, TM, tutor or
  // breeding, any generation), from Pokémon Showdown's learnsets. Only those Pokémon can be taught them.
  .concat(Object.keys(EXTRA_TMS_JSON).sort((a, b) => (a === 'flamethrower' ? -1 : b === 'flamethrower' ? 1 : MOVES[a].name.localeCompare(MOVES[b].name)))
    // Then moves from later games (Dragon Claw, Shadow Ball…), numbered after the others.
    .concat([...LATER_MOVES].sort((a, b) => MOVES[a].name.localeCompare(MOVES[b].name)))
    .map((id, i) => ({id, label: `TM${51 + i}`, hm: false})));
const TM_BY_MOVE = new Map<string, {id: string; label: string; hm: boolean}>();
export const tmFor = (move: string) => {
  if (!TM_BY_MOVE.size) TMS.forEach(t => TM_BY_MOVE.set(t.id, t));
  return TM_BY_MOVE.get(move) ?? null;
};

export const LEVEL_CHOICES = [30, 50, 70, 100] as const;
export type Who = 'off' | 'both' | 'host' | 'guest';

export interface Clauses { sleep: boolean; freeze: boolean; ohko: boolean; evasion: boolean; trap: boolean; species: boolean; gen1?: boolean } // gen1: only original Gen 1 moves
export interface MatchOptions {
  level: 30 | 50 | 70 | 100 | 'random';
  randomTeams: Who;
  randomLevels: Who;
  items: number; // 0–6 items per player
  tms: number | null; // null = unlimited TM uses
  clauses: Clauses;
  timer: 0 | 30 | 60; // seconds per turn, 0 = off
}

export const DEFAULT_OPTIONS: MatchOptions = {
  level: 50, randomTeams: 'off', randomLevels: 'off', items: 3, tms: 4,
  clauses: {sleep: true, freeze: true, ohko: true, evasion: true, trap: true, species: true}, timer: 60,
};

export const BANNED = {
  ohko: ['fissure', 'horndrill', 'guillotine'],
  evasion: ['doubleteam', 'minimize'],
  trap: ['wrap', 'bind', 'firespin', 'clamp'],
};

/** Items players may bring (no Full Restore spam: it isn't on the list). */
export const PVP_ITEMS = ['POTION', 'SUPER POTION', 'HYPER POTION', 'MAX POTION', 'REVIVE', 'FULL HEAL', 'ANTIDOTE',
  'PARLYZ HEAL', 'AWAKENING', 'BURN HEAL', 'ICE HEAL', 'X ATTACK', 'X DEFEND', 'X SPEED', 'X SPECIAL', 'X ACCURACY',
  'GUARD SPEC.', 'DIRE HIT', 'ETHER', 'ELIXER'];

/** Moves a species knows by `level` through levelling up (any of these can be kept without a TM). */
export function levelUpMovesAt(species: string, level: number): string[] {
  const seen: string[] = [];
  for (const [lv, move] of LEARN_LEVELS[species] ?? []) if (lv <= level && !seen.includes(move)) seen.push(move);
  return seen;
}

/** The moveset a Pokémon of this level would really have: the last 4 moves learned by levelling up. */
export function defaultMoveset(species: string, level: number): string[] {
  const learned: string[] = [];
  for (const [lv, move] of LEARN_LEVELS[species] ?? []) {
    if (lv > level || learned.includes(move)) continue;
    learned.push(move);
    if (learned.length > 4) learned.shift();
  }
  return learned.length ? learned : ['struggle'];
}

/** True if the match rules ban this move. */
export function isBanned(move: string, c: Clauses): boolean {
  return (c.ohko && BANNED.ohko.includes(move)) || (c.evasion && BANNED.evasion.includes(move)) || (c.trap && BANNED.trap.includes(move))
    || (!!c.gen1 && LATER_MOVES.includes(move));
}

/** True if a move does damage (including fixed-damage moves like Seismic Toss). */
export const isAttack = (m: string) => {
  const mv = MOVES[m];
  return !!mv && mv.category !== 'Status' && (mv.power > 0 || mv.damage !== undefined || !!mv.ohko || m === 'counter' || m === 'bide');
};

/** How good an attack is for a starting moveset: power × accuracy, ×1.5 for its own type;
 *  self-KO moves count for little. */
function attackScore(species: string, level: number, m: string): number {
  const mv = MOVES[m];
  const power = mv.damage === 'level' ? level : typeof mv.damage === 'number' ? mv.damage : mv.ohko ? 60 : mv.power || 40;
  const stab = SPECIES[species].types.includes(mv.type) ? 1.5 : 1;
  return power * ((mv.acc ?? 100) / 100) * stab * (mv.selfdestruct ? 0.3 : 1);
}

/** The moves a picked Pokémon starts with: its newest level-up moves (as in the games), minus anything
 *  the rules ban, but always with at least 2 attacks when it can learn them by levelling up (its best ones,
 *  one of its own type where possible), so no one starts a friend battle unable to hurt the foe.
 *  Abra, Metapod, Kakuna and Ditto learn no attacks by levelling up and keep their natural moves. */
/** A full 4-move set for the daily random teams: the strongest attacks it can learn (level-up or TM/HM),
 *  own type first, then different types for coverage, plus a sleep/paralysis move if it has one. */
const DISABLING = ['spore', 'lovelykiss', 'sleeppowder', 'hypnosis', 'sing', 'thunderwave', 'stunspore', 'glare'];
const UTILITY = ['swordsdance', 'amnesia', 'agility', 'recover', 'softboiled', 'rest', 'reflect', 'lightscreen', 'substitute', 'toxic', 'leechseed', 'confuseray', 'growth', 'barrier', 'acidarmor'];
/** With `rng` (daily teams), picks vary from day to day among the good options; without it, always the best. */
export function bestMoves(species: string, level: number, rng?: () => number): string[] {
  const all = [...new Set([...levelUpMovesAt(species, level), ...(LEARNSETS[species] ?? [])])].filter(m => MOVES[m] && !MOVES[m].ohko && m !== 'selfdestruct' && m !== 'explosion');
  // Moves that are weaker than they look: recharge, two-turn, only work on sleeping foes, fixed damage.
  const MEH: Record<string, number> = {hyperbeam: 0.55, solarbeam: 0.5, skyattack: 0.5, razorwind: 0.4, skullbash: 0.5, dig: 0.6, fly: 0.6,
    dreameater: 0.1, dragonrage: 0.5, sonicboom: 0.2, bide: 0.1, counter: 0.2, rage: 0.4, thrash: 0.7, petaldance: 0.7};
  const score = (m: string) => attackScore(species, level, m) * (MEH[m] ?? 1);
  const attacks = all.filter(isAttack).sort((x, y) => score(y) - score(x));
  if (!attacks.length) return all.slice(0, 4).length ? all.slice(0, 4) : ['struggle'];
  const top = score(attacks[0]);
  const types = SPECIES[species].types;
  const rand = (n: number) => (rng ? Math.floor(rng() * n) : 0);
  // One of the good moves in a group (within 70% of the best of them).
  const good = (group: string[]) => { const ok = group.filter(m => score(m) >= score(group[0]) * 0.7); return ok[rand(ok.length)]; };
  const out: string[] = [];
  const add = (m?: string) => { if (m && !out.includes(m) && out.length < 4) out.push(m); };
  // 1) An attack of its own type (if it has a decent one).
  const clean = attacks.filter(m => !MOVES[m].charge && m !== 'hyperbeam'); // recharge/two-turn moves only as a last resort
  const ownAll = attacks.filter(m => types.includes(MOVES[m].type)), ownClean = ownAll.filter(m => clean.includes(m));
  const own = ownClean.length && score(ownClean[0]) >= top * 0.4 ? ownClean : ownAll;
  add(own.length && score(own[0]) >= top * 0.4 ? good(own) : good(clean.length ? clean : attacks));
  // 2) Coverage: other types that hit reasonably hard, in a random order.
  const covTypes = [...new Set(clean.filter(m => score(m) >= top * 0.45).map(m => MOVES[m].type))].filter(t => !out.some(x => MOVES[x].type === t));
  for (let i = covTypes.length - 1; i > 0; i--) { const j = rand(i + 1); [covTypes[i], covTypes[j]] = [covTypes[j], covTypes[i]]; }
  // 3) One support move: sleep/paralysis usually, sometimes set-up, healing or screens.
  const disabling = DISABLING.filter(m => all.includes(m)), utility = UTILITY.filter(m => all.includes(m));
  // Thunder Wave is learnable by so many Pokémon that it only counts as half a pick.
  const pickDisabling = () => { const w = disabling.map(m => (m === 'thunderwave' ? 0.5 : 1)); let r = (rng ? rng() : 0) * w.reduce((a, b) => a + b, 0); return disabling.find((_, i) => (r -= w[i]) < 0) ?? disabling[0]; };
  const roll = rng ? rng() : 0;
  const support = disabling.length && roll < 0.35 ? pickDisabling() : utility.length && rng && roll < 0.55 ? utility[rand(utility.length)] : !rng && disabling.length ? disabling[0] : undefined;
  for (const t of covTypes) if (out.length < (support ? 3 : 4)) add(good(clean.filter(m => MOVES[m].type === t)));
  add(support);
  // Then a new type if there's a decent one, then the strongest left.
  for (const m of attacks) if (score(m) >= top * 0.3 && !out.some(x => MOVES[x].type === MOVES[m].type)) add(m);
  for (const m of attacks) add(m);
  for (const m of all) add(m);
  return withSignature(species, out, all);
}

/** Signature moves a Pokémon always starts with (if it can learn them). */
const ALWAYS: Record<string, string> = {snorlax: 'rest'};
function withSignature(species: string, moves: string[], learnable: string[]): string[] {
  const sig = ALWAYS[species];
  if (!sig || moves.includes(sig) || !learnable.includes(sig)) return moves;
  if (moves.length < 4) return [...moves, sig];
  // Replace a status move if there is one (keep the attacks), else the last move.
  const i = moves.findIndex(m => !isAttack(m));
  const out = [...moves];
  out[i >= 0 ? i : out.length - 1] = sig;
  return out;
}

export function startingMoves(species: string, level: number, c: Clauses): string[] {
  return withSignature(species, startingMovesBase(species, level, c), levelUpMovesAt(species, level).filter(m => !isBanned(m, c)));
}
function startingMovesBase(species: string, level: number, c: Clauses): string[] {
  const allowed = levelUpMovesAt(species, level).filter(m => !isBanned(m, c));
  if (!allowed.length) return ['struggle'];
  const newest = allowed.slice(-4);
  const attacks = allowed.filter(isAttack);
  const need = Math.min(2, attacks.length);
  const keep = new Set(newest.filter(isAttack));
  if (keep.size >= need) return newest;
  const best = [...attacks].sort((x, y) => attackScore(species, level, y) - attackScore(species, level, x));
  const types = SPECIES[species].types;
  while (keep.size < need) {
    const hasStab = [...keep].some(m => types.includes(MOVES[m].type));
    const next = (!hasStab && best.find(m => !keep.has(m) && types.includes(MOVES[m].type))) || best.find(m => !keep.has(m))!;
    keep.add(next);
  }
  // Fill the other slots with the newest status moves, keeping the order they were learned.
  for (const m of [...newest].reverse()) { if (keep.size >= 4) break; keep.add(m); }
  return allowed.filter(m => keep.has(m));
}

/** True if this species can be taught this TM/HM. */
export const canLearnTm = (species: string, move: string) => !!tmFor(move) && ((LEARNSETS[species] ?? []).includes(move) || !!EXTRA_TMS[move]?.includes(species)
);

/** True if the move needs a TM/HM for this Pokémon at this level (not known by levelling up yet). */
export const needsTm = (species: string, level: number, move: string) => !levelUpMovesAt(species, level).includes(move);

/** One picked Pokémon: species, level and up to 4 moves. */
export interface PickedMon { species: string; level: number; moves: string[] }
export interface PickedTeam { mons: PickedMon[]; bag: Record<string, number> }

/** TM uses on a team (HMs and moves known by levelling up are free). */
export function tmUses(team: PickedTeam): number {
  let n = 0;
  for (const m of team.mons) for (const mv of m.moves) if (needsTm(m.species, m.level, mv) && !tmFor(mv)?.hm) n++;
  return n;
}

const ALL_SPECIES = Object.keys(SPECIES);

/** Checks a picked team against the match options. Returns a plain-English problem, or null if it's fine. */
export function teamError(team: PickedTeam, o: MatchOptions, levelsFixed?: number[]): string | null {
  if (!Array.isArray(team?.mons) || team.mons.length !== 6) return 'Pick 6 Pokémon.';
  const seen = new Set<string>();
  for (const [i, m] of team.mons.entries()) {
    const sp = SPECIES[m.species];
    if (!sp) return 'Unknown Pokémon.';
    const name = sp.name;
    if (o.clauses.species && seen.has(m.species)) return `Only one ${name} allowed (Species Clause).`;
    seen.add(m.species);
    const wantLevel = levelsFixed?.[i] ?? (o.level === 'random' ? null : o.level);
    if (wantLevel !== null && m.level !== wantLevel) return `${name} must be level ${wantLevel}.`;
    if (!Number.isInteger(m.level) || m.level < 30 || m.level > 100) return `${name}: level must be 30–100.`;
    if (!Array.isArray(m.moves) || m.moves.length < 1 || m.moves.length > 4) return `${name} needs 1 to 4 moves.`;
    if (new Set(m.moves).size !== m.moves.length) return `${name} can't know the same move twice.`;
    for (const mv of m.moves) {
      const move = MOVES[mv];
      if (!move) return `${name}: unknown move.`;
      if (mv === 'struggle') continue;
      if (needsTm(m.species, m.level, mv) && !canLearnTm(m.species, mv)) return `${name} can't learn ${move.name}.`;
      if (o.clauses.ohko && BANNED.ohko.includes(mv)) return `${move.name} is banned (OHKO Clause).`;
      if (o.clauses.evasion && BANNED.evasion.includes(mv)) return `${move.name} is banned (Evasion Clause).`;
      if (o.clauses.trap && BANNED.trap.includes(mv)) return `${move.name} is banned (Trapping Clause).`;
      if (o.clauses.gen1 && LATER_MOVES.includes(mv)) return `${move.name} isn't allowed (Gen 1 moves only).`;
    }
  }
  if (o.tms !== null && tmUses(team) > o.tms) return `Too many TMs: ${tmUses(team)} used, ${o.tms} allowed.`;
  const items = Object.entries(team.bag ?? {});
  const count = items.reduce((n, [, c]) => n + c, 0);
  if (count > o.items) return `Too many items: ${count} picked, ${o.items} allowed.`;
  for (const [item, c] of items) {
    if (!PVP_ITEMS.includes(item)) return `${item} isn't allowed.`;
    if (!Number.isInteger(c) || c < 1) return 'Bad item count.';
  }
  return null;
}

// ---------- randomising (deterministic from the match seed) ----------

export const isRandomFor = (who: Who, side: 'host' | 'guest') => who === 'both' || who === side;

/** Levels each player's 6 Pokémon must have (fixed, or random 30–100 per Pokémon when randomised). */
export function levelsFor(o: MatchOptions, seed: string, side: 'host' | 'guest'): number[] {
  const rng = mulberry32(hashString(`pokebattles:pvp:levels:${seed}:${side}`));
  const random = o.level === 'random' || isRandomFor(o.randomLevels, side);
  return Array.from({length: 6}, () => (random ? 30 + Math.floor(rng() * 71) : o.level as number));
}

/** A random legal team for a player (used when "Random teams" is on for them). */
export function randomTeam(o: MatchOptions, seed: string, side: 'host' | 'guest'): PickedTeam {
  const rng: Rng = mulberry32(hashString(`pokebattles:pvp:team:${seed}:${side}`));
  const levels = levelsFor(o, seed, side);
  const pool = [...ALL_SPECIES];
  const mons: PickedMon[] = [];
  while (mons.length < 6) {
    const sp = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    const level = levels[mons.length];
    const moves = startingMoves(sp, level, o.clauses);
    if (moves[0] === 'struggle') continue;
    mons.push({species: sp, level, moves});
  }
  return {mons, bag: {}};
}

/** Turns a picked team into battle-ready Pokémon: perfect DVs and max stat exp (fair for both players). */
export function toMons(team: PickedTeam): Mon[] {
  const dvs = {atk: 15, def: 15, spe: 15, spc: 15};
  return team.mons.map(m => ({species: m.species, level: m.level, moves: [...m.moves], dvs, stats: calcStats(m.species, m.level, dvs)}));
}
