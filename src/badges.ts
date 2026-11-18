// Badges: earned from a player's results (vs Red, Elite Four), friends and friend battles.
// Worked out on the device from public leaderboard rows; the 4 a player shows off are saved in their account
// (user_metadata.badges) and read by others through the `flags` function (?badges=1).

import {SUPABASE_URL, SUPABASE_KEY} from './config';
import {fromRow, type BadgeStats} from './engine/badgeRules';
export type {BadgeStats};

export type Cat = 'red' | 'elite' | 'friend' | 'ded';
export type Tier = 'b' | 's' | 'g' | 'p';
export interface Badge { id: string; cat: Cat; name: string; icon: string; tier: Tier; desc: string; stat: keyof BadgeStats; need: number }

/** Hand-drawn 24×24 line icons (no emoji, so they look the same everywhere). */
const ICONS: Record<string, string> = {
  swords: '<path d="M4 4l10 10M4 4h4M4 4v4M20 4L10 14M20 4h-4M20 4v4M12 16l-3 3M12 16l3 3M7 17l-3 3M17 17l3 3"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  shield: '<path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  six: '<circle cx="7" cy="8" r="2.2"/><circle cx="12" cy="8" r="2.2"/><circle cx="17" cy="8" r="2.2"/><circle cx="7" cy="15" r="2.2"/><circle cx="12" cy="15" r="2.2"/><circle cx="17" cy="15" r="2.2"/>',
  three: '<path d="M5 18h14M6 18l-1-9 4 3 3-6 3 6 4-3-1 9"/><path d="M9 21h6"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/><path d="M12 9v6M9.5 11.5L12 9l2.5 2.5"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5"/>',
  flag: '<path d="M3 20l6-9 4 5 3-3 5 7z"/><path d="M13 16V4l5 2.5-5 2.5"/>',
  crown: '<path d="M4 17l-1-10 5 4 4-6 4 6 5-4-1 10z"/><path d="M4 20h16"/>',
  feather: '<path d="M19 5c-6 0-12 4-13 13l-1 2"/><path d="M19 5c0 7-5 12-12 13M10 15h5M12 11h5"/>',
  pillars: '<path d="M3 9l9-5 9 5zM5 9v9M9.5 9v9M14.5 9v9M19 9v9M3 20h18"/>',
  buddy: '<circle cx="8.5" cy="8" r="3"/><circle cx="16" cy="9" r="2.5"/><path d="M3 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M14 14.5c3.5 0 6 1.5 6 4.5"/>',
  vs: '<path d="M3 7l3 10 3-10M20 8.5c-.5-1-1.5-1.5-3-1.5-2 0-3 1-3 2.3 0 3 6 1.7 6 4.9 0 1.5-1.3 2.8-3.3 2.8-1.5 0-2.7-.7-3.2-1.7"/>',
  bolt: '<path d="M13 2L5 13h6l-1 9 8-11h-6z"/>',
  group: '<circle cx="12" cy="7" r="2.8"/><circle cx="5.5" cy="10" r="2.2"/><circle cx="18.5" cy="10" r="2.2"/><path d="M7 20c0-3 2.2-5 5-5s5 2 5 5M2 19c0-2 1.5-3.5 3.5-3.5M22 19c0-2-1.5-3.5-3.5-3.5"/>',
  flame: '<path d="M12 21c-4 0-6.5-2.8-6.5-6.3 0-4 3.5-6 4-10.7 3 2 3.5 4.5 3.5 6.5 1-1 1.5-2 1.6-3.5 2.4 2 3.9 4.6 3.9 7.7 0 3.5-2.5 6.3-6.5 6.3z"/>',
  chev: '<path d="M5 6l6 6-6 6M12 6l6 6-6 6"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4M8 14h2M12 14h2M8 17h2"/>',
  stripes: '<path d="M6 4v7l6 3 6-3V4M6 15l6 3 6-3M6 19l6 3 6-3"/>',
  podium: '<path d="M9 21V9h6v12M3 21v-7h6M15 21v-5h6v5M3 21h18"/><path d="M12 3l.8 1.7 1.8.2-1.3 1.3.3 1.8-1.6-.9-1.6.9.3-1.8-1.3-1.3 1.8-.2z"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8M9 17h6"/>',
};


const b = (id: string, cat: Cat, name: string, icon: string, tier: Tier, desc: string, stat: keyof BadgeStats, need: number): Badge =>
  ({id, cat, name, icon, tier, desc, stat, need});

