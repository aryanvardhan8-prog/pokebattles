// The Elite Four run: Lorelei → Bruno → Agatha → Lance → Champion Blue, one run a day with your own team.
// HP, PP and status carry over from battle to battle (only your items heal you); one loss ends the run.
// Each battle's Day is built from the previous battle's end, so the whole run replays exactly from
// the team + the five action logs (the server checks it that way).

import {calcStats, dayNumber, EASY_OPTIONS, RECHARGE_FROM, NO_MISS_FROM, ALL_SPECIES, bst, type Day, type Mon} from './daily';
import {Battle, type Action} from './battle';
import {toMons, levelUpMovesAt, canLearnTm, isAttack, TMS, type PickedTeam} from './pvp';
import {rngFor, shuffle, type Rng} from './rng';

/** Easy: build your own team. Hard: everyone gets the same random team that day, random movesets, recommended items. */
export type EliteMode = 'easy' | 'hard';
/** The items both modes recommend (Hard has exactly these, locked). */
export const ELITE_RECOMMENDED: Record<string, number> = {'MAX POTION': 20, 'REVIVE': 10, 'ELIXER': 10, 'FULL HEAL': 8};
/** Results level for each mode (leaderboard rows). */
export const ELITE_LEVEL: Record<EliteMode, string> = {easy: 'elite', hard: 'elite-hard'};
const NO_RANDOM = new Set(['struggle', 'splash', 'teleport', 'transform', 'metronome', 'mimic', 'mirrormove', 'selfdestruct', 'explosion', 'fissure', 'horndrill', 'guillotine']);

/** Hard mode picks from fully evolved-strength Pokémon (48 of them). */
const HARD_BST = 400;
/** Hard mode's team for a day: 6 strong Pokémon (base stats 400+) at Lv 100, each with 4 random moves it can learn
 *  (level-up or TM), at least 2 of them attacks. The same for everyone that day. */
export function eliteHardTeam(date: string): PickedTeam {
  const rng: Rng = rngFor(`pokebattles:elite-hard:${date}:team`);
  const pool = ALL_SPECIES.filter(sp => bst(sp) >= HARD_BST);
  const mons = shuffle(rng, pool).slice(0, 6).map(sp => {
    const learnable = [...new Set([...levelUpMovesAt(sp, 100), ...TMS.filter(t => canLearnTm(sp, t.id)).map(t => t.id)])].filter(m => !NO_RANDOM.has(m)).sort();
    const attacks = shuffle(rng, learnable.filter(isAttack));
    const picked = attacks.slice(0, 2);
    for (const m of shuffle(rng, learnable)) { if (picked.length >= 4) break; if (!picked.includes(m)) picked.push(m); }
    return {species: sp, level: 100, moves: picked};
  });
  return {mons, bag: {...ELITE_RECOMMENDED}};
}

export interface EliteTrainer {
  key: 'lorelei' | 'bruno' | 'agatha' | 'lance' | 'blue';
  name: string; // battle text name
  title: string; // shown on the room tag
  type: string;
  team: {species: string; moves: string[]}[];
  intro: string;
  lose: string; // what they say when you beat them
}

export const ELITE: EliteTrainer[] = [
  {key: 'lorelei', name: 'LORELEI', title: 'Elite Four', type: 'Ice',
    intro: 'Welcome to the Pokémon League. I\'m Lorelei, and no one can stand the cold I command. Ready to freeze?',
    lose: 'Thawed out... You\'re stronger than you look. The next room awaits.',
    team: [
      {species: 'dewgong', moves: ['surf', 'icebeam', 'rest', 'bodyslam']},
      {species: 'cloyster', moves: ['blizzard', 'surf', 'clamp', 'explosion']},
      {species: 'slowbro', moves: ['psychic', 'surf', 'amnesia', 'thunderwave']},
      {species: 'jynx', moves: ['lovelykiss', 'blizzard', 'psychic', 'bodyslam']},
      {species: 'lapras', moves: ['blizzard', 'thunderbolt', 'bodyslam', 'confuseray']},
    ]},
  {key: 'bruno', name: 'BRUNO', title: 'Elite Four', type: 'Fighting',
    intro: 'I\'m Bruno. I\'ve trained my body and my Pokémon to their limits. Let\'s see if you can take a hit!',
    lose: 'Hmph. Your strength is real. Go on.',
    team: [
      {species: 'onix', moves: ['earthquake', 'rockslide', 'bodyslam', 'explosion']},
      {species: 'hitmonchan', moves: ['submission', 'firepunch', 'icepunch', 'thunderpunch']},
      {species: 'hitmonlee', moves: ['highjumpkick', 'rollingkick', 'bodyslam', 'megakick']},
      {species: 'onix', moves: ['earthquake', 'rockslide', 'bind', 'harden']},
      {species: 'machamp', moves: ['submission', 'earthquake', 'rockslide', 'bodyslam']},
    ]},
  {key: 'agatha', name: 'AGATHA', title: 'Elite Four', type: 'Ghost',
    intro: 'Hehehe... I\'m Agatha. Ghosts don\'t care how strong you think you are, child.',
    lose: 'Oh ho! Not bad at all. Off you go, then.',
    team: [
      {species: 'gengar', moves: ['hypnosis', 'nightshade', 'thunderbolt', 'explosion']},
      {species: 'golbat', moves: ['confuseray', 'doubleedge', 'megadrain', 'toxic']},
      {species: 'haunter', moves: ['hypnosis', 'dreameater', 'nightshade', 'confuseray']},
      {species: 'arbok', moves: ['glare', 'earthquake', 'bodyslam', 'rockslide']},
      {species: 'gengar', moves: ['psychic', 'thunderbolt', 'nightshade', 'megadrain']},
    ]},
  {key: 'lance', name: 'LANCE', title: 'Elite Four', type: 'Dragon',
    intro: 'I am Lance, and I lead the Elite Four. Dragons are mythical, mighty and nearly impossible to beat. Show me!',
    lose: 'You beat me fair and square. Only the Champion remains.',
    team: [
      {species: 'gyarados', moves: ['hydropump', 'bodyslam', 'thunderbolt', 'blizzard']},
      {species: 'dragonair', moves: ['thunderwave', 'blizzard', 'bodyslam', 'surf']},
      {species: 'dragonair', moves: ['slam', 'thunderbolt', 'icebeam', 'fireblast']},
      {species: 'aerodactyl', moves: ['skyattack', 'doubleedge', 'hyperbeam', 'fireblast']},
      {species: 'dragonite', moves: ['hyperbeam', 'blizzard', 'thunderbolt', 'fireblast']},
    ]},
  {key: 'blue', name: 'BLUE', title: 'Champion', type: 'Champion',
    intro: 'Hey! I was waiting for you. While you were busy, I became the Champion. Now I\'ll prove I\'m the best!',
    lose: 'No way... I lost? You\'re the new Champion!',
    team: [
      {species: 'pidgeot', moves: ['doubleedge', 'skyattack', 'fly', 'agility']},
      {species: 'alakazam', moves: ['psychic', 'recover', 'thunderwave', 'seismictoss']},
      {species: 'rhydon', moves: ['earthquake', 'rockslide', 'bodyslam', 'substitute']},
      {species: 'arcanine', moves: ['fireblast', 'bodyslam', 'dig', 'reflect']},
      {species: 'exeggutor', moves: ['psychic', 'hypnosis', 'explosion', 'megadrain']},
      {species: 'blastoise', moves: ['surf', 'blizzard', 'earthquake', 'bodyslam']},
    ]},
];

