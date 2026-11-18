import {describe, it, expect} from 'vitest';
import {ELITE, eliteDay, eliteStartTeam, carryOver, replayElite} from '../src/engine/elite';
import {Battle, type Action} from '../src/engine/battle';
import {LEARNSETS} from '../src/engine/data';
import {levelUpMovesAt, startingMoves, DEFAULT_OPTIONS} from '../src/engine/pvp';
import {mulberry32} from '../src/engine/rng';

const strong = ['mewtwo', 'mew', 'dragonite', 'snorlax', 'alakazam', 'starmie'];
const myTeam = {mons: strong.map(sp => ({species: sp, level: 100, moves: startingMoves(sp, 100, DEFAULT_OPTIONS.clauses)})), bag: {'FULL RESTORE': 2, 'REVIVE': 2, 'MAX POTION': 2}};

/** A random-ish player that always picks a legal action. */
function play(b: Battle, seed: number) {
  const r = mulberry32(seed);
  b.start();
  for (let g = 0; g < 3000 && !b.winner; g++) {
    const p = b.sides.player;
    let a: Action;
    if (b.needSwitch) {
      const alive = p.team.map((_, i) => i).filter(i => p.team[i].hp > 0);
      a = {type: 'switch', index: alive[Math.floor(r() * alive.length)]};
    } else {
      const usable = b.usableSlots('player');
      a = {type: 'move', slot: usable.length ? usable[Math.floor(r() * usable.length)] : -1};
    }
    b.step(a);
  }
  return b;
}

describe('Elite Four', () => {
  it('every Elite Four move is one that Pokémon can learn in Gen 1', () => {
    for (const e of ELITE) for (const m of e.team) {
      const ok = new Set([...LEARNSETS[m.species], ...levelUpMovesAt(m.species, 100)]);
      for (const mv of m.moves) expect(ok.has(mv), `${e.key} ${m.species} ${mv}`).toBe(true);
    }
  });

  it('HP, PP and status carry over to the next battle; fainted Pokémon go to the back', () => {
    const b = play(new Battle(eliteDay('2026-10-20', 0, eliteStartTeam(myTeam))), 3);
    expect(b.winner).not.toBeNull();
    const next = carryOver(b);
    const end = b.sides.player.team.map(m => `${m.species}:${m.hp}:${m.pp.join('/')}:${m.status}`).sort();
    expect(next.team.map(m => `${m.species}:${m.start!.hp}:${m.start!.pp.join('/')}:${m.start!.status}`).sort()).toEqual(end);
    const b2 = new Battle(eliteDay('2026-10-20', 1, next));
    expect(b2.sides.player.team.map(m => m.hp)).toEqual(next.team.map(m => m.start!.hp));
    if (b.winner === 'player') expect(b2.sides.player.team[0].hp).toBeGreaterThan(0); // a standing Pokémon leads
    expect(b2.trainers.red).toBe('BRUNO');
  });

  it('a whole run replays exactly from the team and the action logs', () => {
    let you = eliteStartTeam(myTeam);
    const logs: Action[][] = [];
    for (let i = 0; i < ELITE.length; i++) {
      const b = play(new Battle(eliteDay('2026-10-21', i, you)), 10 + i);
      logs.push(b.log);
      if (b.winner !== 'player') break;
      you = carryOver(b);
    }
    const run = replayElite('2026-10-21', myTeam, logs);
    expect(run.over).toBe(true);
    expect(run.battles.length).toBe(logs.length);
    expect(run.cleared).toBe(run.won ? 5 : logs.length - 1);
    // A tampered log doesn't check out.
    const bad = logs.map(l => [...l]);
    bad[0].push({type: 'move', slot: 0});
    expect(() => replayElite('2026-10-21', myTeam, bad)).toThrow();
  });
});
