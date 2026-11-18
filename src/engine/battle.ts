// Gen 1 (Red/Blue/Yellow) battle engine, quirks included.
// Pure logic: no drawing. The UI feeds it actions and plays back the events it returns.
// Everything random comes from one seeded stream, so the same day + same choices
// always produce the same battle (this is what lets the leaderboard re-check results).

import {SPECIES, MOVES, TYPES, GEN1_MOVE_IDS, type Move} from './data';
import {mulberry32, hashString, type Rng} from './rng';
import {type Day, type Mon} from './daily';

export type SideId = 'player' | 'red';
export type Status = 'slp' | 'psn' | 'brn' | 'frz' | 'par' | null;
type Stat = 'atk' | 'def' | 'spc' | 'spe';
type BoostStat = Stat | 'acc' | 'eva';
type Stats4 = Record<Stat, number>;

export interface BMon {
  species: string;
  level: number;
  moves: string[];
  pp: number[];
  maxPp: number[];
  hp: number;
  maxHp: number;
  stats: Stats4; // unmodified stats
  status: Status;
  sleep: number; // turns left asleep
  restSleep?: boolean; // asleep from its own Rest (doesn't count for the Sleep Clause)
}

interface Volatile {
  raw: Stats4; // stats used for crits (copied on Transform)
  stats: Stats4; // modified stats (stages, burn, paralysis)
  stages: Record<BoostStat, number>;
  types: string[];
  moves: string[];
  tpp: number[] | null; // PP while transformed
  transformed: string | null;
  confusion: number;
  substitute: number;
  reflect: boolean;
  lightScreen: boolean;
  focusEnergy: boolean;
  leechSeed: boolean;
  mist: boolean;
  xAccuracy: boolean;
  badPoison: boolean;
  toxicCount: number;
  disabled: {slot: number; turns: number} | null;
  trappedBy: boolean;
  trapping: {turns: number; damage: number; move: string} | null;
  thrash: {turns: number; move: string} | null;
  charging: string | null;
  invulnerable: boolean;
  recharge: boolean;
  bide: {turns: number; damage: number} | null;
  rage: string | null;
  flinch: boolean;
  lastMove: string | null;
  turnsOut: number;
  faintShown: boolean;
}

export interface SideState {
  id: SideId;
  team: BMon[];
  active: number;
  bag: Record<string, number>;
  v: Volatile;
}

export type Action =
  | {type: 'move'; slot: number; mimic?: number} // slot -1 = Struggle; mimic = which of the foe's moves Mimic copies
  | {type: 'switch'; index: number}
  | {type: 'item'; item: string; target?: number; moveSlot?: number; pre?: boolean} // pre: used before the battle, target = index in the day's team
  | {type: 'order'; order: number[]} // only as the very first entry: the player's team order before battle
  | {type: 'forfeit'}; // daily battles: the player gives up (a loss). Friend battles forfeit through the server instead.

export type BattleEvent =
  | {t: 'text'; s: string}
  | {t: 'hp'; side: SideId; hp: number; max: number}
  | {t: 'status'; side: SideId; status: Status}
  | {t: 'move'; side: SideId; move: string; charge?: boolean} // charge: 1st turn of a two-turn move (build-up only)
  | {t: 'hit'; side: SideId}
  | {t: 'faint'; side: SideId}
  | {t: 'withdraw'; side: SideId}
  | {t: 'send'; side: SideId; index: number}
  | {t: 'transform'; side: SideId; species: string}
  | {t: 'sub'; side: SideId; up: boolean}
  | {t: 'end'; winner: SideId};

// ---------- formulas ----------

const STAGE: [number, number][] = [
  [25, 100], [28, 100], [33, 100], [40, 100], [50, 100], [66, 100], [1, 1],
  [15, 10], [2, 1], [25, 10], [3, 1], [35, 10], [4, 1],
];
const applyStage = (value: number, stage: number) => {
  const [n, d] = STAGE[stage + 6];
  return Math.floor((value * n) / d);
};

// In Gen 1 the type decides physical vs special.
const SPECIAL_TYPES = new Set(['Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon']);
export const isSpecial = (type: string) => SPECIAL_TYPES.has(type);

export function typeMods(moveType: string, defTypes: string[]): number[] {
  return defTypes.map(t => TYPES[moveType]?.[t] ?? 1);
}

/** Gen 1 damage formula. roll = 217..255, or null for the fixed confusion hit. */
export function gen1Damage(o: {
  level: number; power: number; atk: number; def: number; crit: boolean;
  stab: boolean; mods: number[]; roll: number | null;
}): number {
  let {atk, def} = o;
  if (atk > 255 || def > 255) {
    atk = Math.floor(atk / 4);
    def = Math.floor(def / 4);
  }
  atk = Math.max(1, atk);
  def = Math.max(1, def);
  const level = o.crit ? o.level * 2 : o.level;
  let d = Math.floor(Math.floor((Math.floor((2 * level) / 5) + 2) * atk * o.power / def) / 50);
  d = Math.min(d, 997) + 2;
  if (o.stab) d += Math.floor(d / 2);
  for (const m of o.mods) d = Math.floor((d * m * 10) / 10);
  if (o.roll !== null && d > 1) d = Math.floor((d * o.roll) / 255);
  return d;
}

const STAT_NAMES: Record<BoostStat, string> = {
  atk: 'ATTACK', def: 'DEFENSE', spc: 'SPECIAL', spe: 'SPEED', acc: 'ACCURACY', eva: 'EVADE',
};
const DATA_STAT: Record<string, BoostStat> = {
  atk: 'atk', def: 'def', spa: 'spc', spd: 'spc', spe: 'spe', accuracy: 'acc', evasion: 'eva',
};
function mapBoosts(boosts: Record<string, number>): [BoostStat, number][] {
  const out = new Map<BoostStat, number>();
  for (const [k, n] of Object.entries(boosts)) out.set(DATA_STAT[k], n); // spa+spd → one SPECIAL change
  return [...out];
}

const FIXED_DAMAGE = new Set(['seismictoss', 'nightshade', 'sonicboom', 'dragonrage', 'superfang', 'psywave']);
const THAW_MOVES = new Set(['ember', 'flamethrower', 'fireblast', 'firepunch']);

// ---------- battle ----------

const other = (s: SideId): SideId => (s === 'player' ? 'red' : 'player');

function toBMon(m: Mon): BMon {
  const pp = m.moves.map(id => MOVES[id].pp);
  return {
    species: m.species, level: m.level, moves: [...m.moves], pp: [...pp], maxPp: pp,
    hp: m.stats.hp, maxHp: m.stats.hp,
    stats: {atk: m.stats.atk, def: m.stats.def, spc: m.stats.spc, spe: m.stats.spe},
    status: null, sleep: 0,
    // Elite Four: carried over from the previous battle of the run.
    ...(m.start ? {hp: m.start.hp, pp: [...m.start.pp], status: m.start.status as Status, sleep: m.start.sleep} : {}),
  };
}

/** Rules that only apply to friend battles. */
export interface BattleClauses { sleep: boolean; freeze: boolean; alwaysRecharge?: boolean; sureHit?: boolean }

/** A friend battle: host plays the 'player' side, guest the 'red' side. */
export interface PvpSetup {
  seed: string;
  host: {name: string; team: Mon[]; bag: Record<string, number>};
  guest: {name: string; team: Mon[]; bag: Record<string, number>};
  clauses: BattleClauses;
}
/** One round of a friend battle: [host action, guest action] (null when that side has nothing to do). */
export type PvpRound = [Action | null, Action | null];

