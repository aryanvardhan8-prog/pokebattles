// Builds src/data/newmoves.json: moves from later Pokémon games added as extra TMs (team builder only),
// adapted to Gen 1 rules (physical/special by type, no weather/abilities/items), with the Gen 1 Pokémon
// that learn each one in any later game (Showdown learnsets: level-up, TM, tutor or egg).
// Run: npx tsx scripts/new-moves.mts
import {Dex} from '@pkmn/dex';
import {writeFileSync, readFileSync} from 'node:fs';

const species = JSON.parse(readFileSync('src/data/species.json', 'utf8')) as Record<string, unknown>;
// id → Gen 1 version (power/acc/pp from the later games; effects simplified to what Gen 1 can do).
const NEW: Record<string, Record<string, unknown>> = {
  dragonclaw: {}, dragonbreath: {secondary: {chance: 30, status: 'par'}}, twister: {secondary: {chance: 20, volatileStatus: 'flinch'}},
  outrage: {thrash: true, power: 90}, dragonpulse: {},
  shadowball: {secondary: {chance: 20, boosts: {spa: -1, spd: -1}}}, shadowpunch: {acc: null},
  rocktomb: {secondary: {chance: 100, boosts: {spe: -1}}}, ancientpower: {}, stoneedge: {highCrit: true},
  signalbeam: {secondary: {chance: 10, volatileStatus: 'confusion'}}, xscissor: {}, megahorn: {},
  mudshot: {secondary: {chance: 100, boosts: {spe: -1}}}, bonerush: {multihit: [2, 5]}, earthpower: {secondary: {chance: 10, boosts: {spa: -1, spd: -1}}},
  heatwave: {secondary: {chance: 10, status: 'brn'}}, icywind: {secondary: {chance: 100, boosts: {spe: -1}}},
  spark: {secondary: {chance: 30, status: 'par'}}, crosschop: {highCrit: true}, aerialace: {acc: null}, poisonjab: {secondary: {chance: 30, status: 'psn'}},
};
const SPECIAL = new Set(['Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon']);
const moves: Record<string, unknown> = {}, learners: Record<string, string[]> = {};
for (const [id, extra] of Object.entries(NEW)) {
  const m = Dex.moves.get(id);
  if (!m.exists) throw new Error(`No move ${id}`);
  moves[id] = {
    name: m.name.toUpperCase(), type: m.type, power: m.basePower, acc: m.accuracy === true ? null : m.accuracy, pp: m.pp,
    priority: 0, category: SPECIAL.has(m.type) ? 'Special' : 'Physical', target: 'normal', later: true, ...extra,
  };
  learners[id] = [];
}
for (const sp of Object.keys(species)) {
  // The species and its whole evolution family's own learnsets, every generation.
  const ls = await Dex.learnsets.get(sp);
  for (const id of Object.keys(NEW)) if (ls?.learnset?.[id]?.length) learners[id].push(sp);
}
writeFileSync('src/data/newmoves.json', JSON.stringify({moves, learners}));
for (const [id, l] of Object.entries(learners)) console.log(id.padEnd(13), l.length, l.slice(0, 8).join(' '));
