// Friend-battle stress test (run: npx tsx scripts/pvp-stress.mts [battles]).
// Plays thousands of random friend battles and checks every Pokémon, TM/HM and item.
// Prints a list of problems found; nothing is changed.

import {SPECIES, MOVES, LEARNSETS} from '../src/engine/data';
import {
  TMS, PVP_ITEMS, DEFAULT_OPTIONS, BANNED, startingMoves, defaultMoveset, levelUpMovesAt, canLearnTm, needsTm, isBanned,
  teamError, tmUses, randomTeam, levelsFor, toMons, type PickedTeam, type MatchOptions, type Clauses,
} from '../src/engine/pvp';
import {Battle, type Action, type SideId, type PvpSetup, type BattleEvent} from '../src/engine/battle';
import {handleMatch, type Store} from '../src/engine/matchCore';
import {mulberry32} from '../src/engine/rng';

const N = Number(process.argv[2] ?? 3000);
const problems = new Map<string, {count: number; example: string}>();
const bug = (kind: string, example: string) => {
  const p = problems.get(kind);
  if (p) p.count++; else problems.set(kind, {count: 1, example});
};
const stats: Record<string, number> = {};
const tally = (k: string, n = 1) => { stats[k] = (stats[k] ?? 0) + n; };
const ALL = Object.keys(SPECIES);
const LEVELS = [30, 50, 70, 100];
const allClauses: Clauses = {...DEFAULT_OPTIONS.clauses};
const noClauses: Clauses = {sleep: false, freeze: false, ohko: false, evasion: false, trap: false, species: false};

console.error('stage: 1. data', new Date().toISOString().slice(11,19));
// ---------- 1. data: every Pokémon at every level, every TM ----------
const noMoves: string[] = [];
for (const sp of ALL) {
  for (const lv of LEVELS) {
    const mv = startingMoves(sp, lv, allClauses);
    if (mv[0] === 'struggle') noMoves.push(`${sp}@${lv}`);
    else {
      const team: PickedTeam = {mons: Array.from({length: 6}, (_, i) => ({species: i === 0 ? sp : ALL[(ALL.indexOf(sp) + i * 7) % ALL.length], level: lv, moves: []})), bag: {}};
      team.mons.forEach(m => { m.moves = startingMoves(m.species, lv, allClauses); });
      if (team.mons.some(m => m.moves[0] === 'struggle')) continue;
      const err = teamError(team, {...DEFAULT_OPTIONS, level: lv as 50}, Array(6).fill(lv));
      if (err && !/Only one/.test(err)) bug('starting moveset rejected by the team check', `${sp} Lv${lv}: ${err}`);
    }
    for (const m of startingMoves(sp, lv, allClauses)) if (isBanned(m, allClauses)) bug('banned move in a starting moveset', `${sp}@${lv}: ${m}`);
    if (defaultMoveset(sp, lv).some(m => !MOVES[m])) bug('unknown move in moveset', sp);
  }
}
tally('Pokémon × levels checked', ALL.length * LEVELS.length);

for (const t of TMS) if (!MOVES[t.id]) bug('TM/HM move missing from the move list', t.id);
let tmCombos = 0;
const tmMoveIds = new Set(TMS.map(t => t.id));
for (const sp of ALL) {
  for (const mv of LEARNSETS[sp] ?? []) {
    if (!MOVES[mv]) { bug('learnset has unknown move', `${sp}: ${mv}`); continue; }
    // Learnset moves that are neither level-up nor a TM/HM can't be chosen anywhere (fine, but worth knowing).
    if (!tmMoveIds.has(mv) && !(levelUpMovesAt(sp, 100).includes(mv))) tally('learnset moves not obtainable in picker (tutor/event)');
  }
  for (const t of TMS) {
    if (!canLearnTm(sp, t.id)) continue;
    tmCombos++;
    for (const lv of [50, 100]) {
      const base = startingMoves(sp, lv, noClauses);
      if (base[0] === 'struggle') continue;
      const moves = base.includes(t.id) ? base : [...base.slice(0, 3), t.id];
      const team: PickedTeam = {mons: [{species: sp, level: lv, moves}, ...ALL.filter(x => x !== sp && startingMoves(x, lv, noClauses)[0] !== 'struggle').slice(0, 5).map(x => ({species: x, level: lv, moves: startingMoves(x, lv, noClauses)}))], bag: {}};
      const err = teamError(team, {...DEFAULT_OPTIONS, level: lv as 50, tms: null, clauses: noClauses}, Array(6).fill(lv));
      if (err) bug('legal TM rejected by the team check', `${sp} Lv${lv} ${t.label} ${t.id}: ${err}`);
    }
  }
}
tally('Pokémon × TM/HM combos checked', tmCombos);