export class Battle {
  sides: Record<SideId, SideState>;
  rng: Rng;
  turn = 0;
  winner: SideId | null = null;
  needSwitch = false; // player must pick a new mon
  needSwitchRed = false; // friend battles: the other human must pick a new mon
  log: Action[] = [];
  /** Friend battles only. */
  mode: 'daily' | 'pvp' = 'daily';
  /** The side whose move is running (decides double knockouts in friend battles). */
  private acting: SideId | null = null;
  /** Whose point of view the battle text is written from (doesn't change what happens). */
  viewer: SideId = 'player';
  trainers: Record<SideId, string> = {player: 'YOU', red: 'RED'};
  clauses: BattleClauses = {sleep: false, freeze: false};
  pvpLog: PvpRound[] = [];
  private ev: BattleEvent[] = [];
  /** Each side's Mimic choice this turn (index into the foe's moves), if a human made one. */
  private mimicPicks: Record<SideId, number | null> = {player: null, red: null};
  private lastDamage = 0; // Gen 1 keeps this globally (Counter reads it)

  constructor(public day: Day) {
    this.rng = mulberry32(hashString(`pokebattles:battle:${day.seed}:${day.level}`));
    if (day.foeName) this.trainers = {player: 'YOU', red: day.foeName};
    this.sides = {
      player: this.makeSide('player', day.player.team, day.player.bag),
      red: this.makeSide('red', day.red.team, day.red.bag),
    };
  }

  /** A friend battle, with the text written from `viewer`'s side. */
  static pvp(setup: PvpSetup, viewer: SideId = 'player'): Battle {
    const day: Day = {date: 'pvp', seed: setup.seed, level: 'hard', number: 0, smartAI: false,
      player: {team: setup.host.team, bag: setup.host.bag}, red: {team: setup.guest.team, bag: setup.guest.bag}};
    const b = new Battle(day);
    b.rng = mulberry32(hashString(`pokebattles:pvp:battle:${setup.seed}`));
    b.mode = 'pvp';
    b.viewer = viewer;
    b.trainers = {player: setup.host.name, red: setup.guest.name};
    b.clauses = setup.clauses;
    return b;
  }

  /** Rebuilds a friend battle from its rounds (both players and the server get the same result). */
  static replayPvp(setup: PvpSetup, rounds: PvpRound[], viewer: SideId = 'player'): Battle {
    const b = Battle.pvp(setup, viewer);
    b.start();
    for (const r of rounds) b.stepPvp(r[0], r[1]);
    return b;
  }

  /** Replays a saved action log onto a fresh battle (used on reload and by the server check). */
  static replay(day: Day, actions: Action[]): Battle {
    const b = new Battle(day);
    let rest = actions;
    if (actions[0]?.type === 'order') {
      if (!b.reorder(actions[0].order)) throw new Error('Bad team order');
      rest = actions.slice(1);
    }
    while (rest[0]?.type === 'item' && rest[0].pre) {
      const err = b.preItem(rest[0].item, b.order.indexOf(rest[0].target ?? -1), rest[0].moveSlot);
      if (err) throw new Error(`Bad item before battle: ${err}`);
      rest = rest.slice(1);
    }
    b.start();
    for (const a of rest) b.step(a);
    return b;
  }

  /** Items that only work on the Pokémon in battle (not from the menu before it). */
  static readonly BATTLE_ONLY = ['X ATTACK', 'X DEFEND', 'X SPEED', 'X SPECIAL', 'X ACCURACY', 'GUARD SPEC.', 'DIRE HIT'];

  /** Before the first battle action: use an item on team member `target` (index in the current order),
   *  like from the START menu. Logged so replays and the server do the same. Returns why not, or null. */
  preItem(item: string, target: number, moveSlot?: number): string | null {
    if (this.started) return 'The battle has already started.';
    if (Battle.BATTLE_ONLY.includes(item)) return `${item} only works during a battle.`;
    const m = this.sides.player.team[target];
    if (!m) return 'Pick a POKÉMON.';
    const err = this.itemError('player', item, target, moveSlot);
    if (err) return err;
    this.ev = [];
    this.useItem('player', {item, target, moveSlot});
    this.ev = [];
    this.log.push({type: 'item', item, target: this.order[target], moveSlot, pre: true});
    return null;
  }

  /** The player's team order, as indices into the day's team. */
  get order(): number[] {
    const first = this.log[0];
    return first?.type === 'order' ? [...first.order] : this.day.player.team.map((_, i) => i);
  }

  /** True once the player has taken a battle action (not just reordered the team). */
  get started(): boolean {
    return this.log.some(a => a.type !== 'order' && !(a.type === 'item' && a.pre));
  }

  /**
   * Puts the player's team in a new order before the battle starts (order = indices into the day's team).
   * Recorded as the first log entry so replays (and the server check) rebuild the same battle.
   */
  reorder(order: number[]): boolean {
    if (this.started) return false;
    const team = this.day.player.team, n = team.length;
    if (!Array.isArray(order) || order.length !== n || new Set(order).size !== n
      || order.some(i => !Number.isInteger(i) || i < 0 || i >= n)) return false;
    if (team[order[0]].start?.hp === 0) return false; // Elite Four: a fainted Pokémon can't lead
    const side = this.sides.player;
    side.team.splice(0, n, ...order.map(i => toBMon(team[i]))); // in place: screens hold this array
    side.active = 0;
    side.v = this.freshVolatile(side.team[0]);
    // Items already used before the battle: start again from the day's bag and use them on the new order.
    const pres = this.log.filter(a => a.type === 'item' && a.pre) as {type: 'item'; item: string; target?: number; moveSlot?: number}[];
    for (const k of Object.keys(side.bag)) delete side.bag[k];
    Object.assign(side.bag, this.day.player.bag);
    this.log = order.every((v, i) => v === i) ? [] : [{type: 'order', order: [...order]}];
    for (const a of pres) this.preItem(a.item, order.indexOf(a.target ?? -1), a.moveSlot);
    return true;
  }

  private makeSide(id: SideId, team: Mon[], bag: Record<string, number>): SideState {
    const side: SideState = {id, team: team.map(toBMon), active: 0, bag: {...bag}, v: null as unknown as Volatile};
    side.v = this.freshVolatile(side.team[0]);
    return side;
  }

  private freshVolatile(mon: BMon): Volatile {
    const v: Volatile = {
      raw: {...mon.stats}, stats: {...mon.stats},
      stages: {atk: 0, def: 0, spc: 0, spe: 0, acc: 0, eva: 0},
      types: [...SPECIES[mon.species].types], moves: [...mon.moves], tpp: null, transformed: null,
      confusion: 0, substitute: 0, reflect: false, lightScreen: false, focusEnergy: false,
      leechSeed: false, mist: false, xAccuracy: false, badPoison: false, toxicCount: 0,
      disabled: null, trappedBy: false, trapping: null, thrash: null, charging: null,
      invulnerable: false, recharge: false, bide: null, rage: null, flinch: false,
      lastMove: null, turnsOut: 0, faintShown: false,
    };
    if (mon.status === 'par') v.stats.spe = Math.max(1, Math.floor(v.stats.spe / 4));
    if (mon.status === 'brn') v.stats.atk = Math.max(1, Math.floor(v.stats.atk / 2));
    return v;
  }

  // ---------- helpers ----------

  private r256 = () => Math.floor(this.rng() * 256);
  private between = (lo: number, hi: number) => lo + Math.floor(this.rng() * (hi - lo + 1));
  /** 2–5 with Gen 1 odds (3/8, 3/8, 1/8, 1/8). */
  private twoToFive() {
    const r = this.r256();
    return r < 96 ? 2 : r < 192 ? 3 : r < 224 ? 4 : 5;
  }

  mon(side: SideId) {
    const s = this.sides[side];
    return s.team[s.active];
  }

  name(side: SideId) {
    const n = SPECIES[this.mon(side).species].name;
    if (side === this.viewer) return n;
    return this.mode === 'pvp' ? `Foe ${n}` : `Enemy ${n}`;
  }

  /** "Go! PIKACHU!" for the viewer, "RED sent out PIKACHU!" for the other side. */
  private sentOutText(side: SideId) {
    const n = SPECIES[this.mon(side).species].name;
    return side === this.viewer ? `Go! ${n}!` : `${this.trainers[side]} sent out ${n}!`;
  }

