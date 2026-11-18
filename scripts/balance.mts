// Balance check for the daily battle: a "sensible player" bot plays many days on each difficulty.
// Usage: npx tsx scripts/balance.mts [days] [hardLevel]
import {generateDay, calcStats, LEVEL_RULES, type AnyLevel} from '../src/engine/daily';
import {Battle, typeMods, type Action} from '../src/engine/battle';
import {MOVES, SPECIES} from '../src/engine/data';
import {startingMoves, bestMoves, DEFAULT_OPTIONS} from '../src/engine/pvp';
const pct = (r: number[], n: number) => `${Math.round(r.slice(n).reduce((a, b) => a + b, 0) / r.reduce((a, b) => a + b, 0) * 100)}%`.padStart(4);

const DAYS = Number(process.argv[2] ?? 150);
if (process.argv[3]) LEVEL_RULES.hard.playerLevel = Number(process.argv[3]);
if (process.argv[4]) LEVEL_RULES.medium.playerLevel = Number(process.argv[4]);
if (process.env.MFR) LEVEL_RULES.medium.redBag = {'FULL RESTORE': +process.env.MFR};
if (process.env.HFR) LEVEL_RULES.hard.redBag = {'FULL RESTORE': +process.env.HFR};
if (process.env.NOEXPERT) { LEVEL_RULES.medium.expertAI = false; LEVEL_RULES.hard.expertAI = false; }

