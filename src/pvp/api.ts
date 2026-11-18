import {myTrainer} from '../trainers';
// Talks to the "match" server function. In dev builds, `?local&as=NAME` runs the same match logic
// (src/engine/matchCore.ts) inside the browser instead, stored in localStorage so two tabs on this
// computer can play each other without accounts (used for testing).

import {SUPABASE_URL, SUPABASE_KEY} from '../config';
import {accessToken, currentUser} from '../account';
import {handleMatch, randomMatchId, type Store} from '../engine/matchCore';
import type {MatchOptions, PickedTeam} from '../engine/pvp';
import type {Action} from '../engine/battle';

export type Side = 'host' | 'guest';
export interface Player { id: string; name: string; country: string; trainer?: string }
export interface MatchView {
  id: string; side: Side; stage: 'lobby' | 'room' | 'picking' | 'battle' | 'done' | 'cancelled';
  online?: {host: boolean; guest: boolean};
  invited?: string[];
  roomReady?: {host: boolean; guest: boolean};
  options: MatchOptions; seed: string; host: Player; guest: Player | null; created: number; declined?: boolean;
  myTeam: PickedTeam | null; ready: {host: boolean; guest: boolean};
  teams: {host: PickedTeam; guest: PickedTeam} | null;
  rounds: [Action | null, Action | null][];
  roundStarted: number;
  duty: 'act' | 'switch' | 'wait' | null;
  chosen: {me: boolean; them: boolean};
  winner: Side | null; how: string;
}
export interface MatchSummary { id: string; side: Side; opp: Player | null; at: number; stage: MatchView['stage']; won: boolean | null; oppOnline?: boolean; how?: string; left?: {me: number; opp: number} | null }

const params = new URLSearchParams(location.search);
/** Dev-only local mode (two tabs, no accounts). */
export const LOCAL = import.meta.env.DEV && params.has('local');
const localName = (params.get('as') ?? 'ASH').toUpperCase().slice(0, 10);

const localStore: Store = {
  async read(path, fallback) {
    try { const v = localStorage.getItem(`pvp-local:${path}`); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  async write(path, value) { localStorage.setItem(`pvp-local:${path}`, JSON.stringify(value)); },
  async remove(paths) { paths.forEach(p => localStorage.removeItem(`pvp-local:${p}`)); },
};

/** Who is playing (the account, or the local test name). */
export function whoAmI(): Player | null {
  if (LOCAL) return {id: `local-${localName}`, name: localName, country: localName === 'ASH' ? 'IN' : 'GB', trainer: localName === 'ASH' ? myTrainer() : 'misty'};
  const u = currentUser();
  return u ? {id: u.id, name: u.username, country: u.country, trainer: myTrainer()} : null;
}

async function call<T>(body: object): Promise<T> {
  if (LOCAL) {
    const [status, out] = await handleMatch(localStore, whoAmI()!, body, randomMatchId, () => crypto.randomUUID());
    if (status !== 200) throw new Error((out as {error?: string}).error ?? 'Something went wrong.');
    return out as T;
  }
  const token = await accessToken();
  if (!token) throw new Error('Log in to play a friend.');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/match`, {
    method: 'POST',
    headers: {apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? 'Could not reach the server.');
  return out;
}

export const inviteToMatch = (id: string, invite: string) => call<{ok: boolean; invited: string[]}>({action: 'invite', id, invite});
export const cancelMatch = (id: string) => call<{ok?: boolean; cancelled?: boolean}>({action: 'cancel', id});
export const createMatch = (options: MatchOptions, invite = '') => call<{id: string; merged?: boolean}>({action: 'create', options, ...(invite ? {invite} : {})});
export interface Invite { id: string; from: Player; at: number }
/** Challenges from friends waiting for me (shown as a pop-up). */
export const myInvites = () => call<{invites: Invite[]}>({action: 'invites'});
export const declineInvite = (id: string) => call<{ok: boolean}>({action: 'decline', id});
export const joinMatch = (id: string) => call<MatchView>({action: 'join', id, here: true});
/** `here`: I'm on a pre-battle match screen (keeps me "online" for my friend). */
export const matchState = (id: string, here = false) => call<MatchView>({action: 'state', id, ...(here ? {here: true} : {})});
export const roomReady = (id: string) => call<MatchView>({action: 'roomReady', id});
export const setTeam = (id: string, team: PickedTeam) => call<MatchView>({action: 'setTeam', id, team});
export const act = (id: string, round: number, choice: Action) => call<MatchView>({action: 'act', id, round, choice});
export const claimTimeout = (id: string) => call<MatchView>({action: 'timeout', id});
export const forfeit = (id: string) => call<MatchView>({action: 'forfeit', id});
export const listMatches = (opp?: string) => call<{matches: MatchSummary[]}>({action: 'list', ...(opp ? {opp} : {})});

/** The link a friend opens to join (also inside the QR code). */
export const matchLink = (id: string) => {
  const me = whoAmI()?.name ?? '';
  if (LOCAL) return `${location.origin}/?local&as=MISTY&match=${id}`;
  return `${location.origin}/invite.html?u=${encodeURIComponent(me)}&m=${id}`;
};