// TMs a Pokémon can't learn must be rejected.
for (const sp of ['magikarp', 'caterpie', 'pikachu', 'mewtwo', 'ditto']) {
  for (const t of TMS) {
    if (canLearnTm(sp, t.id) || levelUpMovesAt(sp, 100).includes(t.id)) continue;
    const team: PickedTeam = {mons: [{species: sp, level: 50, moves: [t.id]}, ...['pidgey', 'rattata', 'zubat', 'oddish', 'paras'].map(x => ({species: x, level: 50, moves: startingMoves(x, 50, noClauses)}))], bag: {}};
    if (!teamError(team, {...DEFAULT_OPTIONS, tms: null, clauses: noClauses})) bug('illegal TM accepted', `${sp} ${t.id}`);
  }
}

// ---------- helpers for battles ----------
function opts(r: () => number): MatchOptions {
  const pickOne = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  return {
    level: pickOne([30, 50, 70, 100, 'random'] as const), randomTeams: 'off', randomLevels: pickOne(['off', 'off', 'both', 'host'] as const),
    items: pickOne([0, 3, 6]), tms: null, timer: 60,
    clauses: {sleep: r() < 0.7, freeze: r() < 0.7, ohko: r() < 0.5, evasion: r() < 0.5, trap: r() < 0.5, species: true},
  };
}

/** A random legal team: random species, random mix of level-up moves and TMs, random items. */
function buildTeam(o: MatchOptions, seed: string, side: 'host' | 'guest', r: () => number): PickedTeam {
  const levels = levelsFor(o, seed, side);
  const used = new Set<string>();
  const mons = [];
  for (let i = 0; i < 6; i++) {
    let sp: string, base: string[];
    let tries = 0;
    do { sp = ALL[Math.floor(r() * ALL.length)]; base = startingMoves(sp, levels[i], o.clauses); if (process.env.TRACE && ++tries > 500) { console.error('   stuck picking', sp, levels[i], base); process.exit(1); } } while (used.has(sp) || base[0] === 'struggle');
    used.add(sp);
    const pool = [...new Set([...levelUpMovesAt(sp, levels[i]), ...TMS.filter(t => canLearnTm(sp, t.id)).map(t => t.id)])].filter(m => !isBanned(m, o.clauses)); // no duplicates
    const moves = new Set<string>();
    const want = 1 + Math.floor(r() * 4);
    if (process.env.TRACE) console.error('  mon', sp, levels[i], 'pool', pool.length, 'want', want);
    while (moves.size < Math.min(want, pool.length)) moves.add(pool[Math.floor(r() * pool.length)]);
    mons.push({species: sp, level: levels[i], moves: [...moves]});
  }
  const bag: Record<string, number> = {};
  for (let k = 0; k < o.items; k++) { const it = PVP_ITEMS[Math.floor(r() * PVP_ITEMS.length)]; bag[it] = (bag[it] ?? 0) + 1; }
  return {mons, bag};
}

