// The logged-in player's saved stats and friends (the "profile" server function),
// plus invite links (?invite=USERNAME).

import {SUPABASE_URL, SUPABASE_KEY} from './config';
import {accessToken, currentUser, onSessionChange} from './account';
import {LEVELS, type Level} from './engine/daily';
import {listLoadouts, mergeAccountLoadouts, markSynced, onLoadoutsChange, type Loadout} from './loadouts';
import {loadStatsAt, saveStatsAt, mergeStats, type Stats} from './stats';

export interface Friend { id: string; username: string; country: string }

let friends: Friend[] = [];
let requests: Friend[] = []; // people asking to be my friend
let sent: Friend[] = []; // people I've asked
export const getRequests = () => requests;
export const getSent = () => sent;
const listeners: (() => void)[] = [];
export const getFriends = () => friends;
export const onProfileChange = (fn: () => void) => { listeners.push(fn); };
const changed = () => listeners.forEach(fn => fn());

async function call<T>(action: string, extra: object = {}): Promise<T> {
  const token = await accessToken();
  if (!token) throw new Error('Please log in first.');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/profile`, {
    method: 'POST',
    headers: {apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({action, ...extra}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Could not reach the server.');
  return body;
}

let keyFor: (level: Level) => string = l => `pokebattles:stats:${l}`;
let syncOn = true;
/** main.ts tells us where stats live (DEV builds use other keys and don't sync). */
export function configureProfile(statsKey: (level: Level) => string, sync: boolean) {
  keyFor = statsKey;
  syncOn = sync;
}

/** Loads the account's stats and friends, merges stats with this device, and saves the merged copy back. */
export async function loadProfile(): Promise<void> {
  if (!currentUser()) {
    friends = [];
    requests = [];
    sent = [];
    changed();
    return;
  }
  const {stats, friends: list, loadouts, requests: rq, sent: sn} = await call<{stats: Record<Level, Stats> | null; friends: Friend[]; loadouts: Loadout[] | null; requests?: Friend[]; sent?: Friend[]}>('load');
  requests = rq ?? [];
  sent = sn ?? [];
  if (mergeAccountLoadouts(loadouts)) await pushLoadouts(listLoadouts());
  friends = list ?? [];
  if (syncOn) {
    for (const l of LEVELS) {
      const local = loadStatsAt(keyFor(l));
      const remote = stats?.[l];
      saveStatsAt(keyFor(l), remote ? mergeStats(local, remote) : local);
    }
    await saveProfileStats();
  }
  changed();
}

/** Saves the saved-teams list to the account (so live, test site and every device share it). */
async function pushLoadouts(list: Loadout[]) {
  if (!currentUser()) return;
  try {
    await call('saveLoadouts', {loadouts: list.map(({synced, ...l}) => l)});
    markSynced();
  } catch { /* offline: stays marked unsynced and goes up next time */ }
}
onLoadoutsChange(list => void pushLoadouts(list));

/** Uploads this device's stats to the account (after every battle). */
export async function saveProfileStats(): Promise<void> {
  if (!currentUser() || !syncOn) return;
  const stats = Object.fromEntries(LEVELS.map(l => [l, loadStatsAt(keyFor(l))]));
  await call('saveStats', {stats});
}

export async function addFriend(username: string): Promise<string> {
  const res = await call<{friends: Friend[]; added: string}>('addFriend', {username});
  friends = res.friends;
  changed();
  return res.added;
}

/** Sends a friend request. Returns 'friends' if they had already asked you (you're now friends), else 'sent'. */
export async function requestFriend(username: string): Promise<'sent' | 'friends'> {
  const res = await call<{sent?: string; friends?: Friend[]; added?: string}>('requestFriend', {username});
  if (res.friends) {
    friends = res.friends;
    requests = requests.filter(r => r.username.toLowerCase() !== username.toLowerCase());
    changed();
    return 'friends';
  }
  if (!sent.some(f => f.username.toLowerCase() === username.toLowerCase())) sent = [...sent, {id: '', username: res.sent ?? username, country: ''}];
  changed();
  return 'sent';
}

/** Accepts or declines someone's friend request. */
export async function answerRequest(id: string, accept: boolean): Promise<void> {
  const res = await call<{friends: Friend[]; requests: Friend[]}>('answerRequest', {id, accept});
  friends = res.friends;
  requests = res.requests;
  changed();
}

/** Today's Elite Four run, kept in the account so another device can continue it. */
export async function pushEliteRun(date: string, run: unknown, mode: 'easy' | 'hard' = 'easy'): Promise<void> {
  if (!currentUser()) return;
  await call('saveElite', {date, run, mode});
}
export async function pullEliteRun<T>(date: string, mode: 'easy' | 'hard' = 'easy'): Promise<T | null> {
  if (!currentUser()) return null;
  return (await call<{run: T | null}>('loadElite', {date, mode})).run;
}

export async function removeFriend(id: string): Promise<void> {
  friends = (await call<{friends: Friend[]}>('removeFriend', {id})).friends;
  changed();
}

// ---------- invite links ----------

const INVITE_KEY = 'pokebattles:invite';
/** Your invite link (anyone who opens it and has an account becomes your friend). */
// It goes through /invite.html, which has its own link preview ("You've been invited"), then opens the game.
export const inviteLink = () =>
  `${location.origin}/invite.html?u=${encodeURIComponent(currentUser()?.username ?? '')}`;

/** Reads ?invite= from the address (and tidies the address). Returns the inviter's name, if any. */
export function captureInvite(): string | null {
  const url = new URL(location.href);
  const name = url.searchParams.get('invite');
  if (name) {
    try { localStorage.setItem(INVITE_KEY, name); } catch { /* ignore */ }
    url.searchParams.delete('invite');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  try { return localStorage.getItem(INVITE_KEY); } catch { return name; }
}
export const pendingInvite = () => { try { return localStorage.getItem(INVITE_KEY); } catch { return null; } };

/** Once logged in, turns a saved invite into a friendship. Returns the new friend's name. */
export async function acceptInvite(): Promise<string | null> {
  const name = pendingInvite();
  if (!name || !currentUser()) return null;
  try { localStorage.removeItem(INVITE_KEY); } catch { /* ignore */ }
  if (name.toLowerCase() === currentUser()!.username.toLowerCase()) return null;
  try {
    return await addFriend(name);
  } catch {
    return null;
  }
}

onSessionChange(s => { if (!s) { friends = []; changed(); } });