export const BADGES: Badge[] = [
  // Battling Red
  b('red-1', 'red', 'First Win', 'swords', 'b', 'Beat Red once', 'redWins', 1),
  b('red-50', 'red', 'Red Rival', 'swords', 's', 'Beat Red 50 times', 'redWins', 50),
  b('red-100', 'red', 'Red Slayer', 'swords', 'g', 'Beat Red 100 times', 'redWins', 100),
  b('red-250', 'red', 'Mt. Silver Master', 'swords', 'p', 'Beat Red 250 times', 'redWins', 250),
  b('med-1', 'red', 'Medium Master', 'target', 's', 'Beat Red on Medium', 'mediumWins', 1),
  b('med-50', 'red', 'Medium Ace', 'target', 'g', 'Beat Red on Medium 50 times', 'mediumWins', 50),
  b('med-100', 'red', 'Medium Legend', 'target', 'p', 'Beat Red on Medium 100 times', 'mediumWins', 100),
  b('hard-1', 'red', 'Hard Hero', 'shield', 'g', 'Beat Red on Hard', 'hardWins', 1),
  b('hard-10', 'red', 'Hard Veteran', 'shield', 'g', 'Beat Red on Hard 10 times', 'hardWins', 10),
  b('hard-50', 'red', 'Hard Legend', 'shield', 'p', 'Beat Red on Hard 50 times', 'hardWins', 50),
  b('hard-100', 'red', 'Hard Immortal', 'shield', 'p', 'Beat Red on Hard 100 times', 'hardWins', 100),
  b('sweep-1', 'red', 'Clean Sweep', 'six', 'g', 'Beat Red with all 6 standing', 'sweeps', 1),
  b('sweep-25', 'red', 'Spotless', 'six', 'p', 'Beat Red with all 6 standing 25 times', 'sweeps', 25),
  b('triple-1', 'red', 'Triple Crown', 'three', 'p', 'Win Easy, Medium & Hard on one day', 'triples', 1),
  b('triple-25', 'red', 'Crown Collector', 'three', 'p', 'Win all three on 25 days', 'triples', 25),
  b('comeback-1', 'red', 'Comeback', 'heart', 'b', 'Beat Red with only 1 Pokémon left', 'comebacks', 1),
  b('comeback-10', 'red', 'Never Give Up', 'heart', 's', 'Win with 1 Pokémon left 10 times', 'comebacks', 10),
  // Elite Four
  b('e4-lorelei', 'elite', 'League Rookie', 'snow', 'b', 'Beat Lorelei', 'eliteBest', 1),
  b('e4-agatha', 'elite', 'Halfway There', 'flag', 's', 'Reach Agatha', 'eliteBest', 2),
  b('champ-1', 'elite', 'Champion', 'crown', 'g', 'Beat Champion Blue', 'champions', 1),
  b('champ-5', 'elite', 'Hall of Fame', 'pillars', 'p', 'Become Champion 5 times', 'champions', 5),
  b('champ-25', 'elite', 'Reigning Champion', 'pillars', 'p', 'Become Champion 25 times', 'champions', 25),
  b('champ-50', 'elite', 'League Legend', 'pillars', 'p', 'Become Champion 50 times', 'champions', 50),
  b('champ-100', 'elite', 'Eternal Champion', 'pillars', 'p', 'Become Champion 100 times', 'champions', 100),
  b('light-1', 'elite', 'Light Packer', 'feather', 'p', 'Become Champion using 10 items or fewer', 'lightChampions', 1),
  b('light-10', 'elite', 'Travelling Light', 'feather', 'p', 'Champion with 10 items or fewer, 10 times', 'lightChampions', 10),
  // Friends
  b('buddy', 'friend', 'Buddy', 'buddy', 'b', 'Add your first friend', 'friends', 1),
  b('friends-10', 'friend', 'Social Trainer', 'group', 'g', 'Have 10 friends', 'friends', 10),
  b('friends-25', 'friend', 'Popular', 'group', 'p', 'Have 25 friends', 'friends', 25),
  b('duel-1', 'friend', 'First Duel', 'vs', 'b', 'Finish a friend battle', 'duels', 1),
  b('pvp-10', 'friend', 'Rival', 'bolt', 's', 'Win 10 friend battles', 'duelWins', 10),
  b('pvp-50', 'friend', 'Duelist', 'bolt', 'g', 'Win 50 friend battles', 'duelWins', 50),
  b('pvp-100', 'friend', 'Arena Legend', 'bolt', 'p', 'Win 100 friend battles', 'duelWins', 100),
  // Dedication & ranks
  b('streak-3', 'ded', 'On Fire', 'flame', 'b', '3-day win streak', 'streak', 3),
  b('streak-7', 'ded', 'Unstoppable', 'chev', 's', '7-day win streak', 'streak', 7),
  b('streak-30', 'ded', 'Legend', 'star', 'g', '30-day win streak', 'streak', 30),
  b('streak-100', 'ded', 'Mythical', 'star', 'p', '100-day win streak', 'streak', 100),
  b('days-7', 'ded', 'Regular', 'cal', 'b', 'Play on 7 different days', 'days', 7),
  b('days-30', 'ded', 'Veteran', 'stripes', 's', 'Play on 30 days', 'days', 30),
  b('days-100', 'ded', 'Devoted', 'stripes', 'g', 'Play on 100 days', 'days', 100),
  b('days-365', 'ded', 'A Whole Year', 'stripes', 'p', 'Play on 365 days', 'days', 365),
  b('top10-1', 'ded', 'Top 10', 'podium', 'g', 'Finish a day in the top 10', 'top10', 1),
  b('top10-25', 'ded', 'Regular Finalist', 'podium', 'p', 'Finish in the top 10 on 25 days', 'top10', 25),
  b('first-1', 'ded', 'Number One', 'trophy', 'p', 'Finish a day ranked #1', 'firsts', 1),
  b('first-10', 'ded', 'Dominant', 'trophy', 'p', 'Finish a day ranked #1 ten times', 'firsts', 10),
];
export const badgeById = (id: string) => BADGES.find(x => x.id === id);

