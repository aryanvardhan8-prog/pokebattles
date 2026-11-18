import {describe, it, expect} from 'vitest';
import {Battle} from '../src/engine/battle';
import {LATER_MOVES, LATER_LEARNERS, MOVES, GEN1_MOVE_IDS} from '../src/engine/data';
import {canLearnTm, toMons, teamError, tmFor, DEFAULT_OPTIONS, type PickedTeam} from '../src/engine/pvp';
import {generateDay} from '../src/engine/daily';

const setup = (a: PickedTeam, b: PickedTeam, extra = {}) => ({seed: 't', clauses: {sleep: false, freeze: false, ...extra},
  host: {name: 'A', team: toMons(a), bag: {}}, guest: {name: 'B', team: toMons(b), bag: {}}});

describe('moves from later games', () => {
  it('are extra TMs only their Gen 1 learners can be taught, and Metronome still only picks Gen 1 moves', () => {
    expect(LATER_MOVES.length).toBeGreaterThan(20);
    expect(GEN1_MOVE_IDS).toHaveLength(165);
    for (const id of LATER_MOVES) {
      expect(tmFor(id)).not.toBeNull();
      expect(LATER_LEARNERS[id].length).toBeGreaterThan(0);
      expect(canLearnTm(LATER_LEARNERS[id][0], id)).toBe(true);
    }
    expect(canLearnTm('dragonite', 'dragonclaw')).toBe(true);
    expect(canLearnTm('magikarp', 'dragonclaw')).toBe(false);
  });

  it('every new move works in a battle (no crashes, attacks do damage)', () => {
    for (const id of LATER_MOVES) {
      const user = LATER_LEARNERS[id][0];
      const a: PickedTeam = {mons: [{species: user, level: 100, moves: [id]}], bag: {}};
      const b: PickedTeam = {mons: [{species: 'arcanine', level: 100, moves: ['leer']}], bag: {}}; // no type is immune to these
      const bt = Battle.pvp(setup(a, b));
      bt.start();
      const before = bt.sides.red.team[0].hp;
      for (let k = 0; k < 6 && !bt.winner; k++) bt.stepPvp({type: 'move', slot: 0}, {type: 'move', slot: 0});
      expect(bt.sides.red.team[0].hp, `${MOVES[id].name} should hurt`).toBeLessThan(before);
    }
  });

  it('the "Gen 1 moves only" rule bans them', () => {
    const t: PickedTeam = {mons: ['dragonite', 'snorlax', 'tauros', 'starmie', 'zapdos', 'chansey'].map((sp, i) => ({species: sp, level: 50, moves: i ? ['tackle'] : ['dragonclaw']})).map(m => (m.species === 'starmie' || m.species === 'zapdos' ? {...m, moves: ['tackle']} : m)), bag: {}};
    const o = {...DEFAULT_OPTIONS, clauses: {...DEFAULT_OPTIONS.clauses, gen1: true}};
    expect(teamError(t, o, [50, 50, 50, 50, 50, 50])).toMatch(/Gen 1 moves only/);
  });
});

describe('Hyper Beam recharge', () => {
  const ko = (extra: object) => {
    const a: PickedTeam = {mons: [{species: 'snorlax', level: 100, moves: ['hyperbeam']}], bag: {}};
    const b: PickedTeam = {mons: [{species: 'magikarp', level: 5, moves: ['splash']}, {species: 'magikarp', level: 100, moves: ['splash']}], bag: {}};
    const bt = Battle.pvp(setup(a, b, extra));
    bt.start();
    bt.stepPvp({type: 'move', slot: 0}, {type: 'move', slot: 0}); // KOs the Lv 5 Magikarp
    return bt.sides.player.v.recharge;
  };
  it('Gen 1 rule (older battles): no recharge after a knock-out', () => expect(ko({})).toBe(false));
  it('from 2026-10-23: always recharges', () => expect(ko({alwaysRecharge: true})).toBe(true));
  it('daily battles switch on the 23rd', () => {
    expect(generateDay('2026-10-22', '2026-10-22', 'medium').alwaysRecharge).toBeUndefined();
    expect(generateDay('2026-10-23', '2026-10-23', 'medium').alwaysRecharge).toBe(true);
  });
});

describe('100% moves', () => {
  const missRate = (date: string) => {
    let n = 0, miss = 0;
    for (let t = 0; t < 120; t++) {
      const b = new Battle(generateDay(date, `${date}-${t}`, 'medium'));
      (b as any).hits = new Proxy((b as any).hits, {apply(fn, self, args) { const r = Reflect.apply(fn, self, args); if (args[2].acc === 100 && !self.sides[args[0] === 'player' ? 'red' : 'player'].v.invulnerable) { n++; if (!r) miss++; } return r; }});
      b.start();
      for (let g = 0; g < 200 && !b.winner; g++) {
        const p = b.sides.player;
        if (b.needSwitch) b.step({type: 'switch', index: p.team.findIndex((m, i) => m.hp > 0 && i !== p.active)});
        else b.step({type: 'move', slot: b.usableSlots('player')[0] ?? -1});
      }
    }
    return {n, miss};
  };
  it('never miss from 2026-10-24 (no Gen 1 1-in-256 miss)', () => {
    const r = missRate('2026-10-24');
    expect(r.n).toBeGreaterThan(1000);
    expect(r.miss).toBe(0);
  });
  it('older days keep the Gen 1 1-in-256 miss', () => {
    expect(missRate('2026-10-23').miss).toBeGreaterThan(0);
  });
});