  private text(s: string) { this.ev.push({t: 'text', s}); }
  private hpEvent(side: SideId) {
    const m = this.mon(side);
    this.ev.push({t: 'hp', side, hp: m.hp, max: m.maxHp});
  }
  private statusEvent(side: SideId) { this.ev.push({t: 'status', side, status: this.mon(side).status}); }

  private applyPenalties(side: SideId) {
    const m = this.mon(side), v = this.sides[side].v;
    if (m.status === 'par') v.stats.spe = Math.max(1, Math.floor(v.stats.spe / 4));
    if (m.status === 'brn') v.stats.atk = Math.max(1, Math.floor(v.stats.atk / 2));
  }

  private heal(side: SideId, amount: number) {
    const m = this.mon(side);
    m.hp = Math.min(m.maxHp, m.hp + amount);
    this.hpEvent(side);
  }

  private selfDamage(side: SideId, amount: number) {
    const m = this.mon(side);
    m.hp = Math.max(0, m.hp - amount);
    this.hpEvent(side);
  }

  /** Moves the side can pick right now (slot indexes). */
  usableSlots(side: SideId): number[] {
    const v = this.sides[side].v, m = this.mon(side);
    const pp = v.tpp ?? m.pp;
    return v.moves.map((_, i) => i).filter(i => pp[i] > 0 && v.disabled?.slot !== i);
  }

  /** If the side is locked into a move this turn, returns that move id. */
  lockedMove(side: SideId): string | null {
    const v = this.sides[side].v;
    if (v.recharge) return 'recharge';
    if (v.charging) return v.charging;
    if (v.thrash) return v.thrash.move;
    if (v.trapping) return v.trapping.move;
    if (v.bide) return 'bide';
    if (v.rage) return v.rage;
    return null;
  }

  canUseItem(side: SideId, item: string, target = this.sides[side].active, moveSlot?: number): boolean {
    return this.itemError(side, item, target, moveSlot) === null;
  }

  /** Why an item can't be used (shown to the player), or null if it can. Works on any party member. */
  itemError(side: SideId, item: string, target = this.sides[side].active, moveSlot?: number): string | null {
    const s = this.sides[side];
    if (!s.bag[item]) return `You don't have any ${item}!`;
    const m = s.team[target];
    if (!m) return 'Pick a POKÉMON.';
    const name = SPECIES[m.species].name;
    const fainted = m.hp === 0;
    const isActive = target === s.active;
    const noEffect = 'It won\'t have any effect.';
    if (item === 'REVIVE') return fainted ? null : `${name} hasn't fainted!`;
    if (fainted) return `${name} has fainted! Only REVIVE works on it.`;
    switch (item) {
      case 'POTION': case 'SUPER POTION': case 'HYPER POTION': case 'MAX POTION':
        return m.hp < m.maxHp ? null : `${name}'s HP is already full!`;
      case 'FULL RESTORE':
        return m.hp < m.maxHp || m.status !== null || (isActive && s.v.confusion > 0) ? null : noEffect;
      case 'FULL HEAL': return m.status !== null ? null : noEffect;
      case 'ANTIDOTE': return m.status === 'psn' ? null : noEffect;
      case 'PARLYZ HEAL': return m.status === 'par' ? null : noEffect;
      case 'AWAKENING': return m.status === 'slp' ? null : noEffect;
      case 'BURN HEAL': return m.status === 'brn' ? null : noEffect;
      case 'ICE HEAL': return m.status === 'frz' ? null : noEffect;
      case 'X ATTACK': case 'X DEFEND': case 'X SPEED': case 'X SPECIAL':
      case 'X ACCURACY': case 'GUARD SPEC.': case 'DIRE HIT':
        return isActive ? null : `${item} only works on the POKÉMON in battle.`;
      case 'ETHER':
        if (moveSlot === undefined || !m.moves[moveSlot]) return 'Pick a move.';
        return m.pp[moveSlot] < m.maxPp[moveSlot] ? null : 'That move\'s PP is already full!';
      case 'ELIXER': return m.pp.some((p, i) => p < m.maxPp[i]) ? null : 'PP is already full!';
    }
    return noEffect;
  }

  // ---------- turn flow ----------

  start(): BattleEvent[] {
    this.ev = [];
    this.text(`${this.trainers[other(this.viewer)]} wants to fight!`);
    this.text(this.sentOutText('red'));
    this.ev.push({t: 'send', side: 'red', index: 0});
    this.hpEvent('red');
    this.text(this.sentOutText('player'));
    this.ev.push({t: 'send', side: 'player', index: 0});
    this.hpEvent('player');
    return this.ev;
  }

  /** Checks an action is allowed. Returns an error message, or null if fine. */
  validate(a: Action): string | null {
    return this.validateFor('player', a);
  }

  /** Checks an action for either side (friend battles validate both players). */
  validateFor(side: SideId, a: Action): string | null {
    const p = this.sides[side];
    if (a.type === 'order') return 'The battle has already started.';
    if (this.winner) return 'The battle is over.';
    if (a.type === 'forfeit') return this.mode === 'daily' && side === 'player' ? null : 'You can\'t do that now.';
    if (side === 'player' ? this.needSwitch : this.needSwitchRed) {
      if (a.type !== 'switch') return 'Choose a POKÉMON.';
      const m = p.team[a.index];
      return m && m.hp > 0 ? null : 'There\'s no will to fight!';
    }
    if (this.lockedMove(side)) return null; // any input continues the locked move
    if (a.type === 'move') {
      const usable = this.usableSlots(side);
      if (a.slot === -1) return usable.length === 0 ? null : 'Pick a move.';
      return usable.includes(a.slot) ? null : 'No PP left for this move!';
    }
    if (a.type === 'switch') {
      const m = p.team[a.index];
      if (!m || m.hp === 0) return 'There\'s no will to fight!';
      if (a.index === p.active) return `${SPECIES[m.species].name} is already out!`;
      return null;
    }
    return this.itemError(side, a.item, a.target, a.moveSlot);
  }

  step(action: Action): BattleEvent[] {
    this.ev = [];
    const err = this.validate(action);
    if (err) return [{t: 'text', s: err}];
    this.log.push(action);

    if (action.type === 'forfeit') {
      this.winner = 'red';
      this.ev.push({t: 'text', s: 'You forfeited the battle!'});
      this.ev.push({t: 'end', winner: 'red'});
      return this.ev;
    }

    if (this.needSwitch) {
      this.needSwitch = false;
      this.switchIn('player', (action as {index: number}).index);
      return this.ev;
    }

    this.turn++;
    this.mimicPicks = {player: action.type === 'move' && Number.isInteger(action.mimic) ? action.mimic! : null, red: null};
    const locked = this.lockedMove('player');
    const playerAct: Action = locked ? {type: 'move', slot: -2} : action;
    const redAct = this.redAction();
    return this.round(playerAct, redAct);
  }

  /**
   * Friend battles: one round with both players' choices. After a faint, only the side(s) that must
   * send out a new POKéMON act (the other passes null). Returns the events, or an error text event.
   */
  stepPvp(host: Action | null, guest: Action | null): BattleEvent[] {
    this.ev = [];
    if (this.winner) return [{t: 'text', s: 'The battle is over.'}];
    const needs: Record<SideId, boolean> = {player: this.needSwitch, red: this.needSwitchRed};
    const acts: Record<SideId, Action | null> = {player: host, red: guest};
    if (needs.player || needs.red) {
      for (const side of ['player', 'red'] as SideId[]) {
        if (!needs[side]) continue;
        const err = acts[side] ? this.validateFor(side, acts[side]!) : 'Choose a POKÉMON.';
        if (err) return [{t: 'text', s: err}];
      }
      this.pvpLog.push([needs.player ? host : null, needs.red ? guest : null]);
      for (const side of ['player', 'red'] as SideId[]) {
        if (!needs[side]) continue;
        if (side === 'player') this.needSwitch = false; else this.needSwitchRed = false;
        this.switchIn(side, (acts[side] as {index: number}).index);
      }
      return this.ev;
    }
    for (const side of ['player', 'red'] as SideId[]) {
      const a = acts[side];
      const err = a ? this.validateFor(side, a) : 'Waiting for a move.';
      if (err) return [{t: 'text', s: err}];
    }
    this.pvpLog.push([host, guest]);
    this.turn++;
    const pick = (a: Action) => (a.type === 'move' && Number.isInteger(a.mimic) ? a.mimic! : null);
    this.mimicPicks = {player: pick(host!), red: pick(guest!)};
    const playerAct: Action = this.lockedMove('player') ? {type: 'move', slot: -2} : host!;
    const redAct: Action = this.lockedMove('red') ? {type: 'move', slot: -2} : guest!;
    return this.round(playerAct, redAct);
  }

