// Phone notifications (web push): friend challenges, "new island ready" and streak reminders.
// Works on Android and laptops; on iPhone only once DailyBattles is added to the home screen (iOS 16.4+).

import {SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC_KEY} from './config';
import {accessToken} from './account';

export type Prefs = {challenge: boolean; daily: boolean; streak: boolean};

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = () => matchMedia('(display-mode: standalone)').matches || (navigator as {standalone?: boolean}).standalone === true;

/** 'ok', 'ios-install' (iPhone in Safari: add to home screen first), 'denied' (blocked in settings) or 'unsupported'. */
export function pushSupport(): 'ok' | 'ios-install' | 'denied' | 'unsupported' {
  if (isIOS() && !installed()) return 'ios-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'ok';
}

async function call<T>(body: object): Promise<T> {
  const token = await accessToken();
  if (!token) throw new Error('Log in to turn on notifications.');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/push`, {method: 'POST',
    headers: {apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? 'Something went wrong.');
  return out;
}

const keyBytes = (b64: string) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};
async function registration() {
  if (import.meta.env.DEV) await navigator.serviceWorker.register('sw.js');
  return navigator.serviceWorker.ready;
}
async function currentSub() {
  if (pushSupport() !== 'ok') return null;
  return (await registration()).pushManager.getSubscription();
}

/** Is this device subscribed, and what does the account allow? */
export async function pushStatus(): Promise<{on: boolean; prefs: Prefs}> {
  const sub = await currentSub().catch(() => null);
  const s = await call<{prefs: Prefs; thisDevice: boolean}>({action: 'status', endpoint: sub?.endpoint});
  return {on: !!sub && s.thisDevice, prefs: s.prefs};
}

/** Asks for permission (must be called from a tap) and subscribes this device. */
export async function enablePush(prefs?: Partial<Prefs>): Promise<Prefs> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked. Allow them for this site in your phone or browser settings.' : 'Notifications weren’t allowed.');
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY)});
  const out = await call<{prefs: Prefs}>({action: 'subscribe', subscription: sub.toJSON(), prefs});
  return out.prefs;
}

export async function disablePush() {
  const sub = await currentSub().catch(() => null);
  if (sub) { await call({action: 'unsubscribe', endpoint: sub.endpoint}).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
}

export const setPushPrefs = (prefs: Partial<Prefs>) => call<{prefs: Prefs}>({action: 'prefs', prefs}).then(o => o.prefs);
