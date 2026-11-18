// Pulls accurate Gen 1 data from @pkmn/dex and writes static JSON for the game.
import {Dex} from '@pkmn/dex';
import {Generations} from '@pkmn/data';
import {writeFileSync, readFileSync} from 'node:fs';

// Pokédex heights in metres (from Pokémon Showdown's Pokédex, saved once in scripts/heights.json).
const HEIGHTS: Record<string, number> = JSON.parse(readFileSync(new URL('./heights.json', import.meta.url), 'utf8'));

const gen = new Generations(Dex).get(1);
const species: Record<string, unknown> = {};
const learnsets: Record<string, string[]> = {};
const levelMoves: Record<string, string[]> = {}; // learned by levelling up (the rest are TM/HM only)
const learnLevels: Record<string, [number, string][]> = {}; // [level, move] for level-up moves, by level
const moveIds = new Set<string>();

for (const s of gen.species) {
  const b = s.baseStats;
  species[s.id] = {num: s.num, name: s.name.toUpperCase(), types: s.types, height: HEIGHTS[s.id],
    base: {hp: b.hp, atk: b.atk, def: b.def, spc: b.spa, spe: b.spe}};
  // Only moves this species learns itself in Red/Blue/Yellow: level-up ("1L") or TM/HM ("1M").
  const own = (await gen.learnsets.get(s.id))?.learnset ?? {};
  const learn = Object.keys(own).filter(m =>
    m !== 'struggle' && own[m].some(src => src.startsWith('1L') || src.startsWith('1M')));
  learnsets[s.id] = learn.sort();
  levelMoves[s.id] = learn.filter(m => own[m].some(src => src.startsWith('1L')));
  // e.g. "1L36" = learned at level 36 in Gen 1 (lowest level if listed twice).
  learnLevels[s.id] = levelMoves[s.id]
    .map(m => [Math.min(...own[m].filter(src => src.startsWith('1L')).map(src => Number(src.slice(2)) || 1)), m] as [number, string])
    .sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  learn.forEach(m => moveIds.add(m));
}
moveIds.add('struggle');

const moves: Record<string, unknown> = {};
for (const id of [...moveIds].sort()) {
  const m = gen.moves.get(id)!;
  const a = m as any;
  const out: Record<string, unknown> = {name: m.name.toUpperCase(), type: m.type, power: m.basePower,
    acc: m.accuracy === true ? null : m.accuracy, pp: m.pp, priority: m.priority,
    category: m.category, target: m.target};
  // Effect fields (only the ones present), from the Gen 1 mod of the Showdown data.
  for (const k of ['secondary', 'status', 'boosts', 'volatileStatus', 'drain', 'recoil', 'multihit', 'ohko', 'selfdestruct', 'damage', 'heal']) {
    if (a[k] !== undefined && a[k] !== null) out[k] = a[k];
  }
  if (m.critRatio && m.critRatio > 1) out.highCrit = true;
  if (a.flags?.charge) out.charge = true;
  if (a.flags?.recharge) out.recharge = true;
  if (a.self?.volatileStatus === 'lockedmove') out.thrash = true;
  if (a.volatileStatus === 'partiallytrapped') out.trap = true;
  if (a.self?.boosts) out.selfBoosts = a.self.boosts;
  moves[id] = out;
}

const types: Record<string, Record<string, number>> = {};
const names = [...gen.types].map(t => t.name);
for (const atk of names) {
  types[atk] = {};
  for (const def of names) {
    const e = gen.types.get(atk)!.effectiveness[def as never] as number;
    if (e !== 1) types[atk][def] = e;
  }
}
writeFileSync('src/data/types.json', JSON.stringify(types));
writeFileSync('src/data/species.json', JSON.stringify(species));
writeFileSync('src/data/learnsets.json', JSON.stringify(learnsets));
writeFileSync('src/data/levelmoves.json', JSON.stringify(levelMoves));
writeFileSync('src/data/moves.json', JSON.stringify(moves));
writeFileSync('src/data/learnlevels.json', JSON.stringify(learnLevels));
console.log(`${Object.keys(species).length} species, ${Object.keys(moves).length} moves`);