/** A random choice for one side; also tries illegal ones sometimes to check they're refused. */
function choose(b: Battle, side: SideId, r: () => number, seenIllegal: {n: number}): Action | null {
  const s = b.sides[side];
  const need = side === 'player' ? b.needSwitch : b.needSwitchRed;
  const other = side === 'player' ? b.needSwitchRed : b.needSwitch;
  if (!need && other) return null;
  const alive = s.team.map((_, i) => i).filter(i => s.team[i].hp > 0 && i !== s.active);
  if (need) return {type: 'switch', index: alive[Math.floor(r() * alive.length)]};
  // Sometimes poke at the rules with an illegal action.
  if (r() < 0.03) {
    const bad: Action[] = [{type: 'switch', index: s.active}, {type: 'move', slot: 7}, {type: 'item', item: 'MASTER BALL'}, {type: 'switch', index: s.team.findIndex(m => m.hp === 0)}];
    const a = bad[Math.floor(r() * bad.length)];
    if (!(a.type === 'switch' && a.index < 0) && !b.lockedMove(side)) {
      if (b.validateFor(side, a) === null) bug('illegal action accepted', `${side} ${JSON.stringify(a)}`);
      seenIllegal.n++;
    }
  }
  const roll = r();
  if (roll < 0.1 && alive.length) return {type: 'switch', index: alive[Math.floor(r() * alive.length)]};
  if (roll < 0.25) {
    // Any item on any party member (and any move slot for Ether).
    const items = Object.keys(s.bag);
    for (const item of items.sort(() => r() - 0.5)) {
      for (let t = 0; t < 6; t++) {
        const slot = Math.floor(r() * 4);
        if (b.canUseItem(side, item, t, slot)) return {type: 'item', item, target: t, moveSlot: slot};
      }
    }
  }
  const usable = b.usableSlots(side);
  const slot = usable.length ? usable[Math.floor(r() * usable.length)] : -1;
  const mon = b.mon(side);
  const a: Action = {type: 'move', slot};
  if (slot >= 0 && b.sides[side].v.moves[slot] === 'mimic') (a as any).mimic = Math.floor(r() * b.sides[side === 'player' ? 'red' : 'player'].v.moves.length);
  void mon;
  return a;
}

const moveUse = new Map<string, number>();
const itemUse = new Map<string, number>();
const speciesSeen = new Set<string>();

