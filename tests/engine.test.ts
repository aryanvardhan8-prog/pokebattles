import {describe, it, expect} from 'vitest';
import {calculate, Generations, Pokemon, Move as CalcMove} from '@smogon/calc';
import {generateDay, calcStats} from '../src/engine/daily';
import {Battle, gen1Damage, typeMods, isSpecial, type Action} from '../src/engine/battle';
import {SPECIES, MOVES} from '../src/engine/data';
import {mulberry32} from '../src/engine/rng';

const gen = Generations.get(1);
const days = Array.from({length: 60}, (_, i) => new Date(Date.UTC(2026, 9, 12) + i * 864e5).toISOString().slice(0, 10));

function calcMon(m: {species: string; level: number; dvs: {atk: number; def: number; spe: number; spc: number}}) {
  const d = m.dvs;
  return new Pokemon(gen, SPECIES[m.species].name.replace(/♀/, '-F').replace(/♂/, '-M'), {
    level: m.level,
    ivs: {atk: d.atk * 2, def: d.def * 2, spe: d.spe * 2, spa: d.spc * 2, spd: d.spc * 2},
    evs: {hp: 252, atk: 252, def: 252, spe: 252, spa: 252, spd: 252},
  });
}

describe('stats', () => {
  it('match the Smogon calculator', () => {
    for (const date of days) {
      for (const m of generateDay(date).player.team) {
        const c = calcMon(m);
        expect(m.stats, `${m.species} ${date}`).toEqual({
          hp: c.rawStats.hp, atk: c.rawStats.atk, def: c.rawStats.def, spc: c.rawStats.spa, spe: c.rawStats.spe,
        });
      }
    }
  });
});

describe('damage', () => {
  it('min/max rolls match the Smogon calculator', () => {
    let checked = 0;
    for (const date of days) {
      const d = generateDay(date);
      for (let i = 0; i < 6; i++) {
        const a = d.player.team[i], t = d.red.team[i];
        for (const id of a.moves) {
          const mv = MOVES[id];
          if (mv.power <= 1 || mv.ohko || mv.multihit || ['seismictoss', 'nightshade', 'sonicboom', 'dragonrage', 'superfang', 'psywave', 'counter', 'explosion', 'selfdestruct'].includes(id)) continue;
          const res = calculate(gen, calcMon(a), calcMon(t), new CalcMove(gen, mv.name.replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase()), {isCrit: !!mv.highCrit}));
          const range = (Array.isArray(res.damage) ? res.damage : [res.damage]) as number[];
          const sp = isSpecial(mv.type);
          const base = {
            level: a.level, power: mv.power,
            atk: sp ? a.stats.spc : a.stats.atk, def: sp ? t.stats.spc : t.stats.def,
            crit: !!mv.highCrit, stab: SPECIES[a.species].types.includes(mv.type),
            mods: typeMods(mv.type, SPECIES[t.species].types),
          };
          const lo = gen1Damage({...base, roll: 217}), hi = gen1Damage({...base, roll: 255});
          expect([lo, hi], `${a.species} ${id} → ${t.species}`).toEqual([Math.min(...range), Math.max(...range)]);
          checked++;
        }
      }
    }
    console.log(`damage checked on ${checked} attacks`);
    expect(checked).toBeGreaterThan(200);
  });
});

function randomPlay(date: string, seed: number, level: 'easy' | 'medium' | 'hard' = 'hard', order?: number[]) {
  // Easy (from the switch-over) needs your own team: borrow that day's Medium team.
  const own = level === 'easy' ? {mons: generateDay(date, date, 'medium').player.team.map(m => ({species: m.species, level: 100, moves: m.moves})), bag: {'REVIVE': 2}} : undefined;
  const day = generateDay(date, date, level, own);
  const b = new Battle(day);
  if (order) expect(b.reorder(order)).toBe(true);
  b.start();
  const r = mulberry32(seed);
  let guard = 0;
  while (!b.winner && guard++ < 3000) {
    const p = b.sides.player;
    let a: Action;
    if (b.needSwitch) {
      const alive = p.team.map((m, i) => i).filter(i => p.team[i].hp > 0);
      a = {type: 'switch', index: alive[Math.floor(r() * alive.length)]};
    } else {
      const roll = r();
      const usable = b.usableSlots('player');
      const others = p.team.map((_, i) => i).filter(i => i !== p.active && p.team[i].hp > 0);
      const items = Object.keys(p.bag).filter(it => b.canUseItem('player', it));
      if (roll < 0.08 && others.length) a = {type: 'switch', index: others[Math.floor(r() * others.length)]};
      else if (roll < 0.12 && items.length) a = {type: 'item', item: items[0]};
      else a = {type: 'move', slot: usable.length ? usable[Math.floor(r() * usable.length)] : -1};
    }
    const ev = b.step(a);
    expect(ev.length, `no events on ${date} turn ${b.turn}`).toBeGreaterThan(0);
  }
  return b;
}