/** Your own team at Lv 100, as many items as you like. */
export const ELITE_OPTIONS = {...EASY_OPTIONS, items: 99};
const PERFECT = {atk: 15, def: 15, spe: 15, spc: 15};
/** Difficulty knobs (tuned with `ELITE=1 npx tsx scripts/balance.mts`). Levels rise room by room, like the games. */
export const ELITE_TUNING = {levels: [100, 100, 100, 100, 100], expertAI: false, fullRestores: [0, 0, 0, 1, 1]};

/** Your team at the start of the run. */
export function eliteStartTeam(t: PickedTeam): {team: Mon[]; bag: Record<string, number>} {
  return {team: toMons({mons: t.mons.map(m => ({...m, level: 100})), bag: {}}), bag: {...(t.bag ?? {})}};
}

/** Battle `i` (0 = Lorelei … 4 = Blue) of the run on `date`, with your team as it is now. */
export function eliteDay(date: string, i: number, you: {team: Mon[]; bag: Record<string, number>}, mode: EliteMode = 'easy'): Day {
  const e = ELITE[i];
  return {
    date, seed: `${mode === 'hard' ? 'elite-hard' : 'elite'}:${date}:${i}`, level: 'hard', number: dayNumber(date), smartAI: true, expertAI: ELITE_TUNING.expertAI, foeName: e.name,
    ...(date >= RECHARGE_FROM ? {alwaysRecharge: true} : {}),
    ...(date >= NO_MISS_FROM ? {sureHit: true} : {}),
    player: {team: you.team, bag: {...you.bag}},
    red: {team: e.team.map(m => { const lv = ELITE_TUNING.levels[i]; return {species: m.species, level: lv, moves: [...m.moves], dvs: {...PERFECT}, stats: calcStats(m.species, lv, PERFECT)}; }),
      bag: ELITE_TUNING.fullRestores[i] ? {'FULL RESTORE': ELITE_TUNING.fullRestores[i]} : {}},
  };
}

/** Your team after a battle: HP, PP and status carry over; standing Pokémon move to the front. */
export function carryOver(b: Battle): {team: Mon[]; bag: Record<string, number>} {
  const base = b.day.player.team;
  const order = b.order;
  const team = b.sides.player.team.map((m, k) => {
    const src = base[order[k]];
    return {...src, start: {hp: m.hp, pp: [...m.pp], status: m.status, sleep: m.sleep}};
  });
  team.sort((a, c) => Number(c.start!.hp > 0) - Number(a.start!.hp > 0));
  return {team, bag: {...b.sides.player.bag}};
}

export interface EliteRun { battles: Battle[]; cleared: number; over: boolean; won: boolean; monsLeft: number; turns: number; itemsUsed: number }

/** Replays a run from its team and action logs (one per battle reached). Throws if anything doesn't check out. */
export function replayElite(date: string, team: PickedTeam, logs: Action[][], mode: EliteMode = 'easy'): EliteRun {
  let you = eliteStartTeam(team);
  const battles: Battle[] = [];
  let cleared = 0, turns = 0, over = false;
  for (let i = 0; i < Math.min(logs.length, ELITE.length); i++) {
    const b = Battle.replay(eliteDay(date, i, you, mode), logs[i]);
    if (b.log.length !== logs[i].length) throw new Error('Battle did not check out.');
    battles.push(b);
    turns += b.turn;
    if (!b.winner) break; // still in progress
    if (b.winner !== 'player') { over = true; break; }
    cleared++;
    you = carryOver(b);
    if (cleared === ELITE.length) over = true;
  }
  const last = battles[battles.length - 1];
  const monsLeft = last ? last.sides.player.team.filter(m => m.hp > 0).length : 6;
  // Items used across the run (before battles and during them).
  const itemsUsed = battles.reduce((n, b) => n + b.log.filter(a => a.type === 'item').length, 0);
  return {battles, cleared, over, won: cleared === ELITE.length, monsLeft, turns, itemsUsed};
}
