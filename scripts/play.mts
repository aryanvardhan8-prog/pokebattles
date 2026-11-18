// Text-only version of the daily battle, for testing the engine before the graphics exist.
import {createInterface} from 'node:readline/promises';
import {generateDay, todayUTC} from '../src/engine/daily';
import {Battle, type Action, type BattleEvent} from '../src/engine/battle';
import {SPECIES, MOVES} from '../src/engine/data';

const rl = createInterface({input: process.stdin, output: process.stdout});
const b = new Battle(generateDay(process.argv[2] ?? todayUTC()));
const show = (ev: BattleEvent[]) => ev.forEach(e => e.t === 'text' && console.log('  ' + e.s));
const bar = (side: 'player' | 'red') => {
  const m = b.mon(side);
  return `${b.name(side)} L${m.level} ${m.hp}/${m.maxHp}${m.status ? ' ' + m.status.toUpperCase() : ''}`;
};
const FIXED: Record<string, string> = {
  seismictoss: '=LV', nightshade: '=LV', sonicboom: '20dmg', dragonrage: '40dmg', superfang: '1/2HP', psywave: 'random',
};
const powerLabel = (id: string) => {
  const m = MOVES[id];
  if (FIXED[id]) return FIXED[id];
  if (m.ohko) return 'OHKO';
  if (id === 'counter' || id === 'bide') return 'x2';
  return m.power > 1 ? String(m.power) : '-';
};

console.log('\n  HOW TO PLAY: type 1-4 to attack, s3 to switch to POKéMON 3,');
console.log('  i1 4 to use item 1 on POKéMON 4 (ETHER: i1 4 2 = move 2), then press Enter.\n');
show(b.start());

while (!b.winner) {
  const p = b.sides.player;
  console.log(`\n  ${bar('red')}\n  ${bar('player')}`);
  let a: Action | null = null;
  if (b.needSwitch || !b.lockedMove('player')) {
    if (b.needSwitch) {
      console.log('  Choose your next POKéMON (e.g. s3):');
    } else {
      const v = p.v, pp = v.tpp ?? b.mon('player').pp;
      console.log('     MOVE           TYPE      POWER  ACC   PP');
      v.moves.forEach((id, i) => {
        const m = MOVES[id];
        console.log(`  ${i + 1}) ${m.name.padEnd(14)} ${m.type.padEnd(9)} ${powerLabel(id).padEnd(6)} ${(m.acc === null ? '-' : m.acc + '%').padEnd(5)} ${pp[i]}/${b.mon('player').maxPp[i] ?? 5}`);
      });
    }
    p.team.forEach((m, i) => console.log(`  s${i + 1}) ${SPECIES[m.species].name.padEnd(11)} ${m.hp}/${m.maxHp}${m.status ? ' ' + m.status.toUpperCase() : ''}${m.hp === 0 ? ' (fainted)' : ''}${i === p.active ? ' (out)' : ''}`));
    const items = Object.keys(p.bag);
    if (!b.needSwitch) console.log('  BAG: ' + (items.map((k, i) => `i${i + 1}) ${k} x${p.bag[k]}`).join('   ') || 'empty'));
    const ans = (await rl.question('> ')).trim().toLowerCase();
    const nums = ans.slice(1).trim().split(/\s+/).map(Number);
    if (ans.startsWith('s')) a = {type: 'switch', index: nums[0] - 1};
    else if (ans.startsWith('i')) {
      a = {type: 'item', item: items[nums[0] - 1] ?? '?', target: isNaN(nums[1]) ? p.active : nums[1] - 1,
        moveSlot: isNaN(nums[2]) ? undefined : nums[2] - 1};
    } else {
      a = {type: 'move', slot: b.usableSlots('player').length ? +ans - 1 : -1};
    }
  }
  show(b.step(a ?? {type: 'move', slot: 0}));
}
console.log(b.winner === 'player' ? '\n  YOU BEAT RED!' : '\n  Red wins this time.');
rl.close();