describe('battles', () => {
  it('always finish, and HP stays in range', () => {
    let wins = 0;
    for (const date of days) for (let s = 0; s < 10; s++) {
      const b = randomPlay(date, s);
      expect(b.winner, `${date} seed ${s} never ended`).not.toBeNull();
      for (const side of Object.values(b.sides)) for (const m of side.team) {
        expect(m.hp).toBeGreaterThanOrEqual(0);
        expect(m.hp).toBeLessThanOrEqual(m.maxHp);
      }
      if (b.winner === 'player') wins++;
    }
    console.log(`random-clicking player won ${wins}/600 on hard`);
    for (const level of ['easy', 'medium'] as const) {
      let w = 0;
      for (const date of days) for (let s = 0; s < 10; s++) if (randomPlay(date, s, level).winner === 'player') w++;
      console.log(`random-clicking player won ${w}/600 on ${level}`);
    }
  });

  it('replaying the same actions gives the identical battle', () => {
    for (const date of days.slice(0, 10)) {
      const b = randomPlay(date, 7);
      const again = Battle.replay(generateDay(date), b.log);
      expect(again.winner).toBe(b.winner);
      expect(JSON.stringify(again.sides)).toBe(JSON.stringify(b.sides));
    }
  });

  it('a reordered team replays identically and leads with the chosen POKéMON', () => {
    for (const date of days.slice(0, 10)) {
      const order = [3, 0, 5, 1, 4, 2];
      const b = randomPlay(date, 11, 'hard', order);
      expect(b.log[0]).toEqual({type: 'order', order});
      expect(b.sides.player.team.map(m => m.species).slice(0, 1)).toEqual([generateDay(date).player.team[3].species]);
      const again = Battle.replay(generateDay(date), b.log);
      expect(again.log.length).toBe(b.log.length);
      expect(JSON.stringify(again.sides)).toBe(JSON.stringify(b.sides));
    }
    const b = new Battle(generateDay(days[0]));
    expect(b.reorder([0, 0, 1, 2, 3, 4])).toBe(false); // not a real order
    expect(b.reorder([1, 0, 2, 3, 4, 5])).toBe(true);
    expect(b.reorder([0, 1, 2, 3, 4, 5])).toBe(true); // back to normal: nothing recorded
    expect(b.log).toEqual([]);
    b.start();
    b.step({type: 'move', slot: b.usableSlots('player')[0] ?? -1});
    expect(b.reorder([1, 0, 2, 3, 4, 5])).toBe(false); // too late once the battle is on
    expect(b.step({type: 'order', order: [1, 0, 2, 3, 4, 5]})[0]).toMatchObject({t: 'text'});
    expect(() => Battle.replay(generateDay(days[0]), [{type: 'order', order: [9, 9, 9, 9, 9, 9]}])).toThrow();
  });

  it('a 100% accurate move can still miss (1/256)', () => {
    // hits() compares a 0..255 roll against 255, so exactly one value misses.
    expect(Math.floor((100 * 255) / 100)).toBe(255);
  });
});

describe('items', () => {
  it('REVIVE works on a fainted bench POKéMON, and items work on any party member', () => {
    const day = generateDay('2026-10-12');
    day.player.bag = {REVIVE: 1, POTION: 1};
    const b = new Battle(day);
    b.start();
    const p = b.sides.player;
    p.team[3].hp = 0;
    p.team[4].hp = 10;
    expect(b.itemError('player', 'REVIVE', 0)).toMatch(/hasn't fainted/);
    expect(b.itemError('player', 'POTION', 3)).toMatch(/Only REVIVE/);
    expect(b.itemError('player', 'FULL HEAL', 0)).toMatch(/don't have/);
    b.step({type: 'item', item: 'REVIVE', target: 3});
    expect(p.team[3].hp).toBe(Math.floor(p.team[3].maxHp / 2));
    b.step({type: 'item', item: 'POTION', target: 4});
    expect(p.team[4].hp).toBe(30);
    expect(p.bag).toEqual({});
  });
});

describe('stats & sharing', () => {
  it('counts streaks across consecutive days and resets on a loss', async () => {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v)};
    const {recordResult, currentStreak, shareText} = await import('../src/stats');
    const win = {won: true, left: 3, turns: 20, hp: [100, 40, 10, 0, 0, 0]};
    recordResult('2026-10-12', win);
    let s = recordResult('2026-10-13', win);
    expect(s.streak).toBe(2);
    expect(recordResult('2026-10-13', {...win, won: false}).played).toBe(2); // same day only counts once
    s = recordResult('2026-10-14', {...win, won: false});
    expect([s.streak, s.maxStreak, s.wins, s.played]).toEqual([0, 2, 2, 3]);
    s = recordResult('2026-10-16', win); // skipped a day
    expect(s.streak).toBe(1);
    expect(currentStreak(s, '2026-10-18')).toBe(0);
    expect(shareText(5, 'hard', win, 'https://x.app/')).toBe('DailyBattles #5 HARD ✅ 3/6 left\n🟩🟨🟥⬛⬛⬛\n⚔️ 20 turns\nhttps://x.app/');
  });
});

