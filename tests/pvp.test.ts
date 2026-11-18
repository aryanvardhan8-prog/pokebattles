import {describe, it, expect} from 'vitest';
import {canLearnTm, defaultMoveset, levelUpMovesAt, teamError, tmUses, randomTeam, levelsFor, toMons, DEFAULT_OPTIONS, TMS, type PickedTeam} from '../src/engine/pvp';
import {generateDay} from '../src/engine/daily';

const team = (mons: PickedTeam['mons'], bag = {}): PickedTeam => ({mons, bag});
const six = (level = 50) => ['charizard', 'blastoise', 'venusaur', 'pikachu', 'snorlax', 'gengar']
  .map(species => ({species, level, moves: defaultMoveset(species, level)}));

describe('PvP rules', () => {
  it('default moveset is the last 4 level-up moves at that level', () => {
    expect(defaultMoveset('charizard', 30)).toHaveLength(4);
    expect(defaultMoveset('charizard', 30)).toContain('rage');
    expect(defaultMoveset('charizard', 30)).not.toContain('slash'); // learned at 36
    expect(defaultMoveset('charizard', 50)).toEqual(expect.arrayContaining(['rage', 'slash', 'flamethrower']));
    expect(defaultMoveset('charizard', 100)).toContain('firespin');
    expect(levelUpMovesAt('charizard', 30)).toContain('ember'); // older moves can be kept
    expect(defaultMoveset('magikarp', 50)).toContain('splash');
  });

  it('50 Gen 1 TMs, 5 HMs, then extra TMs (Flamethrower first) only for Pokémon that learn them in the games', () => {
    expect(TMS.slice(0, 50).every(t => !t.hm)).toBe(true);
    expect(TMS.find(t => t.id === 'flamethrower')?.label).toBe('TM51');
    expect(TMS.some(t => canLearnTm('ditto', t.id))).toBe(false);
    expect(canLearnTm('starmie', 'recover')).toBe(true);
    expect(canLearnTm('snorlax', 'recover')).toBe(false);
    expect(TMS.filter(t => t.hm)).toHaveLength(5);
  });

  it('checks teams: size, levels, moves, TM and item caps, clauses', () => {
    const o = DEFAULT_OPTIONS;
    expect(teamError(team(six()), o)).toBeNull();
    expect(teamError(team(six().slice(0, 5)), o)).toMatch(/Pick 6/);
    expect(teamError(team(six(70)), o)).toMatch(/level 50/);
    const dup = six(); dup[1] = {...dup[0]};
    expect(teamError(team(dup), o)).toMatch(/Species Clause/);
    expect(teamError(team(dup), {...o, clauses: {...o.clauses, species: false}})).toBeNull();
    const bad = six(); bad[0] = {...bad[0], moves: ['surf']}; // Charizard can't learn Surf
    expect(teamError(team(bad), o)).toMatch(/can't learn/);
    const tm = six(); tm[0] = {...tm[0], moves: ['earthquake', 'fireblast', 'swordsdance', 'fly']}; // 3 TMs + 1 HM
    expect(tmUses(team(tm))).toBe(3);
    expect(teamError(team(tm), {...o, tms: 2})).toMatch(/Too many TMs/);
    expect(teamError(team(tm), {...o, tms: null})).toBeNull();
    const ohko = six(); ohko[4] = {...ohko[4], moves: ['fissure']};
    expect(teamError(team(ohko), o)).toMatch(/OHKO/);
    expect(teamError(team(six(), {'POTION': 4}), o)).toMatch(/Too many items/);
    expect(teamError(team(six(), {'FULL RESTORE': 1}), o)).toMatch(/isn't allowed/);
  });

  it('random teams and levels are legal and the same for everyone with the same seed', () => {
    const o = {...DEFAULT_OPTIONS, level: 'random' as const, randomTeams: 'both' as const};
    for (const seed of ['a', 'b', 'c', 'd']) {
      const t = randomTeam(o, seed, 'host');
      expect(teamError(t, o, levelsFor(o, seed, 'host'))).toBeNull();
      expect(randomTeam(o, seed, 'host')).toEqual(t);
      expect(toMons(t).every(m => m.stats.hp > 0)).toBe(true);
    }
    expect(levelsFor(o, 'x', 'host').every(l => l >= 30 && l <= 100)).toBe(true);
  });

  it('daily teams are unchanged by the PvP data', () => {
    expect(generateDay('2026-10-14', '2026-10-14', 'easy').player.team.map(m => m.species).join(','))
      .toMatchInlineSnapshot(`"charmeleon,dratini,kadabra,oddish,dodrio,beedrill"`);
  });
});

import {Battle, type PvpSetup, type Action, type SideId} from '../src/engine/battle';
import {mulberry32} from '../src/engine/rng';

function setup(seed: string, o = {...DEFAULT_OPTIONS, randomTeams: 'both' as const, level: 'random' as const}): PvpSetup {
  const bag = {'POTION': 1, 'REVIVE': 1, 'X SPEED': 1};
  return {seed, clauses: {sleep: true, freeze: true},
    host: {name: 'ASH', team: toMons(randomTeam(o, seed, 'host')), bag},
    guest: {name: 'MISTY', team: toMons(randomTeam(o, seed, 'guest')), bag}};
}

/** A random but legal choice for one side. */
function choose(b: Battle, side: SideId, r: () => number): Action | null {
  const s = b.sides[side];
  const need = side === 'player' ? b.needSwitch : b.needSwitchRed;
  const other = side === 'player' ? b.needSwitchRed : b.needSwitch;
  if (!need && other) return null;
  const alive = s.team.map((m, i) => i).filter(i => s.team[i].hp > 0 && i !== s.active);
  if (need) return {type: 'switch', index: alive[Math.floor(r() * alive.length)]};
  const roll = r();
  if (roll < 0.1 && alive.length) return {type: 'switch', index: alive[Math.floor(r() * alive.length)]};
  const items = Object.keys(s.bag).filter(it => b.canUseItem(side, it));
  if (roll < 0.15 && items.length) return {type: 'item', item: items[0]};
  const usable = b.usableSlots(side);
  return {type: 'move', slot: usable.length ? usable[Math.floor(r() * usable.length)] : -1};
}

function playPvp(seed: string) {
  const b = Battle.pvp(setup(seed));
  b.start();
  const r = mulberry32(seed.length * 7919 + 3);
  let guard = 0;
  while (!b.winner && guard++ < 2000) {
    const ev = b.stepPvp(choose(b, 'player', r), choose(b, 'red', r));
    expect(ev.length).toBeGreaterThan(0);
    expect(ev[0].t === 'text' && /Choose|Waiting|No PP|already|no will/.test(ev[0].s) && ev.length === 1).toBe(false);
  }
  return b;
}

describe('PvP battles', () => {
  it('random friend battles always finish', () => {
    for (let i = 0; i < 200; i++) expect(playPvp(`s${i}`).winner).not.toBeNull();
  });

  it('both players and the server get the same battle (whoever is watching)', () => {
    for (let i = 0; i < 20; i++) {
      const b = playPvp(`d${i}`);
      const host = Battle.replayPvp(setup(`d${i}`), b.pvpLog, 'player');
      const guest = Battle.replayPvp(setup(`d${i}`), b.pvpLog, 'red');
      expect(JSON.stringify(host.sides)).toBe(JSON.stringify(b.sides));
      expect(JSON.stringify(guest.sides)).toBe(JSON.stringify(b.sides));
      expect(guest.winner).toBe(b.winner);
    }
  });

  it('writes the text from each player’s side', () => {
    const host = Battle.pvp(setup('t'), 'player'), guest = Battle.pvp(setup('t'), 'red');
    const h = host.start().filter(e => e.t === 'text').map(e => (e as {s: string}).s);
    const g = guest.start().filter(e => e.t === 'text').map(e => (e as {s: string}).s);
    expect(h[0]).toBe('MISTY wants to fight!');
    expect(g[0]).toBe('ASH wants to fight!');
    expect(h.some(s => s.startsWith('Go! '))).toBe(true);
    expect(g.some(s => s.startsWith('ASH sent out'))).toBe(true);
  });

  it('Sleep Clause: only one of your POKéMON can be put to sleep by the foe', () => {
    const mk = (species: string, moves: string[]) => ({species, level: 50, moves});
    const s: PvpSetup = {seed: 'sleep', clauses: {sleep: true, freeze: true}, host: {name: 'A', bag: {},
      team: toMons({bag: {}, mons: [mk('gengar', ['hypnosis']), ...['pikachu', 'eevee', 'abra', 'rattata', 'pidgey'].map(x => mk(x, ['tackle'].filter(() => true)))]})},
      guest: {name: 'B', bag: {}, team: toMons({bag: {}, mons: ['snorlax', 'chansey', 'lapras', 'slowbro', 'onix', 'geodude'].map(x => mk(x, ['splash']))})}};
    // Gengar keeps using Hypnosis; the guest switches after one of theirs falls asleep.
    const b = Battle.pvp(s);
    b.start();
    let asleep = 0;
    for (let i = 0; i < 40 && !b.winner; i++) {
      const sleeping = b.sides.red.team.filter(m => m.status === 'slp').length;
      asleep = Math.max(asleep, sleeping);
      const g: Action = b.mon('red').status === 'slp'
        ? {type: 'switch', index: b.sides.red.team.findIndex((m, k) => k !== b.sides.red.active && m.hp > 0 && m.status !== 'slp')}
        : {type: 'move', slot: 0};
      b.stepPvp({type: 'move', slot: 0}, g.type === 'switch' && g.index < 0 ? {type: 'move', slot: 0} : g);
    }
    expect(asleep).toBe(1);
  });
});

describe('PvP fixes', () => {
  const mk = (species: string, moves: string[]) => ({species, level: 50, moves});
  const team = (mons: {species: string; level: number; moves: string[]}[]) => toMons({mons, bag: {}});
  it('double knockout: the player whose move caused it loses', () => {
    for (const exploder of ['player', 'red'] as SideId[]) {
      const boom = team([mk('electrode', ['explosion'])]), weak = team([mk('caterpie', ['tackle'])]);
      const s: PvpSetup = {seed: 'boom', clauses: {sleep: true, freeze: true},
        host: {name: 'A', bag: {}, team: exploder === 'player' ? boom : weak}, guest: {name: 'B', bag: {}, team: exploder === 'red' ? boom : weak}};
      const b = Battle.pvp(s);
      b.start();
      for (let i = 0; i < 5 && !b.winner; i++) b.stepPvp({type: 'move', slot: 0}, {type: 'move', slot: 0});
      if (b.sides.player.team[0].hp === 0 && b.sides.red.team[0].hp === 0) expect(b.winner).toBe(exploder === 'player' ? 'red' : 'player');
    }
  });
  it('Struggle hits Ghosts in friend battles (no endless battles)', () => {
    const s: PvpSetup = {seed: 'ghost', clauses: {sleep: true, freeze: true},
      host: {name: 'A', bag: {}, team: team([mk('rattata', ['tackle'])])}, guest: {name: 'B', bag: {}, team: team([mk('gastly', ['splash' as string].filter(() => false).concat(['lick']))])}};
    const b = Battle.pvp(s);
    b.start();
    b.sides.player.team[0].pp = [0];
    const hp = b.sides.red.team[0].hp;
    b.stepPvp({type: 'move', slot: -1}, {type: 'move', slot: 0});
    expect(b.sides.red.team[0].hp).toBeLessThan(hp);
  });
});

describe('starting movesets', () => {
  it('everyone starts with at least 2 attacks when they can learn them by levelling up', async () => {
    const {SPECIES, MOVES} = await import('../src/engine/data');
    const {startingMoves, levelUpMovesAt, isBanned} = await import('../src/engine/pvp');
    const c = DEFAULT_OPTIONS.clauses;
    const isAttack = (m: string) => MOVES[m].category !== 'Status';
    for (const sp of Object.keys(SPECIES)) for (const lv of [30, 50, 70, 100]) {
      const available = levelUpMovesAt(sp, lv).filter(m => !isBanned(m, c) && isAttack(m)).length;
      const got = startingMoves(sp, lv, c);
      expect(got.length).toBeLessThanOrEqual(4);
      expect(got.filter(isAttack).length, `${sp} Lv${lv}`).toBeGreaterThanOrEqual(Math.min(2, available));
    }
  });
});