const eff = (type: string, defTypes: string[]) => typeMods(type, defTypes).reduce((a, b) => a * b, 1);
function moveValue(b: Battle, slot: number) {
  const me = b.mon('player'), foe = b.mon('red');
  const id = b.sides.player.v.moves[slot] ?? me.moves[slot];
  const mv = MOVES[id];
  if (!mv) return 0;
  const foeTypes = SPECIES[foe.species].types;
  if (mv.power > 1) return mv.power * (mv.acc ?? 100) / 100 * eff(mv.type, foeTypes) * (SPECIES[me.species].types.includes(mv.type) ? 1.5 : 1) * (id === 'hyperbeam' ? 0.6 : 1) * (id === 'explosion' || id === 'selfdestruct' ? 0.3 : 1);
  if (['seismictoss', 'nightshade'].includes(id)) return me.level * 0.9;
  if (mv.status && !foe.status && ['slp', 'par'].includes(mv.status)) return 70 * (mv.acc ?? 100) / 100 * (eff(mv.type, foeTypes) ? 1 : 0);
  return 5;
}
function bestSwitch(b: Battle): number {
  const p = b.sides.player, foe = b.mon('red');
  let best = -1, score = -Infinity;
  p.team.forEach((m, i) => {
    if (m.hp <= 0 || i === p.active) return;
    const def = eff(SPECIES[foe.species].types[0], SPECIES[m.species].types);
    const atk = Math.max(...m.moves.map(id => MOVES[id].power > 1 ? eff(MOVES[id].type, SPECIES[foe.species].types) : 0.5));
    const s = atk * 2 - def + m.hp / m.maxHp;
    if (s > score) { score = s; best = i; }
  });
  return best;
}
function act(b: Battle): Action {
  if (b.needSwitch) return {type: 'switch', index: bestSwitch(b)};
  if (b.lockedMove('player')) return {type: 'move', slot: -2};
  const p = b.sides.player, me = b.mon('player');
  // Uses the whole bag like a sensible player:
  const use = (it: string, target = p.active): Action | null => (p.bag[it] && b.canUseItem('player', it, target) ? {type: 'item', item: it, target} : null);
  // Revive the healthiest-looking fainted Pokémon when the team is getting thin.
  const alive = p.team.filter(m => m.hp > 0).length;
  if (alive <= 3) for (let i = 0; i < p.team.length; i++) if (p.team[i].hp <= 0) { const a = use('REVIVE', i); if (a) return a; }
  // Cure sleep/freeze/paralysis/burn/poison.
  if (me.status) for (const it of ['FULL HEAL', ({slp: 'AWAKENING', frz: 'ICE HEAL', par: 'PARLYZ HEAL', brn: 'BURN HEAL', psn: 'ANTIDOTE', tox: 'ANTIDOTE'} as Record<string, string>)[me.status] ?? '']) { const a = it && use(it); if (a) return a; }
  // Heal when low.
  if (me.hp / me.maxHp < 0.3) for (const it of ['FULL RESTORE', 'MAX POTION', 'HYPER POTION', 'SUPER POTION', 'POTION']) { const a = use(it); if (a) return a; }
  // Boost on the first turn out while healthy.
  if (p.v.turnsOut === 0 && me.hp / me.maxHp > 0.7) for (const it of ['X SPEED', 'X ATTACK', 'X SPECIAL', 'X ACCURACY', 'DIRE HIT']) { const a = use(it); if (a) return a; }
  const slots = b.usableSlots('player');
  if (!slots.length) return {type: 'move', slot: -1};
  return {type: 'move', slot: slots.reduce((a, c) => (moveValue(b, c) > moveValue(b, a) ? c : a))};
}
function play(level: AnyLevel, date: string) {
  const day = generateDay(date, date, level);
  // Experiments (env): PDV=1 perfect DVs for you, AI=simple, BAG=0, REDLV=n
  if (process.env.REDLV && day.red.team[0].level === 100) day.red.team = day.red.team.map(m => ({...m, level: +process.env.REDLV!, stats: calcStats(m.species, +process.env.REDLV!, m.dvs)}));
  if (process.env.PDV && day.red.team[0].species === 'pikachu') day.player.team = day.player.team.map(m => ({...m, dvs: {atk: 15, def: 15, spe: 15, spc: 15}, stats: calcStats(m.species, m.level, {atk: 15, def: 15, spe: 15, spc: 15})}));
  if (process.env.AI === 'simple' && day.red.team[0].species === 'pikachu') day.smartAI = false;
  if (process.env.BAG === '0' && day.red.team[0].species === 'pikachu') day.red.bag = {};
  // STRONG=bst: your team is 6 random Pokémon with base stat total >= bst, best moves, perfect DVs.
  if (process.env.STRONG && day.red.team[0].species === 'pikachu') {
    const reds = new Set(day.red.team.map(m => m.species));
    const pool = Object.keys(SPECIES).filter(sp => !reds.has(sp) && Object.values(SPECIES[sp].base).reduce((a, b) => a + b, 0) >= +process.env.STRONG!);
    let x = [...date].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
    const rnd = () => ((x = (x * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const picks: string[] = [];
    while (picks.length < Math.min(6, pool.length)) { const sp = pool[Math.floor(rnd() * pool.length)]; if (!picks.includes(sp)) picks.push(sp); }
    const lv = day.player.team[0].level, dv = {atk: 15, def: 15, spe: 15, spc: 15};
    day.player.team = picks.map(sp => ({species: sp, level: lv, moves: startingMoves(sp, lv, DEFAULT_OPTIONS.clauses), dvs: dv, stats: calcStats(sp, lv, dv)}));
  }
  const b = new Battle(day);
  b.start();
  for (let i = 0; i < 2000 && !b.winner; i++) {
    const a = act(b);
    if (b.validate(a)) { b.step({type: 'move', slot: b.usableSlots('player')[0] ?? -1}); continue; }
    b.step(a);
  }
  return {won: b.winner === 'player', left: b.sides.player.team.filter(m => m.hp > 0).length};
}
const dates = (from: string) => Array.from({length: DAYS}, (_, i) => new Date(Date.parse(from) + i * 864e5).toISOString().slice(0, 10));
const report = (label: string, level: AnyLevel, ds: string[]) => {
  const r = ds.map(d => play(level, d));
  const w = r.filter(x => x.won);
  console.log(`${label.padEnd(22)} win ${(w.length / r.length * 100).toFixed(0).padStart(3)}%   avg left when won ${(w.reduce((a, x) => a + x.left, 0) / (w.length || 1)).toFixed(1)}`);
};
// ELITE=1: a bot with a strong hand-built team runs the Elite Four gauntlet (HP/PP carry over).
if (process.env.ELITE) {
  const {ELITE, eliteDay, eliteStartTeam, carryOver, ELITE_TUNING} = await import('../src/engine/elite');
  if (process.env.ELV) ELITE_TUNING.levels = process.env.ELV.split(',').map(Number);
  if (process.env.EXP) ELITE_TUNING.expertAI = true;
  if (process.env.EFR) ELITE_TUNING.fullRestores = process.env.EFR.split(',').map(Number);
  const teams = [
    ['mewtwo', 'snorlax', 'tauros', 'starmie', 'zapdos', 'exeggutor'],
    ['alakazam', 'snorlax', 'tauros', 'chansey', 'jolteon', 'rhydon'],
    ['dragonite', 'gengar', 'lapras', 'machamp', 'arcanine', 'jynx'],
  ];
  for (const sp of teams) {
    const reached = [0, 0, 0, 0, 0, 0];
    for (const d of dates('2027-03-01')) {
      let you = eliteStartTeam({mons: sp.map(s => ({species: s, level: 100, moves: bestMoves(s, 100)})), bag: {'FULL RESTORE': 2, 'REVIVE': 2, 'MAX POTION': 2}});
      let cleared = 0;
      for (let i = 0; i < ELITE.length; i++) {
        const b = new Battle(eliteDay(d, i, you));
        b.start();
        for (let k = 0; k < 2000 && !b.winner; k++) { const a = act(b); b.step(b.validate(a) ? {type: 'move', slot: b.usableSlots('player')[0] ?? -1} : a); }
        if (b.winner !== 'player') break;
        cleared++;
        you = carryOver(b);
      }
      reached[cleared]++;
    }
    console.log(sp.join(',').padEnd(52), 'beat Lorelei', pct(reached, 1), ' Bruno', pct(reached, 2), ' Agatha', pct(reached, 3), ' Lance', pct(reached, 4), ' CHAMPION', pct(reached, 5));
  }
  process.exit(0);
}
// Old rules for comparison (days before the switch-over were generated with these).
const old = dates('2025-01-01');
report('OLD easy', 'easy', old); report('OLD medium', 'medium', old); report('OLD hard', 'hard', old);
const now = dates('2027-01-01');
report(`NEW medium (${LEVEL_RULES.medium.playerLevel} v 100)`, 'medium', now);
report(`NEW hard (${LEVEL_RULES.hard.playerLevel} v 100)`, 'hard', now);
