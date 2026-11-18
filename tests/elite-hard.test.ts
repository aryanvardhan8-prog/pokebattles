import {describe, it, expect} from 'vitest';
import {eliteHardTeam, eliteDay, eliteStartTeam, replayElite, ELITE_OPTIONS, ELITE_RECOMMENDED} from '../src/engine/elite';
import {Battle} from '../src/engine/battle';
import {teamError, isAttack} from '../src/engine/pvp';

describe('Elite Four Hard', () => {
  it('everyone gets the same legal random team each day, 2+ attacks each, recommended items', () => {
    const a = eliteHardTeam('2026-10-23'), b = eliteHardTeam('2026-10-23'), c = eliteHardTeam('2026-10-24');
    expect(a).toEqual(b);
    expect(a.mons.map(m => m.species)).not.toEqual(c.mons.map(m => m.species));
    expect(teamError(a, ELITE_OPTIONS, [100, 100, 100, 100, 100, 100])).toBeNull();
    expect(a.bag).toEqual(ELITE_RECOMMENDED);
    for (let d = 1; d <= 28; d++) for (const m of eliteHardTeam(`2026-11-${String(d).padStart(2, '0')}`).mons) {
      expect(m.moves).toHaveLength(4);
      expect(m.moves.filter(isAttack).length).toBeGreaterThanOrEqual(2);
    }
  });
  it('a Hard run replays exactly (server check) and uses its own battle randomness', () => {
    const date = '2026-10-23', team = eliteHardTeam(date);
    const b = new Battle(eliteDay(date, 0, eliteStartTeam(team), 'hard'));
    b.start();
    for (let k = 0; k < 12 && !b.winner; k++) {
      if (b.needSwitch) b.step({type: 'switch', index: b.sides.player.team.findIndex((m, i) => m.hp > 0 && i !== b.sides.player.active)});
      else b.step({type: 'move', slot: b.usableSlots('player')[0] ?? -1});
    }
    const run = replayElite(date, team, [b.log], 'hard');
    expect(run.battles[0].sides.player.team.map(m => m.hp)).toEqual(b.sides.player.team.map(m => m.hp));
    expect(eliteDay(date, 0, eliteStartTeam(team), 'hard').seed).not.toBe(eliteDay(date, 0, eliteStartTeam(team), 'easy').seed);
  });
});