  /** Resolves one turn once both sides' actions are known. */
  private round(playerAct: Action, redAct: Action): BattleEvent[] {

    // Switches and items happen before any move.
    for (const [side, act] of [['player', playerAct], ['red', redAct]] as [SideId, Action][]) {
      if (act.type === 'switch') {
        const n = SPECIES[this.mon(side).species].name;
        this.text(side === this.viewer ? `Come back, ${n}!` : this.mode === 'daily' ? `${this.trainers.red} withdrew!` : `${this.trainers[side]} withdrew ${n}!`);
        this.ev.push({t: 'withdraw', side});
        this.switchIn(side, act.index);
      } else if (act.type === 'item') {
        this.useItem(side, act);
      }
    }

    // Moves: priority, then Speed, ties random.
    const movers = ([['player', playerAct], ['red', redAct]] as [SideId, Action][])
      .filter(([, a]) => a.type === 'move') as [SideId, {type: 'move'; slot: number}][];
    const prio = (side: SideId, slot: number) => {
      const id = this.moveIdFor(side, slot);
      return id === 'recharge' ? 0 : MOVES[id]?.priority ?? 0;
    };
    if (movers.length === 2) {
      const [a, b] = movers;
      const pa = prio(a[0], a[1].slot), pb = prio(b[0], b[1].slot);
      const sa = this.sides[a[0]].v.stats.spe, sb = this.sides[b[0]].v.stats.spe;
      const aFirst = pa !== pb ? pa > pb : sa !== sb ? sa > sb : this.rng() < 0.5;
      if (!aFirst) movers.reverse();
    }

    for (const [side, act] of movers) {
      if (this.winner || this.mon(side).hp === 0) break;
      this.runTurn(side, act.slot);
      if (this.handleFaints()) break;
      this.residual(side);
      if (this.handleFaints()) break;
    }

    for (const s of Object.values(this.sides)) {
      s.v.flinch = false;
      s.v.turnsOut++;
    }
    return this.ev;
  }

  private moveIdFor(side: SideId, slot: number): string {
    const locked = this.lockedMove(side);
    if (locked) return locked;
    if (slot === -1) return 'struggle';
    // Was locked when the turn began, but the lock ended (e.g. the target switched out).
    if (slot === -2) return this.sides[side].v.lastMove ?? 'struggle';
    return this.sides[side].v.moves[slot];
  }

  private switchIn(side: SideId, index: number) {
    const s = this.sides[side], o = this.sides[other(side)];
    s.active = index;
    s.v = this.freshVolatile(s.team[index]);
    // The opponent's trapping move ends when its target leaves.
    o.v.trapping = null;
    o.v.trappedBy = false;
    this.text(this.sentOutText(side));
    this.ev.push({t: 'send', side, index});
    this.hpEvent(side);
  }

  /** Returns true if anything fainted (the turn ends there, as in Gen 1). */
  private handleFaints(): boolean {
    let any = false;
    for (const side of ['red', 'player'] as SideId[]) {
      const m = this.mon(side);
      if (m.hp > 0 || this.sides[side].v.faintShown) continue;
      any = true;
      this.sides[side].v.faintShown = true;
      this.text(`${this.name(side)} fainted!`);
      this.ev.push({t: 'faint', side});
      const o = this.sides[other(side)];
      o.v.trapping = null;
      o.v.trappedBy = false;
    }
    if (!any) return false;

    const alive = (side: SideId) => this.sides[side].team.some(m => m.hp > 0);
    // Friend battles: if both last POKéMON faint together (Explosion, recoil…), whoever's move caused it loses.
    const order: SideId[] = this.mode === 'pvp' && !alive('red') && !alive('player') && this.acting ? [this.acting] : ['red', 'player'];
    for (const loser of order) {
      if (alive(loser)) continue;
      this.winner = other(loser);
      if (loser === this.viewer) {
        this.text('You are out of useable POKÉMON!');
        this.text('You blacked out!');
      } else {
        this.text(`${this.trainers[loser]} was defeated!`);
      }
      this.ev.push({t: 'end', winner: other(loser)});
      return true;
    }
    if (this.mon('red').hp === 0) {
      if (this.mode === 'pvp') this.needSwitchRed = true;
      else this.switchIn('red', this.sides.red.team.findIndex(m => m.hp > 0));
    }
    if (this.mon('player').hp === 0) this.needSwitch = true;
    return true;
  }

  // ---------- items ----------

  private useItem(side: SideId, a: {item: string; target?: number; moveSlot?: number}) {
    const s = this.sides[side];
    const target = a.target ?? s.active;
    const m = s.team[target];
    const isActive = target === s.active;
    const mname = SPECIES[m.species].name;
    s.bag[a.item]--;
    if (!s.bag[a.item]) delete s.bag[a.item];
    this.text(side === this.viewer ? `Used ${a.item}!` : `${this.trainers[side]} used ${a.item}!`);

    const cure = () => {
      m.status = null;
      m.sleep = 0;
      if (isActive) {
        s.v.badPoison = false;
        this.statusEvent(side);
      }
    };
    const restore = (amount: number) => {
      const before = m.hp;
      m.hp = Math.min(m.maxHp, m.hp + amount);
      if (isActive) this.hpEvent(side);
      this.text(`${mname} recovered by ${m.hp - before}!`);
    };

    switch (a.item) {
      case 'POTION': restore(20); break;
      case 'SUPER POTION': restore(50); break;
      case 'HYPER POTION': restore(200); break;
      case 'MAX POTION': restore(m.maxHp); break;
      case 'FULL RESTORE':
        if (m.hp < m.maxHp) restore(m.maxHp);
        cure();
        if (isActive) s.v.confusion = 0;
        break;
      case 'REVIVE':
        m.hp = Math.floor(m.maxHp / 2);
        m.status = null;
        this.text(`${mname} is revitalized!`);
        break;
      case 'FULL HEAL': case 'ANTIDOTE': case 'PARLYZ HEAL': case 'AWAKENING': case 'BURN HEAL': case 'ICE HEAL': {
        const what: Record<string, string> = {psn: 'was cured of poison!', par: 'was cured of paralysis!',
          slp: 'woke up!', brn: 'was cured of its burn!', frz: 'was defrosted!'};
        this.text(`${mname} ${what[m.status!]}`);
        cure(); // Gen 1: the Speed/Attack drop stays until it switches out
        break;
      }
      case 'X ATTACK': this.changeStage(side, 'atk', 1, side); break;
      case 'X DEFEND': this.changeStage(side, 'def', 1, side); break;
      case 'X SPEED': this.changeStage(side, 'spe', 1, side); break;
      case 'X SPECIAL': this.changeStage(side, 'spc', 1, side); break;
      case 'X ACCURACY': s.v.xAccuracy = true; this.text(`${mname} is focused!`); break;
      case 'GUARD SPEC.': s.v.mist = true; this.text(`${mname}'s shrouded in MIST!`); break;
      case 'DIRE HIT': s.v.focusEnergy = true; this.text(`${mname}'s getting pumped!`); break;
      case 'ETHER': {
        const i = a.moveSlot!;
        m.pp[i] = Math.min(m.maxPp[i], m.pp[i] + 10);
        this.text('PP was restored.');
        break;
      }
      case 'ELIXER':
        m.pp = m.pp.map((p, i) => Math.min(m.maxPp[i], p + 10));
        this.text('PP was restored.');
        break;
    }
  }

