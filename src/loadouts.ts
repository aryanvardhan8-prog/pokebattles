// Saved teams ("loadouts"): your favourite six with their moves and items, kept on this device,
// so they can be loaded in the team builder (friend battles and Easy) in one tap.

import type {PickedTeam} from './engine/pvp';

export interface Loadout { id: string; name: string; team: PickedTeam; at: number; synced?: boolean }
const KEY = 'pokebattles:loadouts';
const MAX = 12;

export function listLoadouts(): Loadout[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}
function store(list: Loadout[], push = true) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* storage full / blocked */ }
  if (push) changed.forEach(fn => fn(list.slice(0, MAX)));
}
// Logged in: profile.ts saves the list to the account on every change (shared by all devices and both sites).
const changed: ((list: Loadout[]) => void)[] = [];
export function onLoadoutsChange(fn: (list: Loadout[]) => void) { changed.push(fn); }
export function markSynced() {
  store(listLoadouts().map(l => ({...l, synced: true})), false);
}
/** After logging in: the account's teams, plus any made on this device that the account doesn't have yet. */
export function mergeAccountLoadouts(account: Loadout[] | null): boolean {
  const local = listLoadouts();
  if (!account) return local.length > 0; // the account has none yet: upload this device's
  const ids = new Set(account.map(l => l.id));
  const fresh = local.filter(l => !l.synced && !ids.has(l.id));
  store([...fresh, ...account.map(l => ({...l, synced: true}))], false);
  return fresh.length > 0;
}
export function saveLoadout(name: string, team: PickedTeam): Loadout {
  const l: Loadout = {id: Math.random().toString(36).slice(2, 9), name: name.trim().slice(0, 24) || 'My team',
    team: {mons: team.mons.map(m => ({species: m.species, level: m.level, moves: [...m.moves]})), bag: {...team.bag}}, at: Date.now()};
  store([l, ...listLoadouts()]);
  return l;
}
export function removeLoadout(id: string) {
  store(listLoadouts().filter(l => l.id !== id));
}

/** Replaces a saved team's Pokémon, moves and items (after editing it in the team builder). */
export function updateLoadout(id: string, team: PickedTeam) {
  store(listLoadouts().map(l => (l.id === id
    ? {...l, team: {mons: team.mons.map(m => ({species: m.species, level: m.level, moves: [...m.moves]})), bag: {...team.bag}}, at: Date.now(), synced: false}
    : l)));
}
