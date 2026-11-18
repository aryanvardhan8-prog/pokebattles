// Builds the day's teams and bags from the date. Same date → same day for everyone.
import {SPECIES, MOVES, LEARNSETS, LEVEL_MOVES, type Stats} from './data';
import {rngFor, int, pick, shuffle, type Rng} from './rng';
import {bestMoves, toMons, type MatchOptions, type PickedTeam} from './pvp';

export const LAUNCH_DAY = '2026-10-12';

export interface Mon {
  species: string;
  level: number;
  moves: string[];
  dvs: Omit<Stats, 'hp'>;
  stats: Stats; // max stats at this level
  /** Elite Four: HP, PP and status carried over from the previous battle of the run. */
  start?: {hp: number; pp: number[]; status: string | null; sleep: number};
}

export interface Bag { [item: string]: number }

export interface Day {
  date: string;
  /** What the randomness comes from: the date on the live game, a random string in dev builds. */
  seed: string;
  level: AnyLevel;
  number: number;
  /** Red plays well (true) or picks moves at random. */
  smartAI: boolean;
  /** Red's stronger brain (from V2_FROM, Medium and Hard). */
  expertAI?: boolean;
  /** Hyper Beam always needs a recharge turn, even after a knock-out (later-games rule; from RECHARGE_FROM). */
  alwaysRecharge?: boolean;
  /** 100% moves never miss (no Gen 1 1-in-256 miss), from NO_MISS_FROM. */
  sureHit?: boolean;
  /** Red won't use a sleep move while this many of your Pokémon are already asleep (from V3_FROM). */
  sleepCap?: number;
  /** Who you're fighting, if not Red (Elite Four), e.g. "LORELEI". */
  foeName?: string;
  player: {team: Mon[]; bag: Bag};
  red: {team: Mon[]; bag: Bag};
}

// Moves that do damage (incl. fixed-damage moves with power 0 in data).
const FIXED_DAMAGE = new Set(['seismictoss', 'nightshade', 'dragonrage', 'sonicboom', 'superfang', 'psywave']);
const isAttack = (id: string) => MOVES[id].power > 1 || FIXED_DAMAGE.has(id) || !!MOVES[id].ohko;

// Every species can appear. Ones with fewer than 2 attacking moves (Magikarp, Ditto,
// Metapod…) are rarer, and a team can have at most one of them.
export const ALL_SPECIES = Object.keys(SPECIES);
export const WEAK_SPECIES = new Set(ALL_SPECIES.filter(id => LEARNSETS[id].filter(isAttack).length < 2));
const WEAK_WEIGHT = 0.25;

function pickTeam(rng: Rng, taken: Set<string>): string[] {
  const team: string[] = [];
  while (team.length < 6) {
    const hasWeak = team.some(s => WEAK_SPECIES.has(s));
    const options = ALL_SPECIES.filter(s => !taken.has(s) && !(hasWeak && WEAK_SPECIES.has(s)));
    const weight = (s: string) => (WEAK_SPECIES.has(s) ? WEAK_WEIGHT : 1);
    let roll = rng() * options.reduce((sum, s) => sum + weight(s), 0);
    const choice = options.find(s => (roll -= weight(s)) < 0) ?? options[options.length - 1];
    team.push(choice);
    taken.add(choice);
  }
  return team;
}

export const PLAYER_ITEMS: Record<string, [number, number]> = {
  'POTION': [1, 3], 'SUPER POTION': [1, 3], 'HYPER POTION': [1, 2], 'MAX POTION': [1, 1],
  'FULL RESTORE': [1, 1], 'REVIVE': [1, 2], 'FULL HEAL': [1, 2], 'ANTIDOTE': [1, 2],
  'PARLYZ HEAL': [1, 2], 'AWAKENING': [1, 2], 'BURN HEAL': [1, 1], 'ICE HEAL': [1, 1],
  'X ATTACK': [1, 2], 'X DEFEND': [1, 2], 'X SPEED': [1, 2], 'X SPECIAL': [1, 2],
  'X ACCURACY': [1, 1], 'GUARD SPEC.': [1, 1], 'DIRE HIT': [1, 1], 'ETHER': [1, 2], 'ELIXER': [1, 1],
};

export function dayNumber(date: string): number {
  return Math.round((Date.parse(date) - Date.parse(LAUNCH_DAY)) / 86400000) + 1;
}