  // ---------- Red's AI (Gen 1 trainer AI layers) ----------

  /** True when Red has put as many of your Pokémon to sleep as the day allows (Day.sleepCap). */
  private sleepCapped(): boolean {
    const cap = this.day.sleepCap;
    return !!cap && this.sides.player.team.filter(m => m.hp > 0 && m.status === 'slp').length >= cap;
  }

  private redAction(): Action {
    if (this.lockedMove('red')) return {type: 'move', slot: -2};
    if (this.day.expertAI) return this.expertAction();
    const r = this.sides.red, m = this.mon('red');
    if (r.bag['FULL RESTORE'] && m.hp * 5 < m.maxHp && this.r256() < 128) {
      return {type: 'item', item: 'FULL RESTORE'};
    }
    const slots = this.usableSlots('red');
    if (slots.length === 0) return {type: 'move', slot: -1};
    // Easy: Red just picks any move.
    if (!this.day.smartAI) return {type: 'move', slot: slots[Math.floor(this.rng() * slots.length)]};
    const foe = this.mon('player'), foeV = this.sides.player.v;
    const score = (slot: number) => {
      const mv = MOVES[r.v.moves[slot]];
      let s = 10;
      // Layer 1: don't use status moves on a target that already has a status.
      if (mv.power === 0 && (mv.status || mv.volatileStatus === 'confusion') && foe.status) s += 5;
      if (mv.status === 'slp' && this.sleepCapped()) s += 20; // enough of your team is asleep already
      // Layer 2: set-up moves are better on the first turn out.
      if (r.v.turnsOut === 0 && mv.target === 'self' && mv.boosts) s -= 1;
      // Layer 3: like super-effective moves, avoid weak ones.
      if (mv.power > 1) {
        const eff = typeMods(mv.type, foeV.types).reduce((a, b) => a * b, 1);
        if (eff > 1) s -= 1;
        if (eff < 1) s += 1;
      }
      return s;
    };
    const scores = slots.map(score);
    const best = Math.min(...scores);
    const choices = slots.filter((_, i) => scores[i] === best);
    return {type: 'move', slot: choices[Math.floor(this.rng() * choices.length)]};
  }

  /** Red's "expert" brain (daily battles from the switch-over): estimates each move's real damage,
   *  takes a sure KO, disables healthy foes, heals early, sets up when it's safe. No randomness used. */
  private expertAction(): Action {
    const r = this.sides.red, me = this.mon('red'), foe = this.mon('player'), foeV = this.sides.player.v;
    const hp = me.hp / me.maxHp;
    // Heal: Full Restore when low, or when asleep/frozen and hurt.
    if (r.bag['FULL RESTORE'] && (hp < 0.35 || ((me.status === 'slp' || me.status === 'frz') && hp < 0.75))) return {type: 'item', item: 'FULL RESTORE'};
    if (r.bag['HYPER POTION'] && hp < 0.35) return {type: 'item', item: 'HYPER POTION'};
    if (r.bag['FULL HEAL'] && (me.status === 'slp' || me.status === 'frz' || me.status === 'par')) return {type: 'item', item: 'FULL HEAL'};
    const slots = this.usableSlots('red');
    if (slots.length === 0) return {type: 'move', slot: -1};
    const eff = (type: string) => typeMods(type, foeV.types).reduce((a, b) => a * b, 1);
    const dmgOf = (id: string): number => {
      const mv = MOVES[id] as Move;
      if (mv.ohko) return 0;
      if (mv.damage === 'level') return eff(mv.type) ? me.level : 0;
      if (typeof mv.damage === 'number') return eff(mv.type) ? mv.damage : 0;
      if (!(mv.power > 1)) return 0;
      if (id === 'dreameater' && foe.status !== 'slp') return 0;
      const special = isSpecial(mv.type);
      const d = gen1Damage({level: me.level, power: mv.power, atk: special ? r.v.stats.spc : r.v.stats.atk,
        def: (special ? foeV.stats.spc : foeV.stats.def) * ((special ? foeV.lightScreen : foeV.reflect) ? 2 : 1),
        crit: false, stab: r.v.types.includes(mv.type), mods: typeMods(mv.type, foeV.types), roll: 236});
      return d * (mv.multihit ? 2.5 : 1);
    };
    const acc = (id: string) => ((MOVES[id] as Move).acc ?? 100) / 100;
    const best = Math.max(0, ...slots.map(i => dmgOf(r.v.moves[i]) * acc(r.v.moves[i])));
    const value = (slot: number): number => {
      const id = r.v.moves[slot], mv = MOVES[id] as Move & {status?: string; volatileStatus?: string; boosts?: Record<string, number>};
      const d = dmgOf(id);
      if (d > 0) {
        if (d >= foe.hp) return 10000 + acc(id) * 100; // a knock-out: the surest one
        let v = d * acc(id);
        if (id === 'hyperbeam') v *= 0.6;
        if (mv.charge) v *= 0.5;
        return v;
      }
      if (mv.status && !foe.status && eff(mv.type) > 0) {
        if (mv.status === 'slp') return foe.hp / foe.maxHp > 0.4 && !this.sleepCapped() ? best * 1.6 + 1 : 0;
        if (mv.status === 'par') return foe.hp / foe.maxHp > 0.4 && foeV.stats.spe >= r.v.stats.spe ? best * 1.3 + 1 : 0;
        return foe.hp / foe.maxHp > 0.5 ? best * 0.7 : 0;
      }
      if (mv.volatileStatus === 'confusion') return foeV.confusion ? 0 : best * 0.6;
      if (id === 'rest') return hp < 0.4 && !r.bag['FULL RESTORE'] ? 99999 : 0;
      if (mv.boosts && (mv.target === 'self')) return hp > 0.7 && r.v.stages.atk < 2 && r.v.turnsOut <= 1 ? best * 1.2 : 0;
      return 1;
    };
    let pick = slots[0], top = -1;
    for (const i of slots) { const v = value(i); if (v > top) { top = v; pick = i; } }
    return {type: 'move', slot: pick};
  }

  // ---------- moves ----------

  /** Cancels multi-turn moves (on sleep, full paralysis, confusion self-hit). */
  private cancelLocks(side: SideId) {
    const v = this.sides[side].v;
    v.charging = null;
    v.invulnerable = false;
    v.thrash = null;
    v.bide = null;
    if (v.trapping) {
      v.trapping = null;
      this.sides[other(side)].v.trappedBy = false;
    }
  }

  /** Friend battles: Struggle is typeless (hits Ghosts), so a battle can't get stuck forever.
   *  Daily battles keep the Gen 1 rule (Normal-type) so saved battles replay the same. */
  private typeModsFor(moveId: string, type: string, defTypes: string[]): number[] {
    return this.mode === 'pvp' && moveId === 'struggle' ? [1] : typeMods(type, defTypes);
  }

