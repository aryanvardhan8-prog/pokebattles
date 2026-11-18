// Time spent on the site, for the owner's stats page. Counts seconds while the page is visible and the
// player has done something in the last 2 minutes (so a forgotten tab doesn't count), and sends them about
// once a minute to the `activity` function. Logged-in players are counted by account, guests by a random id.

import {SUPABASE_URL, SUPABASE_KEY} from './config';
import {accessToken} from './account';

const DEVICE_KEY = 'pokebattles:device';
const IDLE_MS = 2 * 60 * 1000;

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  } catch { return 'unknown'; }
}

export function startActivityTracking() {
  if (import.meta.env.DEV) return; // the local test server doesn't count
  let pending = 0;
  let lastInput = Date.now();
  const touch = () => { lastInput = Date.now(); };
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll']) window.addEventListener(ev, touch, {passive: true, capture: true});

  const flush = async (leaving = false) => {
    if (pending < (leaving ? 3 : 10)) return;
    const seconds = Math.min(300, Math.round(pending));
    pending = 0;
    const token = await accessToken().catch(() => null);
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/activity`, {
        method: 'POST', keepalive: true,
        headers: {apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
        body: JSON.stringify({seconds, device: deviceId()}),
      });
    } catch { /* offline: those seconds are lost, which is fine */ }
  };

  setInterval(() => {
    if (document.visibilityState === 'visible' && Date.now() - lastInput < IDLE_MS) pending++;
  }, 1000);
  setInterval(() => void flush(), 60_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flush(true); });
}