export function todayUTC(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// Gen 1 stat formula. Stat Exp maxed (65535) on both sides, like Stadium.
export function calcStats(species: string, level: number, dvs: Omit<Stats, 'hp'>, statExp = 65535): Stats {
  const base = SPECIES[species].base;
  const hpDv = ((dvs.atk & 1) << 3) | ((dvs.def & 1) << 2) | ((dvs.spe & 1) << 1) | (dvs.spc & 1);
  // The game's square root is capped at 255, so max Stat Exp adds 63.
  const expBonus = Math.floor(Math.min(255, Math.ceil(Math.sqrt(statExp))) / 4);
  const core = (b: number, dv: number) => Math.floor(((b + dv) * 2 + expBonus) * level / 100);
  return {
    hp: core(base.hp, hpDv) + level + 10,
    atk: core(base.atk, dvs.atk) + 5,
    def: core(base.def, dvs.def) + 5,
    spc: core(base.spc, dvs.spc) + 5,
    spe: core(base.spe, dvs.spe) + 5,
  };
}

/**
 * Daily movesets: 2 moves the Pokémon learns by levelling up (one of them an attack of
 * its own type, when it has one), plus 2 random TM/HM moves it can learn.
 * Pokémon with tiny movepools just get what they have (Magikarp, Ditto...).
 */
function pickMoves(rng: Rng, species: string): string[] {
  const types = SPECIES[species].types;
  const natural = LEVEL_MOVES[species];
  const tms = LEARNSETS[species].filter(m => !natural.includes(m));
  const chosen: string[] = [];
  const take = (pool: string[]) => {
    const options = pool.filter(m => !chosen.includes(m));
    if (options.length) chosen.push(pick(rng, options));
  };
  const ownTypeAttack = (m: string) => types.includes(MOVES[m].type) && isAttack(m);

  // 1) A natural attack of its own type (else from TMs, else any natural attack).
  if (natural.some(ownTypeAttack)) take(natural.filter(ownTypeAttack));
  else if (tms.some(ownTypeAttack)) take(tms.filter(ownTypeAttack));
  else take(natural.filter(isAttack));
  // 2) One more natural move.
  take(natural);
  // 3–4) Two TM/HM moves.
  take(tms);
  take(tms);
  // Not enough of one kind? Fill up from anything it can learn.
  while (chosen.length < 4 && LEARNSETS[species].some(m => !chosen.includes(m))) take(LEARNSETS[species]);
  return chosen;
}

function makeMon(rng: Rng, species: string, level: number): Mon {
  const dvs = {atk: int(rng, 0, 15), def: int(rng, 0, 15), spe: int(rng, 0, 15), spc: int(rng, 0, 15)};
  return {species, level, moves: pickMoves(rng, species), dvs, stats: calcStats(species, level, dvs)};
}

function makePlayerBag(rng: Rng): Bag {
  const bag: Bag = {};
  for (const item of shuffle(rng, Object.keys(PLAYER_ITEMS)).slice(0, int(rng, 4, 6))) {
    const [lo, hi] = PLAYER_ITEMS[item];
    bag[item] = int(rng, lo, hi);
  }
  return bag;
}

export type Level = 'easy' | 'medium' | 'hard';
export type AnyLevel = Level;
export const LEVELS: Level[] = ['easy', 'medium', 'hard'];
/** First day of "Red's real team": earlier days are rebuilt with the old rules so their replays stay identical. */
export const V2_FROM = '2026-10-16'; // went live mid-day; results posted earlier that day are `legacy` (old rules)
export const isV2 = (date: string) => date >= V2_FROM;

interface Rules { redLevels: [number, number]; playerLevel: number; smartAI: boolean; expertAI?: boolean; redBag: Bag; sleepCap?: number }
/** Old days (before V2_FROM): Red had a random team too, and so did you (Lv 50–58). */
const RULES_V1: Record<Level, Rules> = {
  easy: {redLevels: [46, 52], playerLevel: 0, smartAI: false, redBag: {}},
  medium: {redLevels: [50, 56], playerLevel: 0, smartAI: true, redBag: {'FULL RESTORE': 1}},
  hard: {redLevels: [54, 62], playerLevel: 0, smartAI: true, redBag: {'FULL RESTORE': 2}},
};
/** Now: Red's Mt. Silver team at Lv 100 on every level.
 *  Easy: you build your own team. Medium/Hard: a random team of strong Pokémon (Hard: lower level). */
export const LEVEL_RULES: Record<Level, Rules> = {
  easy: {redLevels: [100, 100], playerLevel: 100, smartAI: true, redBag: {'FULL RESTORE': 1}},
  medium: {redLevels: [100, 100], playerLevel: 100, smartAI: true, expertAI: true, redBag: {'FULL RESTORE': 2}},
  hard: {redLevels: [100, 100], playerLevel: 90, expertAI: true, smartAI: true, redBag: {'FULL RESTORE': 3}},
};
/** From V3_FROM (after player feedback): Red puts at most 2 of your Pokémon to sleep at a time, and Medium Red has 1 Full Restore. */
export const V3_FROM = '2026-10-20';
/** From this day (and friend battles created from it): Hyper Beam always recharges (Aryan's choice after feedback). */
export const RECHARGE_FROM = '2026-10-23';
export const RECHARGE_FROM_MS = Date.parse(`${RECHARGE_FROM}T00:00:00Z`);
const LEVEL_RULES_V3: Record<Level, Rules> = {
  easy: {...LEVEL_RULES.easy, sleepCap: 2},
  medium: {...LEVEL_RULES.medium, redBag: {'FULL RESTORE': 1}, sleepCap: 2},
  hard: {...LEVEL_RULES.hard, sleepCap: 2},
};
/** From V4_FROM (Hard won only ~10% after the changes): Hard Red has 2 Full Restores (was 3) and your Hard team is Lv 95 (was 90). */
export const V4_FROM = '2026-10-24';
/** From this day (and friend battles created from it): 100% moves always hit, like later games (Aryan's choice). */
export const NO_MISS_FROM = '2026-10-24';
export const NO_MISS_FROM_MS = Date.parse(`${NO_MISS_FROM}T00:00:00Z`);
const LEVEL_RULES_V4: Record<Level, Rules> = {
  ...LEVEL_RULES_V3,
  hard: {...LEVEL_RULES_V3.hard, playerLevel: 95, redBag: {'FULL RESTORE': 2}},
};
export const rulesFor = (date: string, level: Level, legacy = false): Rules =>
  (legacy || !isV2(date) ? RULES_V1 : date >= V4_FROM ? LEVEL_RULES_V4 : date >= V3_FROM ? LEVEL_RULES_V3 : LEVEL_RULES)[level];
/** Easy: the rules for building your own team (any 6, any moves, 6 items, Lv 100). */
export const EASY_OPTIONS: MatchOptions = {level: 100, randomTeams: 'off', randomLevels: 'off', items: 6, tms: null, timer: 0,
  clauses: {sleep: false, freeze: false, ohko: false, evasion: false, trap: false, species: true}};
/** Medium/Hard teams only use Pokémon with base stats adding up to at least this. */
export const STRONG_BST = 450;
export const bst = (sp: string) => Object.values(SPECIES[sp].base).reduce((a, b) => a + b, 0);

/** Red's iconic team (Gen 2's Mt. Silver, with Lapras for Espeon), perfect DVs, always led by Pikachu. */
export const RED_TEAM: {species: string; moves: string[]}[] = [
  {species: 'pikachu', moves: ['thunderbolt', 'thunderwave', 'bodyslam', 'seismictoss']},
  {species: 'lapras', moves: ['blizzard', 'surf', 'bodyslam', 'confuseray']},
  {species: 'snorlax', moves: ['bodyslam', 'earthquake', 'rest', 'hyperbeam']},
  {species: 'venusaur', moves: ['razorleaf', 'sleeppowder', 'bodyslam', 'swordsdance']},
  {species: 'charizard', moves: ['fireblast', 'slash', 'earthquake', 'swordsdance']},
  {species: 'blastoise', moves: ['surf', 'blizzard', 'earthquake', 'bodyslam']},
];
const PERFECT = {atk: 15, def: 15, spe: 15, spc: 15};

/** Your team and bag are the same on Medium and Hard that day (Hard: lower level). On Easy you bring your own (`custom`). */
export function generateDay(date: string, seed = date, level: Level = 'hard', custom?: PickedTeam, legacy = false): Day {
  const rng = rngFor(`pokebattles:${seed}`);
  const taken = new Set<string>();
  const rules = rulesFor(date, level, legacy);
  if (!isV2(date) || legacy) {
    const player = pickTeam(rng, taken).map(s => makeMon(rng, s, int(rng, 50, 58)));
    const playerBag = makePlayerBag(rng);
    const redRng = rngFor(`pokebattles:${seed}:red:${level}`);
    const red = pickTeam(redRng, taken).map(s => makeMon(redRng, s, int(redRng, ...rules.redLevels)));
    return {date, seed, level, number: dayNumber(date), smartAI: rules.smartAI, player: {team: player, bag: playerBag}, red: {team: red, bag: {...rules.redBag}}};
  }
  const red = RED_TEAM.map(m => ({species: m.species, level: 100, moves: [...m.moves], dvs: {...PERFECT}, stats: calcStats(m.species, 100, PERFECT)}));
  const base = {date, seed, level, number: dayNumber(date), smartAI: rules.smartAI, expertAI: !!rules.expertAI, ...(rules.sleepCap ? {sleepCap: rules.sleepCap} : {}),
    ...(date >= RECHARGE_FROM && !legacy ? {alwaysRecharge: true} : {}),
    ...(date >= NO_MISS_FROM && !legacy ? {sureHit: true} : {}), red: {team: red, bag: {...rules.redBag}}};
  if (level === 'easy') {
    if (!custom) throw new Error('Easy needs your own team.');
    return {...base, player: {team: toMons({mons: custom.mons.map(m => ({...m, level: 100})), bag: {}}), bag: {...(custom.bag ?? {})}}};
  }
  // A random team of strong Pokémon (not Red's), perfect stats, their best moves at this level.
  const lv = rules.playerLevel;
  const pool = ALL_SPECIES.filter(sp => bst(sp) >= STRONG_BST && !RED_TEAM.some(r => r.species === sp));
  const species = shuffle(rng, pool).slice(0, 6);
  const team = species.map(sp => {
    const moves = bestMoves(sp, 100, rng);
    return {species: sp, level: lv, moves, dvs: {...PERFECT}, stats: calcStats(sp, lv, PERFECT)};
  });
  return {...base, player: {team, bag: makePlayerBag(rng)}};
}