  private runTurn(side: SideId, slot: number) {
    this.acting = side;
    const s = this.sides[side], v = s.v, m = this.mon(side), name = this.name(side);
    const moveId = this.moveIdFor(side, slot);
    const continuing = this.lockedMove(side) !== null; // later turn of a multi-turn move

    if (m.status === 'slp') {
      m.sleep--;
      if (m.sleep <= 0) {
        m.status = null;
        this.text(`${name} woke up!`);
        this.statusEvent(side);
      } else {
        this.text(`${name} is fast asleep!`);
      }
      this.cancelLocks(side);
      return;
    }
    if (m.status === 'frz') {
      this.text(`${name} is frozen solid!`);
      this.cancelLocks(side);
      return;
    }
    if (v.trappedBy) {
      this.text(`${name} can't move!`);
      return;
    }
    if (v.flinch) {
      v.flinch = false;
      this.text(`${name} flinched!`);
      return;
    }
    if (v.recharge) {
      v.recharge = false;
      this.text(`${name} must recharge!`);
      return;
    }
    if (v.disabled && --v.disabled.turns <= 0) {
      v.disabled = null;
      this.text(`${name}'s disabled no more!`);
    }
    if (v.confusion > 0) {
      v.confusion--;
      if (v.confusion === 0) {
        this.text(`${name}'s confused no more!`);
      } else {
        this.text(`${name} is confused!`);
        if (this.rng() < 0.5) {
          this.text('It hurt itself in its confusion!');
          this.confusionHit(side);
          this.cancelLocks(side);
          return;
        }
      }
    }
    if (v.disabled && v.moves[v.disabled.slot] === moveId && !continuing) {
      this.text(`${name}'s ${MOVES[moveId].name} is disabled!`);
      return;
    }
    if (m.status === 'par' && this.r256() < 63) {
      this.text(`${name}'s fully paralyzed!`);
      this.cancelLocks(side);
      return;
    }

    // Bide: store damage, then hit back with double.
    if (v.bide) {
      if (--v.bide.turns > 0) {
        this.text(`${name} is storing energy!`);
        return;
      }
      const dmg = v.bide.damage * 2;
      v.bide = null;
      this.text(`${name} unleashed energy!`);
      if (dmg === 0 || this.sides[other(side)].v.invulnerable) {
        this.text(`${name}'s attack missed!`);
      } else {
        this.dealDamage(other(side), dmg, side);
      }
      return;
    }

    // Wrap/Bind/Fire Spin/Clamp keep going.
    if (v.trapping) {
      this.text(`${name}'s attack continues!`);
      this.ev.push({t: 'move', side, move: v.trapping.move});
      this.dealDamage(other(side), v.trapping.damage, side);
      if (--v.trapping.turns <= 0) {
        v.trapping = null;
        this.sides[other(side)].v.trappedBy = false;
      }
      return;
    }

    // Spend PP (not for turns of a move already under way).
    if (!continuing && moveId !== 'struggle') {
      const pp = v.tpp ?? m.pp;
      if (slot >= 0) pp[slot] = Math.max(0, pp[slot] - 1);
    }
    this.useMove(side, moveId);
  }

  /** Announces and performs a move (also used by Metronome and Mirror Move). */
  private useMove(side: SideId, moveId: string): void {
    const s = this.sides[side], v = s.v, name = this.name(side);
    const move = MOVES[moveId];
    const releasing = v.charging === moveId;
    if (releasing) {
      v.charging = null;
      v.invulnerable = false;
    }

    if (v.thrash && v.thrash.move === moveId) {
      this.text(`${name}'s thrashing about!`);
    } else {
      this.text(`${name} used ${move.name}!`);
    }
    this.ev.push(move.charge && !releasing ? {t: 'move', side, move: moveId, charge: true} : {t: 'move', side, move: moveId});
    v.lastMove = moveId;

    // Two-turn moves: first turn is the build-up.
    if (move.charge && !releasing) {
      v.charging = moveId;
      const msg: Record<string, string> = {
        solarbeam: 'took in sunlight!', skullbash: 'lowered its head!', razorwind: 'made a whirlwind!',
        skyattack: 'is glowing!', dig: 'dug a hole!', fly: 'flew up high!',
      };
      if (moveId === 'dig' || moveId === 'fly') v.invulnerable = true;
      this.text(`${name} ${msg[moveId] ?? 'is charging!'}`);
      return;
    }

    switch (moveId) {
      case 'metronome': {
        const pool = GEN1_MOVE_IDS.filter(id => id !== 'metronome' && id !== 'struggle');
        return this.useMove(side, pool[Math.floor(this.rng() * pool.length)]);
      }
      case 'mirrormove': {
        const last = this.sides[other(side)].v.lastMove;
        if (!last || last === 'mirrormove') return this.text('But, it failed!');
        return this.useMove(side, last);
      }
      case 'bide':
        v.bide = {turns: this.between(2, 3), damage: 0};
        return;
      case 'counter': return this.counter(side);
    }

    if (move.power > 0 || move.ohko) return this.attack(side, moveId, move);
    return this.statusMove(side, moveId, move);
  }

  private hits(side: SideId, moveId: string, move: Move): boolean {
    const u = this.sides[side].v, t = this.sides[other(side)].v;
    if (t.invulnerable) return false;
    if (move.acc === null) return true;
    if (u.xAccuracy) return true;
    let acc = Math.floor((move.acc * 255) / 100);
    acc = applyStage(acc, u.stages.acc);
    acc = applyStage(acc, -t.stages.eva);
    acc = Math.max(1, Math.min(255, acc));
    // Newer days/matches: a full-accuracy hit (100% move, no accuracy/evasion drop) can't miss.
    if (acc >= 255 && (this.day.sureHit || this.clauses.sureHit)) return true;
    void moveId;
    return this.r256() < acc; // even 100% moves miss 1/256 of the time
  }

  private critRoll(side: SideId, move: Move): boolean {
    const v = this.sides[side].v;
    const species = v.transformed ?? this.mon(side).species;
    let b = Math.floor(SPECIES[species].base.spe / 2);
    b = v.focusEnergy ? b >> 1 : Math.min(255, b * 2); // Focus Energy bug: lowers crit rate
    b = move.highCrit ? Math.min(255, b * 4) : b >> 1;
    return this.r256() < b;
  }

  private calcFor(side: SideId, move: Move, crit: boolean, power = move.power): number {
    const u = this.sides[side], t = this.sides[other(side)];
    const special = isSpecial(move.type);
    let atk: number, def: number;
    if (crit) {
      atk = special ? u.v.raw.spc : u.v.raw.atk;
      def = special ? t.v.raw.spc : t.v.raw.def;
    } else {
      atk = special ? u.v.stats.spc : u.v.stats.atk;
      def = special ? t.v.stats.spc : t.v.stats.def;
      if (special ? t.v.lightScreen : t.v.reflect) def *= 2;
    }
    if (move.selfdestruct) def = Math.max(1, Math.floor(def / 2));
    return gen1Damage({
      level: this.mon(side).level, power, atk, def, crit,
      stab: u.v.types.includes(move.type),
      mods: this.typeModsFor(move === MOVES.struggle ? 'struggle' : '', move.type, t.v.types),
      roll: this.between(217, 255),
    });
  }

  /** Damage to the target's substitute or HP. Returns what happened. */
  private dealDamage(target: SideId, dmg: number, from: SideId): {sub: boolean; broke: boolean; dealt: number} {
    const t = this.sides[target], m = this.mon(target);
    this.ev.push({t: 'hit', side: target});
    if (t.v.substitute > 0) {
      t.v.substitute -= dmg;
      this.lastDamage = dmg;
      if (t.v.substitute <= 0) {
        t.v.substitute = 0;
        this.text('The SUBSTITUTE broke!');
        this.ev.push({t: 'sub', side: target, up: false});
        return {sub: true, broke: true, dealt: dmg};
      }
      this.text('The SUBSTITUTE took damage for it!');
      return {sub: true, broke: false, dealt: dmg};
    }
    const dealt = Math.min(dmg, m.hp);
    m.hp -= dealt;
    this.lastDamage = dealt;
    this.hpEvent(target);
    if (t.v.bide) t.v.bide.damage += dealt;
    if (t.v.rage && m.hp > 0 && from !== target) {
      this.text(`${this.name(target)}'s RAGE is building!`);
      this.changeStage(target, 'atk', 1, target, true);
    }
    return {sub: false, broke: false, dealt};
  }

  private confusionHit(side: SideId) {
    const v = this.sides[side].v;
    const dmg = gen1Damage({
      level: this.mon(side).level, power: 40, atk: v.stats.atk, def: v.stats.def,
      crit: false, stab: false, mods: [], roll: null,
    });
    // Gen 1 bug: if the opponent has a Substitute, the self-hit damages that instead.
    const o = this.sides[other(side)];
    if (o.v.substitute > 0) {
      this.dealDamage(other(side), dmg, side);
    } else {
      this.selfDamage(side, dmg);
    }
  }