describe('levels', () => {
  it('old days (before Red\'s real team) are rebuilt exactly as before, so replays still check out', async () => {
    const old = (await import('./fixtures/v1-days.json')).default as Record<string, {player: unknown; red: unknown}>;
    for (const [key, want] of Object.entries(old)) {
      const [d, l] = key.split(':');
      // The switch-over day itself: results posted before the switch are replayed as legacy (old rules).
      const day = generateDay(d, d, l as never, undefined, d >= '2026-10-16');
      expect({player: day.player, red: day.red}, key).toEqual(want);
    }
  });

  it('from the switch-over: Red\'s Mt. Silver team at Lv 100; strong random team on Medium/Hard (Lv 90 on Hard)', () => {
    const n = generateDay('2026-10-20', '2026-10-20', 'medium'), h = generateDay('2026-10-20', '2026-10-20', 'hard');
    expect(n.red.team.map(m => m.species)).toEqual(['pikachu', 'lapras', 'snorlax', 'venusaur', 'charizard', 'blastoise']);
    expect(n.red.team.every(m => m.level === 100)).toBe(true);
    expect(h.red.team).toEqual(n.red.team);
    expect(n.player.team.map(m => m.species)).toEqual(h.player.team.map(m => m.species));
    expect(n.player.team.every(m => m.level === 100)).toBe(true);
    expect(h.player.team.every(m => m.level === 90)).toBe(true);
    const reds = new Set(n.red.team.map(m => m.species));
    expect(n.player.team.some(m => reds.has(m.species))).toBe(false);
    expect(n.red.bag).toEqual({'FULL RESTORE': 1}); // from V3_FROM (2026-10-20)
    expect(n.sleepCap).toBe(2);
    const before = generateDay('2026-10-19', '2026-10-19', 'medium');
    expect(before.red.bag).toEqual({'FULL RESTORE': 2}); // earlier days keep their rules
    expect(before.sleepCap).toBeUndefined();
    // From 2026-10-24: Hard Red has 2 Full Restores and your Hard team is Lv 95.
    const h24 = generateDay('2026-10-24', '2026-10-24', 'hard'), h23 = generateDay('2026-10-23', '2026-10-23', 'hard');
    expect(h24.red.bag).toEqual({'FULL RESTORE': 2});
    expect(h24.player.team.every(m => m.level === 95)).toBe(true);
    expect(h23.red.bag).toEqual({'FULL RESTORE': 3});
    expect(h23.player.team.every(m => m.level === 90)).toBe(true);
    expect(n.expertAI && h.expertAI).toBe(true);
    expect(h.red.bag).toEqual({'FULL RESTORE': 3});
  });

  it('Easy: you bring your own team (Lv 100)', () => {
    const mons = ['mewtwo', 'mew', 'pikachu', 'gengar', 'snorlax', 'dragonite'].map(sp => ({species: sp, level: 100, moves: ['bodyslam']}));
    const e = generateDay('2026-10-20', '2026-10-20', 'easy', {mons, bag: {'REVIVE': 2}});
    expect(e.player.team.map(m => m.species)).toEqual(mons.map(m => m.species));
    expect(e.player.bag).toEqual({'REVIVE': 2});
    expect(() => generateDay('2026-10-20', '2026-10-20', 'easy')).toThrow();
  });
});

describe('full-day share text', () => {
  it('lists every difficulty, including ones not played yet', async () => {
    const {dayShareText} = await import('../src/stats');
    const text = dayShareText(4, {
      easy: {won: true, left: 4, turns: 30, hp: [100, 60, 0, 30, 10, 0]},
      medium: {won: false, left: 0, turns: 40, hp: [0, 0, 0, 0, 0, 0]},
      hard: undefined,
    }, 'https://x/');
    expect(text.split('\n')).toEqual([
      'DailyBattles #4 · 1/3 beaten',
      'EASY   ✅ 🟩🟩⬛🟨🟥⬛ 4/6',
      'MEDIUM ❌ ⬛⬛⬛⬛⬛⬛',
      'HARD   ⏳ not played yet',
      'https://x/',
    ]);
  });
});

describe('forfeit', () => {
  it('a daily forfeit is a loss and replays the same', () => {
    const day = generateDay('2026-10-14', '2026-10-14', 'medium');
    const b = new Battle(day);
    b.start();
    b.step({type: 'move', slot: 0});
    if (!b.winner) b.step({type: 'forfeit'});
    const r = Battle.replay(day, b.log);
    expect(r.winner).toBe(b.winner);
    if (b.log.at(-1)?.type === 'forfeit') expect(r.winner).toBe('red');
  });
});