function checkEvents(ev: BattleEvent[], b: Battle, ctx: string) {
  for (const e of ev) {
    if (e.t === 'text') {
      if (/undefined|NaN|null|\[object/.test(e.s)) bug('broken battle text', `${ctx}: "${e.s}"`);
      const m = /used (.+?)!$/.exec(e.s);
      if (m) moveUse.set(m[1], (moveUse.get(m[1]) ?? 0) + 1);
      const it = /^(?:Used|.+ used) ([A-Z .]+)!$/.exec(e.s);
      if (it && PVP_ITEMS.includes(it[1])) itemUse.set(it[1], (itemUse.get(it[1]) ?? 0) + 1);
    }
    if (e.t === 'hp' && (!(e.hp >= 0) || e.hp > e.max)) bug('HP out of range', `${ctx}: ${JSON.stringify(e)}`);
  }
  for (const side of ['player', 'red'] as SideId[]) {
    for (const m of b.sides[side].team) {
      if (m.hp < 0 || m.hp > m.maxHp || !Number.isInteger(m.hp)) bug('party HP invalid', `${ctx}: ${m.species} ${m.hp}/${m.maxHp}`);
      m.pp.forEach((p, i) => { if (p < 0 || p > m.maxPp[i]) bug('PP out of range', `${ctx}: ${m.species} ${m.moves[i]} ${p}/${m.maxPp[i]}`); });
      if (m.hp === 0 && m.status) tally('fainted with a status (cosmetic)');
    }
  }
}

console.error('stage: 2. thousands', new Date().toISOString().slice(11,19));
// ---------- 2. thousands of random battles (engine) ----------
let rounds = 0, longest = 0, stalls = 0, illegalTried = {n: 0};
const winners = {player: 0, red: 0};
const t0 = Date.now();
for (let g = 0; g < N; g++) {
  const r = mulberry32(g * 2654435761 + 17);
  const o = opts(r);
  const seed = `stress-${g}`;
  if (process.env.TRACE) console.error('battle', g);
  const only = process.env.ONLY;
  const host = buildTeam(o, seed, 'host', r), guest = buildTeam(o, seed, 'guest', r);
  for (const t of [host, guest]) {
    const err = teamError(t, o, undefined);
    if (err && !/must be level/.test(err)) bug('random legal team rejected', `${seed}: ${err}`);
    t.mons.forEach(m => speciesSeen.add(m.species));
  }
  const setup: PvpSetup = {seed, clauses: {sleep: o.clauses.sleep, freeze: o.clauses.freeze},
    host: {name: 'ASH', team: toMons(host), bag: {...host.bag}}, guest: {name: 'MISTY', team: toMons(guest), bag: {...guest.bag}}};
  let b: Battle;
  try {
    b = Battle.pvp(setup, 'player');
    checkEvents(b.start(), b, seed);
    let n = 0;
    let maxAsleep = 0, maxFrozen = 0;
    while (!b.winner && n < 1500) {
      if (process.env.TRACE) console.error(' round', n);
      const h = choose(b, 'player', r, illegalTried), gu = choose(b, 'red', r, illegalTried);
      for (const [side, a] of [['player', h], ['red', gu]] as const) {
        if (a && b.validateFor(side, a) !== null) bug('engine refuses an action the UI would offer', `${seed} ${side} ${JSON.stringify(a)}: ${b.validateFor(side, a)}`);
      }
      const ev = b.stepPvp(h, gu);
      if (ev.length === 1 && ev[0].t === 'text' && /Choose|Waiting|Pick|No PP|already|no will|won't|full|only/.test(ev[0].s) && b.pvpLog.length === n) {
        bug('round rejected (stuck)', `${seed} round ${n}: ${ev[0].s} host=${JSON.stringify(h)} guest=${JSON.stringify(gu)}`);
        break;
      }
      checkEvents(ev, b, `${seed}#${n}`);
      n++;
      // Clauses: count Pokémon the foe put to sleep / frozen on each team.
      for (const side of ['player', 'red'] as SideId[]) {
        const asleepByFoe = b.sides[side].team.filter(m => m.status === 'slp' && m.hp > 0 && !(m as any).restSleep).length;
        const frozen = b.sides[side].team.filter(m => m.status === 'frz' && m.hp > 0).length;
        maxAsleep = Math.max(maxAsleep, asleepByFoe); maxFrozen = Math.max(maxFrozen, frozen);
        if (o.clauses.sleep && asleepByFoe > 1) bug('Sleep Clause broken (2+ asleep)', `${seed} round ${n}`);
        if (o.clauses.freeze && frozen > 1) bug('Freeze Clause broken (2+ frozen)', `${seed} round ${n}`);
      }
    }
    if (only === seed) {
      const show = (side: SideId) => b.sides[side].team.map(m => `${m.species} L${m.level} ${m.hp}/${m.maxHp} [${m.moves.map((x, i) => x + ':' + m.pp[i]).join(',')}]`);
      console.log('HOST', show('player'), b.sides.player.bag, '\nGUEST', show('red'), b.sides.red.bag, '\nwinner', b.winner, 'rounds', n);
      const tail = Battle.pvp(setup2(setup), 'player'); tail.start();
      b.pvpLog.forEach((rd, i) => { const ev = tail.stepPvp(rd[0], rd[1]); if (i >= b.pvpLog.length - 8) console.log(i, JSON.stringify(rd), ev.filter(e => e.t === 'text').map(e => (e as any).s).join(' / ')); });
    }
    rounds += n; longest = Math.max(longest, n);
    if (!b.winner) {
      stalls++;
      const t = Battle.pvp(setup2(setup), 'player'); t.start(); let last = '';
      b.pvpLog.forEach(rd => { last = t.stepPvp(rd[0], rd[1]).filter(e => e.t === 'text').map(e => (e as any).s).join(' / '); });
      bug('battle never ended (1500 rounds)', seed + ': ' + last);
      console.error('STALL', seed, last);
      continue;
    }
    winners[b.winner]++;
    // Determinism: replays from both viewers must match.
    const h = Battle.replayPvp(setup2(setup), b.pvpLog, 'player');
    const gv = Battle.replayPvp(setup2(setup), b.pvpLog, 'red');
    if (JSON.stringify(h.sides) !== JSON.stringify(b.sides) || h.winner !== b.winner) bug('replay differs (host view)', seed);
    if (JSON.stringify(gv.sides) !== JSON.stringify(b.sides) || gv.winner !== b.winner) bug('replay differs (guest view)', seed);
  } catch (e) {
    bug('engine crashed', `${seed}: ${(e as Error).stack?.split('\n').slice(0, 3).join(' | ')}`);
  }
}
function setup2(s: PvpSetup): PvpSetup {
  return {...s, host: {...s.host, team: s.host.team.map(m => ({...m, moves: [...m.moves]})), bag: {...(s as any)._hostBag ?? s.host.bag}},
    guest: {...s.guest, team: s.guest.team.map(m => ({...m, moves: [...m.moves]})), bag: {...s.guest.bag}}};
}
tally('random battles played', N);
tally('rounds played', rounds);

console.error('stage: 3. every move', new Date().toISOString().slice(11,19));
// ---------- 3. every move used at least once (each Pokémon that can learn it) ----------
const allMoveIds = new Set<string>();
for (const sp of ALL) { levelUpMovesAt(sp, 100).forEach(m => allMoveIds.add(m)); TMS.forEach(t => canLearnTm(sp, t.id) && allMoveIds.add(t.id)); }
let moveTests = 0;
for (const mv of allMoveIds) {
  const users = ALL.filter(sp => levelUpMovesAt(sp, 100).includes(mv) || canLearnTm(sp, mv));
  for (const sp of users) {
    moveTests++;
    const foe = ALL[(ALL.indexOf(sp) * 31 + mv.length) % ALL.length];
    const mk = (s: string, moves: string[]) => ({mons: [{species: s, level: 60, moves}, ...['snorlax', 'gengar', 'starmie', 'rhydon', 'jolteon'].map(x => ({species: x, level: 60, moves: startingMoves(x, 60, noClauses)}))], bag: {}});
    const setup: PvpSetup = {seed: `mv-${mv}-${sp}`, clauses: {sleep: true, freeze: true},
      host: {name: 'ASH', team: toMons(mk(sp, [mv])), bag: {}}, guest: {name: 'MISTY', team: toMons(mk(foe, startingMoves(foe, 60, noClauses))), bag: {}}};
    try {
      const b = Battle.pvp(setup);
      b.start();
      const r = mulberry32(moveTests);
      for (let i = 0; i < 6 && !b.winner; i++) {
        const h: Action | null = b.needSwitch ? {type: 'switch', index: b.sides.player.team.findIndex((m, k) => m.hp > 0 && k !== b.sides.player.active)}
          : b.needSwitchRed ? null : {type: 'move', slot: b.usableSlots('player').length ? 0 : -1, ...(mv === 'mimic' ? {mimic: 0} : {})};
        const g = choose(b, 'red', r, illegalTried);
        const ev = b.stepPvp(h, g);
        checkEvents(ev, b, `move ${mv} by ${sp}`);
        if (ev.length === 1 && ev[0].t === 'text' && b.pvpLog.length === i) { bug('move test stuck', `${mv} by ${sp}: ${ev[0].s}`); break; }
      }
    } catch (e) {
      bug('engine crashed using a move', `${mv} by ${sp}: ${(e as Error).message}`);
    }
  }
}
tally('Pokémon × move single tests', moveTests);

console.error('stage: 4. every item', new Date().toISOString().slice(11,19));
// ---------- 4. every item, on every kind of target ----------
for (const item of PVP_ITEMS) {
  const team = (statusMon: string) => toMons({mons: ['snorlax', 'gengar', 'starmie', 'rhydon', 'jolteon', 'chansey'].map(x => ({species: x, level: 50, moves: startingMoves(x, 50, noClauses)})), bag: {}}).map((m, i) => (i === 0 ? m : m)) && toMons({mons: ['snorlax', 'gengar', 'starmie', 'rhydon', 'jolteon', 'chansey'].map(x => ({species: x, level: 50, moves: startingMoves(x, 50, noClauses)})), bag: {}});
  for (const guestSide of [false, true]) {
    const setup: PvpSetup = {seed: `item-${item}`, clauses: {sleep: true, freeze: true},
      host: {name: 'ASH', team: team(''), bag: {[item]: 3}}, guest: {name: 'MISTY', team: team(''), bag: {[item]: 3}}};
    const b = Battle.pvp(setup, guestSide ? 'red' : 'player');
    b.start();
    const side: SideId = guestSide ? 'red' : 'player';
    const s = b.sides[side];
    // Damage, status, PP loss and a fainted bench member so every item has something to do.
    s.team.forEach((m, i) => { if (i !== 1) m.hp = Math.max(1, Math.floor(m.maxHp / 3)); });
    s.team[2].hp = 0;
    s.team[3].status = item === 'ANTIDOTE' ? 'psn' : item === 'PARLYZ HEAL' ? 'par' : item === 'AWAKENING' ? 'slp' : item === 'BURN HEAL' ? 'brn' : item === 'ICE HEAL' ? 'frz' : 'psn';
    if (s.team[3].status === 'slp') s.team[3].sleep = 3;
    s.team.forEach(m => { m.pp = m.pp.map(p => Math.max(0, p - 12)); });
    const target = item === 'REVIVE' ? 2 : /HEAL|ANTIDOTE|AWAKENING/.test(item) ? 3 : /^X |GUARD|DIRE/.test(item) ? s.active : 0;
    const before = JSON.stringify(s.team[target]);
    const err = b.itemError(side, item, target, 0);
    if (err) { bug('item can’t be used where it should work', `${item} on ${s.team[target].species} (${guestSide ? 'guest' : 'host'}): ${err}`); continue; }
    const a: Action = {type: 'item', item, target, moveSlot: 0};
    const ev = guestSide ? b.stepPvp({type: 'move', slot: 0}, a) : b.stepPvp(a, {type: 'move', slot: 0});
    checkEvents(ev, b, `item ${item}`);
    const after = JSON.stringify(s.team[target]);
    const statChange = /^X |GUARD|DIRE/.test(item);
    if (!statChange && before === after) bug('item had no effect', `${item} (${guestSide ? 'guest' : 'host'})`);
    if (s.bag[item] !== 2) bug('item count not reduced', `${item}: ${s.bag[item]}`);
    if (item === 'REVIVE' && s.team[2].hp !== Math.floor(s.team[2].maxHp / 2)) bug('REVIVE wrong HP', `${s.team[2].hp}`);
    // Pointless uses must be refused.
    const full = s.team.findIndex(m => m.hp === m.maxHp);
    if (/POTION/.test(item) && full >= 0 && b.itemError(side, item, full) === null) bug('potion allowed at full HP', item);
    if (item !== 'REVIVE' && b.itemError(side, item, 2) === null) bug('item allowed on a fainted Pokémon', item);
    if (statChange && b.itemError(side, item, (s.active + 1) % 6) === null) bug('battle item allowed on a benched Pokémon', item);
    // Text from the right side.
    const txt = ev.filter(e => e.t === 'text').map(e => (e as any).s).join(' / ');
    if (!/Used |used /.test(txt)) bug('no "used item" text', `${item}: ${txt}`);
  }
  tally('items tested (host + guest)', 2);
}
// The whole bag can be used up and items refuse when empty.
{
  const s: PvpSetup = {seed: 'empty', clauses: {sleep: true, freeze: true},
    host: {name: 'A', team: toMons({mons: ['snorlax', 'gengar', 'starmie', 'rhydon', 'jolteon', 'chansey'].map(x => ({species: x, level: 50, moves: startingMoves(x, 50, noClauses)})), bag: {}}), bag: {'POTION': 1}},
    guest: {name: 'B', team: toMons({mons: ['snorlax', 'gengar', 'starmie', 'rhydon', 'jolteon', 'chansey'].map(x => ({species: x, level: 50, moves: startingMoves(x, 50, noClauses)})), bag: {}}), bag: {}}};
  const b = Battle.pvp(s); b.start();
  b.sides.player.team[0].hp = 10;
  b.stepPvp({type: 'item', item: 'POTION'}, {type: 'move', slot: 0});
  if (b.itemError('player', 'POTION', 0) === null) bug('item usable after the bag is empty', 'POTION');
}

console.error('stage: 5. the server', new Date().toISOString().slice(11,19));
// ---------- 5. the server: full matches through handleMatch ----------
function memoryStore(): Store {
  const files = new Map<string, string>();
  return {
    async read(p, f) { return files.has(p) ? JSON.parse(files.get(p)!) : f; },
    async write(p, v) { files.set(p, JSON.stringify(v)); },
    async remove(ps) { ps.forEach(p => files.delete(p)); },
  };
}
const ASH = {id: 'u-ash', name: 'ASH', country: 'IN'}, MISTY = {id: 'u-misty', name: 'MISTY', country: 'GB'}, BROCK = {id: 'u-brock', name: 'BROCK', country: 'US'};
let idn = 0;
const call = async (store: Store, who: typeof ASH, body: object) => {
  const [status, out] = await handleMatch(store, who, body, () => `M${++idn}`, () => 'u');
  return {status, out: out as any};
};
const serverMatches = Math.min(300, Math.floor(N / 10));
let serverRounds = 0;
for (let g = 0; g < serverMatches; g++) {
  const store = memoryStore();
  const r = mulberry32(g + 99);
  const o = opts(r);
  if (g % 5 === 0) o.randomTeams = 'both';
  const c = await call(store, ASH, {action: 'create', options: o, invite: 'MISTY'});
  const id = c.out.id;
  const inv = await call(store, MISTY, {action: 'invites'});
  if (!inv.out.invites?.some((x: any) => x.id === id)) bug('server: invite missing', id);
  if ((await call(store, BROCK, {action: 'invites'})).out.invites.length) bug('server: invite shown to the wrong player', id);
  const j = await call(store, MISTY, {action: 'join', id});
  if (j.out.stage !== 'picking') bug('server: join did not start picking', JSON.stringify(j.out).slice(0, 120));
  if ((await call(store, BROCK, {action: 'join', id})).status === 200 && (await call(store, BROCK, {action: 'state', id})).status === 200) bug('server: a third player can see the match', id);
  const seed = j.out.seed;
  const teams: Record<string, PickedTeam> = {};
  for (const [who, side] of [[ASH, 'host'], [MISTY, 'guest']] as const) {
    let t = o.randomTeams === 'both' ? randomTeam(o, seed, side) : buildTeam(o, seed, side, r);
    if (o.randomTeams === 'both') t = {...t, bag: {}};
    // First try a cheat: a team with a move it can't learn.
    const cheat = structuredClone(t); cheat.mons[0].moves = ['hyperbeam', 'psychic', 'thunderbolt', 'surf'].filter(m => !canLearnTm(cheat.mons[0].species, m) && !levelUpMovesAt(cheat.mons[0].species, cheat.mons[0].level).includes(m)).slice(0, 1);
    if (cheat.mons[0].moves.length && (await call(store, who, {action: 'setTeam', id, team: cheat})).status === 200) bug('server: accepted an illegal team', `${cheat.mons[0].species} ${cheat.mons[0].moves}`);
    const s = await call(store, who, {action: 'setTeam', id, team: t});
    if (s.status !== 200) bug('server: refused a legal team', `${s.out.error}`);
    if (side === 'host' && s.out.teams) bug('server: revealed teams before both were ready', id);
    teams[side] = t;
  }
  const st0 = (await call(store, ASH, {action: 'state', id})).out;
  if (st0.stage !== 'battle') { bug('server: battle did not start', st0.stage); continue; }
  for (let k = 0; k < 600; k++) {
    const v = (await call(store, ASH, {action: 'state', id})).out;
    if (v.stage === 'done') break;
    if (r() < 0.004) { await call(store, r() < 0.5 ? ASH : MISTY, {action: 'forfeit', id}); continue; }
    for (const [who, side] of [[ASH, 'player'], [MISTY, 'red']] as const) {
      const me = (await call(store, who, {action: 'state', id})).out;
      if (me.stage !== 'battle' || me.duty === 'wait' || me.chosen.me) continue;
      const b = Battle.replayPvp({seed: me.seed, clauses: {sleep: o.clauses.sleep, freeze: o.clauses.freeze},
        host: {name: 'ASH', team: toMons(me.teams.host), bag: {...me.teams.host.bag}}, guest: {name: 'MISTY', team: toMons(me.teams.guest), bag: {...me.teams.guest.bag}}}, me.rounds);
      const a = choose(b, side, r, illegalTried);
      if (!a) continue;
      const res = await call(store, who, {action: 'act', id, round: me.rounds.length, choice: a});
      if (res.status !== 200) bug('server: refused a legal action', `${res.out.error} ${JSON.stringify(a)}`);
      // Stale round number must not be accepted as a new move.
      if (r() < 0.05) {
        const stale = await call(store, who, {action: 'act', id, round: Math.max(0, me.rounds.length - 1), choice: a});
        if (stale.status === 200 && stale.out.rounds?.length > me.rounds.length + 1) bug('server: stale round counted twice', id);
      }
    }
    serverRounds++;
  }
  const end = (await call(store, MISTY, {action: 'state', id})).out;
  if (end.stage !== 'done') bug('server: match never finished', `${id} after many rounds`);
  else {
    const list = (await call(store, ASH, {action: 'list', opp: 'misty'})).out.matches;
    if (!list.some((m: any) => m.id === id && m.stage === 'done')) bug('server: finished match missing from head-to-head list', id);
    const l = list.find((m: any) => m.id === id);
    if (l && end.how === 'battle' && (!l.left || (l.won ? l.left.me === 0 && l.left.opp > 0 : l.left.opp === 0 && l.left.me > 0))) bug('server: wrong "Pokémon left" on the list', JSON.stringify(l));
  }
}
tally('server matches played', serverMatches);
tally('server rounds', serverRounds);

// Decline + timeout paths.
{
  const store = memoryStore();
  const {out} = await call(store, ASH, {action: 'create', options: DEFAULT_OPTIONS, invite: 'misty'});
  await call(store, MISTY, {action: 'decline', id: out.id});
  const st = (await call(store, ASH, {action: 'state', id: out.id})).out;
  if (!st.declined) bug('server: decline not shown to the host', out.id);
  if ((await call(store, MISTY, {action: 'invites'})).out.invites.length) bug('server: declined invite still shown', out.id);
}
{
  // Timeouts: the waiting player claims; after 3 auto-picks the slow player loses.
  const store = memoryStore();
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  const o = {...DEFAULT_OPTIONS, timer: 30 as const};
  const {out} = await call(store, ASH, {action: 'create', options: o});
  const j = (await call(store, MISTY, {action: 'join', id: out.id})).out;
  for (const [who, side] of [[ASH, 'host'], [MISTY, 'guest']] as const) await call(store, who, {action: 'setTeam', id: out.id, team: randomTeam(o, j.seed, side)});
  let v: any;
  for (let k = 0; k < 6; k++) {
    v = (await call(store, ASH, {action: 'state', id: out.id})).out;
    if (v.stage === 'done') break;
    if (v.duty !== 'wait' && !v.chosen.me) await call(store, ASH, {action: 'act', id: out.id, round: v.rounds.length, choice: v.duty === 'switch' ? {type: 'switch', index: v.teams.host.mons.findIndex(() => true)} : {type: 'move', slot: 0}});
    now += 40_000;
    v = (await call(store, ASH, {action: 'timeout', id: out.id})).out;
  }
  v = (await call(store, ASH, {action: 'state', id: out.id})).out;
  if (!(v.stage === 'done' && v.winner === 'host' && v.how === 'timeout')) bug('server: 3 timeouts did not end the match', `${v.stage} ${v.winner} ${v.how}`);
  Date.now = realNow;
}

console.error('stage: report', new Date().toISOString().slice(11,19));
// ---------- report ----------
const notUsed = PVP_ITEMS.filter(i => !itemUse.has(i));
console.log(JSON.stringify({
  seconds: Math.round((Date.now() - t0) / 1000), stats, winners, longestBattle: longest, stalls, illegalActionsTried: illegalTried.n,
  speciesSeenInRandomBattles: speciesSeen.size, distinctMovesUsed: moveUse.size, itemsNeverUsedInRandomBattles: notUsed,
  pokemonWithNoUsableMovesAtSomeLevel: noMoves,
  problems: Object.fromEntries([...problems].map(([k, v]) => [k, v])),
}, null, 2));