  private counter(side: SideId) {
    const last = this.sides[other(side)].v.lastMove;
    const lm = last ? MOVES[last] : null;
    const ok = lm && (lm.type === 'Normal' || lm.type === 'Fighting') && lm.power > 0 && last !== 'counter' && this.lastDamage > 0;
    if (!ok || !this.hits(side, 'counter', MOVES.counter)) {
      this.text(`${this.name(side)}'s attack missed!`);
      return;
    }
    this.dealDamage(other(side), this.lastDamage * 2, side);
  }

  private attack(side: SideId, moveId: string, move: Move) {
    const u = this.sides[side], t = this.sides[other(side)];
    const name = this.name(side), tname = this.name(other(side));
    const tm = this.mon(other(side)), um = this.mon(side);

    const selfKO = () => {
      if (move.selfdestruct) this.selfDamage(side, um.hp);
    };

    if (moveId === 'dreameater' && tm.status !== 'slp') {
      this.text('But, it failed!');
      return;
    }
    if (move.ohko && u.v.stats.spe < t.v.stats.spe) {
      this.text('But, it failed!');
      return;
    }
    if (!this.hits(side, moveId, move)) {
      this.text(`${name}'s attack missed!`);
      if (moveId === 'jumpkick' || moveId === 'highjumpkick') {
        this.text(`${name} kept going and crashed!`);
        this.selfDamage(side, 1);
      }
      if (move.trap) u.v.trapping = null;
      selfKO();
      return;
    }

    const fixed = FIXED_DAMAGE.has(moveId);
    const mods = this.typeModsFor(moveId, move.type, t.v.types);
    const eff = mods.reduce((a, b) => a * b, 1);
    if (eff === 0 && !fixed) {
      this.text(`It doesn't affect ${tname}!`);
      selfKO();
      return;
    }

    let dmg: number, crit = false;
    if (move.ohko) {
      dmg = 65535;
    } else if (fixed) {
      const L = um.level;
      dmg = moveId === 'seismictoss' || moveId === 'nightshade' ? L
        : moveId === 'sonicboom' ? 20
        : moveId === 'dragonrage' ? 40
        : moveId === 'superfang' ? Math.max(1, Math.floor(tm.hp / 2))
        : this.between(1, Math.max(1, Math.floor(L * 1.5) - 1)); // Psywave
    } else {
      crit = this.critRoll(side, move);
      dmg = this.calcFor(side, move, crit);
      if (dmg === 0) {
        this.text(`${name}'s attack missed!`);
        selfKO();
        return;
      }
    }

    const hitsTotal = move.multihit === undefined ? 1
      : Array.isArray(move.multihit) ? this.twoToFive() : move.multihit;
    let res = {sub: false, broke: false, dealt: 0};
    let n = 0;
    while (n < hitsTotal) {
      res = this.dealDamage(other(side), dmg, side);
      n++;
      if (res.broke || tm.hp === 0) break;
    }
    if (crit) this.text('Critical hit!');
    if (move.ohko) this.text('One-hit KO!');
    else if (!fixed && eff > 1) this.text('It\'s super effective!');
    else if (!fixed && eff < 1) this.text('It\'s not very effective...');
    if (hitsTotal > 1) this.text(`Hit the enemy ${n} times!`);

    const targetAlive = tm.hp > 0;

    // Fire moves thaw a frozen target.
    if (targetAlive && !res.sub && tm.status === 'frz' && THAW_MOVES.has(moveId)) {
      tm.status = null;
      this.statusEvent(other(side));
      this.text(`${tname} was defrosted!`);
    }

    // Secondary effects (blocked by a Substitute).
    if (targetAlive && !res.sub && move.secondary && this.r256() < Math.floor((move.secondary.chance * 256) / 100)) {
      const sec = move.secondary;
      if (sec.status) {
        this.tryStatus(other(side), sec.status, move.type, true);
      } else if (sec.boosts && !t.v.mist) {
        for (const [stat, d] of mapBoosts(sec.boosts)) this.changeStage(other(side), stat, d, side);
      } else if (sec.volatileStatus === 'flinch') {
        t.v.flinch = true;
      } else if (sec.volatileStatus === 'confusion' && t.v.confusion === 0) {
        t.v.confusion = this.between(2, 5);
        this.text(`${tname} became confused!`);
      }
    }

    if (move.drain && res.dealt > 0) {
      this.heal(side, Math.max(1, Math.floor(res.dealt / 2)));
      this.text(moveId === 'dreameater' ? `${tname}'s dream was eaten!` : `Sucked health from ${tname}!`);
    }
    if (move.recoil && res.dealt > 0) {
      this.selfDamage(side, Math.max(1, Math.floor((res.dealt * move.recoil[0]) / move.recoil[1])));
      this.text(`${name}'s hit with recoil!`);
    }
    if (moveId === 'struggle' && res.dealt > 0) {
      this.selfDamage(side, Math.max(1, Math.floor(res.dealt / 2)));
      this.text(`${name}'s hit with recoil!`);
    }
    // Hyper Beam: Gen 1 skips the recharge after a knock-out or a broken Substitute; newer days/matches always recharge.
    if (move.recharge && ((targetAlive && !res.broke) || this.day.alwaysRecharge || this.clauses.alwaysRecharge)) u.v.recharge = true;
    if (move.trap && targetAlive && !res.sub) {
      const turns = this.twoToFive() - 1;
      if (turns > 0) {
        u.v.trapping = {turns, damage: dmg, move: moveId};
        t.v.trappedBy = true;
      }
    }
    if (move.thrash) {
      if (!u.v.thrash) u.v.thrash = {turns: this.between(2, 3), move: moveId};
      else if (--u.v.thrash.turns <= 0) {
        u.v.thrash = null;
        u.v.confusion = this.between(2, 5);
        this.text(`${name} became confused!`);
      }
    }
    if (moveId === 'rage') u.v.rage = 'rage';
    if (moveId === 'payday') this.text('Coins scattered everywhere!');
    // Gen 1: Explosion/Self-Destruct that breaks a Substitute doesn't KO the user.
    if (move.selfdestruct && !res.broke) selfKO();
  }

  /** Burn/freeze/paralysis can't hit a target sharing the move's type (Gen 1). */
  private tryStatus(target: SideId, status: string, moveType: string, secondary: boolean): boolean {
    const m = this.mon(target), v = this.sides[target].v, n = this.name(target);
    if (m.status) return false;
    if (secondary && v.types.includes(moveType)) return false;
    if ((status === 'psn' || status === 'tox') && v.types.includes('Poison')) return false;
    switch (status) {
      case 'slp':
        // Sleep Clause (friend battles): only one of a team's POKéMON can be put to sleep by the foe at a time.
        if (this.clauses.sleep && this.sides[target].team.some(x => x.status === 'slp' && !x.restSleep)) return false;
        m.status = 'slp';
        m.restSleep = false;
        m.sleep = this.between(1, 7);
        this.text(`${n} fell asleep!`);
        break;
      case 'par':
        m.status = 'par';
        this.applyPenalties(target);
        this.text(`${n}'s paralyzed! It may not attack!`);
        break;
      case 'brn':
        m.status = 'brn';
        this.applyPenalties(target);
        this.text(`${n} was burned!`);
        break;
      case 'frz':
        // Freeze Clause (friend battles): only one frozen POKéMON per team.
        if (this.clauses.freeze && this.sides[target].team.some(x => x.status === 'frz')) return false;
        m.status = 'frz';
        this.cancelLocks(target);
        this.text(`${n} was frozen solid!`);
        break;
      case 'psn':
        m.status = 'psn';
        this.text(`${n} was poisoned!`);
        break;
      case 'tox':
        m.status = 'psn';
        v.badPoison = true;
        v.toxicCount = 0;
        this.text(`${n}'s badly poisoned!`);
        break;
    }
    this.statusEvent(target);
    return true;
  }