export const CAT_INFO: Record<Cat, {name: string; c1: string; c2: string; shape: string}> = {
  red: {name: 'Battling Red', c1: '#e3262e', c2: '#9e1419', shape: 'polygon(50% 0,93% 25%,93% 75%,50% 100%,7% 75%,7% 25%)'},
  elite: {name: 'Elite Four', c1: '#7b4fe0', c2: '#4a2a9a', shape: 'polygon(30% 0,70% 0,100% 30%,100% 70%,70% 100%,30% 100%,0 70%,0 30%)'},
  friend: {name: 'Friends', c1: '#3b7cf0', c2: '#1e4fb0', shape: 'polygon(50% 0,100% 38%,82% 100%,18% 100%,0 38%)'},
  ded: {name: 'Dedication & ranks', c1: '#f0b21a', c2: '#b97d00', shape: 'circle(50%)'},
};
const RIM: Record<Tier, string> = {b: '#a8652f', s: '#8d96a6', g: '#c98e0a', p: '#5b33b8'};
export const TIER_NAME: Record<Tier, string> = {b: 'Bronze', s: 'Silver', g: 'Gold', p: 'Special'};

/** One badge as an emblem (league-emblem shape, mode colour, tier rim, bold white icon). */
export function badgeHtml(x: Badge, size = 56, locked = false): string {
  const c = CAT_INFO[x.cat];
  const icon = Math.round(size * 0.52);
  return `<span class="bdg ${locked ? 'is-locked' : ''}" style="--s:${size}px;background:${RIM[x.tier]};clip-path:${c.shape}" title="${x.name}: ${x.desc}">
    <span class="bdg-in" style="background:linear-gradient(135deg,${c.c1},${c.c2});clip-path:${c.shape}">
      <svg viewBox="0 0 24 24" width="${icon}" height="${icon}" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[x.icon] ?? ''}</svg>
      ${x.need >= 10 ? `<i class="bdg-n">${x.need}</i>` : ''}
    </span></span>`;
}

/** The row of up to 4 equipped badges (for profiles and friend-battle lobbies). */
export function equippedHtml(ids: string[] | undefined, size = 30): string {
  const list = (ids ?? []).map(badgeById).filter((x): x is Badge => !!x).slice(0, 4);
  return list.length ? `<span class="bdg-row">${list.map(x => badgeHtml(x, size)).join('')}</span>` : '';
}

// ---------- working out what a player has earned ----------

/** A player's badge numbers from the server's player_stats (updated every 10 minutes), plus friends /
 *  friend-battle counts (only known for yourself). */
export async function badgeStats(username: string, extra: {friends?: number; duels?: number; duelWins?: number} = {}): Promise<BadgeStats> {
  const rows = await fetch(`${SUPABASE_URL}/rest/v1/player_stats?name_lower=eq.${encodeURIComponent(username.toLowerCase())}&select=*&limit=1`,
    {headers: {apikey: SUPABASE_KEY}}).then(x => x.json()).catch(() => []);
  return fromRow(Array.isArray(rows) ? rows[0] : null, extra);
}

export const earned = (s: BadgeStats) => BADGES.filter(x => s[x.stat] >= x.need);
