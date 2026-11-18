// Player accounts (email + password + username), using Supabase Auth over plain fetch.
// Accounts are created by the "account" server function (so usernames stay unique);
// logging in uses Supabase's normal password login. The session is kept in this browser.

import {SUPABASE_URL, SUPABASE_KEY} from './config';

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms
  user: {id: string; email: string; username: string; country: string; trainer?: string; badges?: string[]; badgesSeen?: string[]};
}

const KEY = 'pokebattles:session';
const listeners: ((s: Session | null) => void)[] = [];
// "Keep me logged in" on: the session is kept in localStorage (stays after closing the browser).
// Off: sessionStorage, so it ends when the browser (or tab) is closed.
let remember = true;
let session: Session | null = load();

function load(): Session | null {
  try {
    const kept = localStorage.getItem(KEY);
    if (kept) { remember = true; return JSON.parse(kept); }
    const brief = sessionStorage.getItem(KEY);
    if (brief) { remember = false; return JSON.parse(brief); }
  } catch { /* storage blocked */ }
  return null;
}
function save(s: Session | null) {
  session = s;
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
    if (s) (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(s));
  } catch { /* storage blocked: stays logged in for this visit only */ }
  listeners.forEach(fn => fn(s));
}

export const currentUser = () => session?.user ?? null;
export function onSessionChange(fn: (s: Session | null) => void) {
  listeners.push(fn);
}

function fromAuth(body: {access_token: string; refresh_token: string; expires_in: number; user: {id: string; email?: string; user_metadata?: {username?: string; country?: string; trainer?: string; badges?: string[]; badgesSeen?: string[]}}}): Session {
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000,
    user: {id: body.user.id, email: body.user.email ?? '', username: body.user.user_metadata?.username ?? '', country: body.user.user_metadata?.country ?? '', trainer: body.user.user_metadata?.trainer ?? '', badges: body.user.user_metadata?.badges ?? [], badgesSeen: body.user.user_metadata?.badgesSeen ?? []},
  };
}

async function authToken(grant: 'password' | 'refresh_token', payload: object): Promise<Session> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST', headers: {apikey: SUPABASE_KEY, 'Content-Type': 'application/json'}, body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (grant === 'password') throw new Error('Wrong email or password.');
    throw new Error('Please log in again.');
  }
  return fromAuth(body);
}

export async function logIn(email: string, password: string, keep = true): Promise<Session> {
  const s = await authToken('password', {email: email.trim().toLowerCase(), password});
  remember = keep;
  save(s);
  return s;
}

export async function signUp(email: string, password: string, username: string, country = '', keep = true): Promise<Session> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/account`, {
    method: 'POST', headers: {apikey: SUPABASE_KEY, 'Content-Type': 'application/json'},
    body: JSON.stringify({email, password, username, country}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Could not reach the server.');
  return logIn(email, password, keep);
}

export function logOut() {
  const token = session?.accessToken;
  save(null);
  if (token) {
    void fetch(`${SUPABASE_URL}/auth/v1/logout`, {method: 'POST', headers: {apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`}}).catch(() => {});
  }
}

/** A fresh access token for server calls (refreshed when close to expiry), or null if logged out. */
export async function accessToken(): Promise<string | null> {
  if (!session) return null;
  if (Date.now() < session.expiresAt - 60_000) return session.accessToken;
  try {
    save(await authToken('refresh_token', {refresh_token: session.refreshToken}));
    return session!.accessToken;
  } catch {
    save(null);
    return null;
  }
}

/** Saves the player's country (shown as a flag on the leaderboard). */
export async function setCountry(country: string): Promise<void> {
  return setProfileData({country});
}

/** Saves profile fields (country, trainer picture) in the account. */
export async function setProfileData(data: {country?: string; trainer?: string; badges?: string[]; badgesSeen?: string[]}): Promise<void> {
  const token = await accessToken();
  if (!token || !session) throw new Error('Please log in again.');
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: 'PUT', headers: {apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({data}),
  });
  if (!res.ok) throw new Error('Could not save. Try again.');
  save({...session, user: {...session.user, ...data}});
}

/** Changes the account's username (the server checks it's free; allowed once a week). */
export async function changeUsername(username: string): Promise<string> {
  const token = await accessToken();
  if (!token || !session) throw new Error('Please log in again.');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/account`, {
    method: 'POST', headers: {apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({action: 'rename', username}),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? 'Could not change it. Try again.');
  save({...session!, user: {...session!.user, username: out.username}});
  return out.username;
}