  /** Changes a stat stage. Includes the Gen 1 bug that re-applies the
   *  paralysis/burn drop to the non-acting Pokémon after any stat change. */
  private changeStage(target: SideId, stat: BoostStat, delta: number, actor: SideId, silent = false): boolean {
    const v = this.sides[target].v;
    const cur = v.stages[stat];
    if ((delta > 0 && cur >= 6) || (delta < 0 && cur <= -6) || (delta > 0 && stat !== 'acc' && stat !== 'eva' && v.stats[stat as Stat] >= 999)) {
      if (!silent) this.text('Nothing happened!');
      return false;
    }
    v.stages[stat] = Math.max(-6, Math.min(6, cur + delta));
    if (stat !== 'acc' && stat !== 'eva') {
      v.stats[stat] = Math.max(1, Math.min(999, applyStage(v.raw[stat], v.stages[stat])));
    }
    if (!silent) {
      const how = delta > 1 ? 'greatly rose!' : delta > 0 ? 'rose!' : delta < -1 ? 'greatly fell!' : 'fell!';
      this.text(`${this.name(target)}'s ${STAT_NAMES[stat]} ${how}`);
    }
    this.applyPenalties(other(actor));
    return true;
  }

  private statusMove(side: SideId, moveId: string, move: Move) {
    const u = this.sides[side], t = this.sides[other(side)];
    const um = this.mon(side), tm = this.mon(other(side));
    const name = this.name(side), tname = this.name(other(side));
    const fail = () => this.text('But, it failed!');
    const miss = () => this.text(`${name}'s attack missed!`);

    switch (moveId) {
      case 'splash': return this.text('No effect!');
      case 'teleport': case 'roar': case 'whirlwind': return fail();
      case 'substitute': {
        if (u.v.substitute > 0) return this.text(`${name} has a SUBSTITUTE already!`);
        const cost = Math.floor(um.maxHp / 4);
        if (um.hp < cost) return this.text('Too weak to make SUBSTITUTE!');
        this.selfDamage(side, cost);
        u.v.substitute = cost + 1;
        this.ev.push({t: 'sub', side, up: true});
        return this.text('It created a SUBSTITUTE!');
      }
      case 'focusenergy':
        if (u.v.focusEnergy) return fail();
        u.v.focusEnergy = true;
        return this.text(`${name}'s getting pumped!`);
      case 'mist':
        if (u.v.mist) return fail();
        u.v.mist = true;
        return this.text(`${name}'s shrouded in MIST!`);
      case 'reflect':
        if (u.v.reflect) return fail();
        u.v.reflect = true;
        return this.text(`${name} gained armor!`);
      case 'lightscreen':
        if (u.v.lightScreen) return fail();
        u.v.lightScreen = true;
        return this.text(`${name}'s protected against special attacks!`);
      case 'haze': {
        for (const sid of ['player', 'red'] as SideId[]) {
          const v = this.sides[sid].v;
          v.stages = {atk: 0, def: 0, spc: 0, spe: 0, acc: 0, eva: 0};
          v.stats = {...v.raw};
          Object.assign(v, {confusion: 0, focusEnergy: false, leechSeed: false, mist: false,
            reflect: false, lightScreen: false, disabled: null, xAccuracy: false, badPoison: false});
        }
        // Gen 1: Haze also cures the opponent's status.
        if (tm.status) {
          tm.status = null;
          tm.sleep = 0;
          this.statusEvent(other(side));
        }
        return this.text('All STATUS changes are eliminated!');
      }
      case 'rest':
        if (um.hp === um.maxHp) return fail();
        um.status = 'slp';
        um.restSleep = true;
        um.sleep = 2;
        this.statusEvent(side);
        this.text(`${name} started sleeping!`);
        this.heal(side, um.maxHp);
        return this.text(`${name} regained health!`);
      case 'recover': case 'softboiled': {
        const missing = um.maxHp - um.hp;
        // Gen 1 bug: fails when missing HP is 255 or 511 below max.
        if (missing === 0 || missing % 256 === 255) return fail();
        this.heal(side, Math.floor(um.maxHp / 2));
        return this.text(`${name} regained health!`);
      }
      case 'transform': {
        u.v.types = [...t.v.types];
        u.v.raw = {...t.v.raw};
        u.v.stats = {...t.v.stats};
        u.v.stages = {...t.v.stages};
        u.v.moves = [...t.v.moves];
        u.v.tpp = u.v.moves.map(() => 5);
        u.v.transformed = tm.species;
        this.ev.push({t: 'transform', side, species: tm.species});
        return this.text(`${name} transformed into ${SPECIES[tm.species].name}!`);
      }
      case 'conversion':
        u.v.types = [...t.v.types];
        return this.text(`Converted type to ${tname}'s!`);
      case 'disable': {
        if (t.v.disabled || !this.hits(side, moveId, move)) return miss();
        const tpp = t.v.tpp ?? tm.pp;
        const options = t.v.moves.map((_, i) => i).filter(i => tpp[i] > 0);
        if (!options.length) return fail();
        const slot = options[Math.floor(this.rng() * options.length)];
        t.v.disabled = {slot, turns: this.between(1, 8)};
        return this.text(`${tname}'s ${MOVES[t.v.moves[slot]].name} was disabled!`);
      }
      case 'mimic': {
        if (!this.hits(side, moveId, move)) return miss();
        const slot = u.v.moves.indexOf('mimic');
        // A human chooses which move to copy (as in Gen 1); Red's AI picks at random.
        const want = this.mimicPicks[side];
        const pick = want !== null && want >= 0 && want < t.v.moves.length ? want : null;
        const copied = t.v.moves[pick ?? Math.floor(this.rng() * t.v.moves.length)];
        if (slot >= 0) u.v.moves[slot] = copied;
        return this.text(`${name} learned ${MOVES[copied].name}!`);
      }
      case 'leechseed':
        if (t.v.leechSeed || t.v.types.includes('Grass') || t.v.substitute > 0 || !this.hits(side, moveId, move)) return miss();
        t.v.leechSeed = true;
        return this.text(`${tname} was seeded!`);
    }

    // Stat raising (self).
    if (move.boosts && move.target === 'self') {
      for (const [stat, d] of mapBoosts(move.boosts)) this.changeStage(side, stat, d, side);
      return;
    }
    // Stat lowering (target).
    if (move.boosts) {
      if (!this.hits(side, moveId, move)) return miss();
      if (t.v.substitute > 0 || t.v.mist) return fail();
      for (const [stat, d] of mapBoosts(move.boosts)) this.changeStage(other(side), stat, d, side);
      return;
    }
    // Confusion.
    if (move.volatileStatus === 'confusion') {
      if (t.v.substitute > 0 || t.v.confusion > 0 || !this.hits(side, moveId, move)) return fail();
      t.v.confusion = this.between(2, 5);
      return this.text(`${tname} became confused!`);
    }
    // Sleep / paralysis / poison.
    if (move.status) {
      if (moveId === 'thunderwave' && t.v.types.includes('Ground')) return this.text(`It doesn't affect ${tname}!`);
      if ((move.status === 'psn' || move.status === 'tox') && t.v.substitute > 0) return fail();
      if (tm.status) return fail();
      if (!this.hits(side, moveId, move)) return miss();
      if (!this.tryStatus(other(side), move.status, move.type, false)) return fail();
      return;
    }
    fail();
  }

  // ---------- end of each Pokémon's turn ----------

  private sixteenth(side: SideId): number {
    const v = this.sides[side].v;
    let d = Math.max(1, Math.floor(this.mon(side).maxHp / 16));
    // Gen 1: Toxic's counter also multiplies burn and Leech Seed damage.
    if (v.badPoison) d *= ++v.toxicCount;
    return d;
  }

  private residual(side: SideId) {
    const m = this.mon(side), v = this.sides[side].v, name = this.name(side);
    if (m.hp === 0) return;
    if (m.status === 'psn' || m.status === 'brn') {
      this.text(`${name}'s hurt by ${m.status === 'psn' ? 'poison' : 'the burn'}!`);
      this.selfDamage(side, this.sixteenth(side));
    }
    if (v.leechSeed && m.hp > 0) {
      const d = Math.min(m.hp, this.sixteenth(side));
      this.text(`LEECH SEED saps ${name}!`);
      this.selfDamage(side, d);
      if (this.mon(other(side)).hp > 0) this.heal(other(side), d);
    }
  }
}
