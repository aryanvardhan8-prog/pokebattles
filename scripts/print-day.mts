import {generateDay, todayUTC} from '../src/engine/daily';
import {SPECIES, MOVES} from '../src/engine/data';
const d = generateDay(process.argv[2] ?? todayUTC());
console.log(`POKEBATTLES #${d.number}  (${d.date})`);
for (const [who, side] of [['YOU', d.player], ['RED', d.red]] as const) {
  console.log(`\n${who}`);
  for (const m of side.team) console.log(`  ${SPECIES[m.species].name.padEnd(11)} L${m.level}  HP${m.stats.hp}  ${m.moves.map(x => MOVES[x].name).join(', ')}`);
  console.log('  BAG: ' + Object.entries(side.bag).map(([i, n]) => `${i} x${n}`).join(', '));
}
