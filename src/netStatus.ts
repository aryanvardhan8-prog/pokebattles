// A small "weak / no connection" badge at the top of the battle screen (hidden on the menu and pages, see style.css). It watches the game's own requests to the
// server (slow or failing → weak) and the browser's online/offline events, and hides again once requests are quick.

import {SUPABASE_URL, SUPABASE_KEY} from './config';

const SLOW_MS = 4000;
type State = 'ok' | 'weak' | 'offline';

const WIFI = (bars: number) => `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
  ${[[20, 'M2.5 9.2a14 14 0 0 1 19 0'], [15, 'M5.8 12.6a9.3 9.3 0 0 1 12.4 0'], [10, 'M9 16a4.6 4.6 0 0 1 6 0']]
    .map(([, d], i) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity="${3 - i <= bars ? 1 : 0.28}"/>`).join('')}
  <circle cx="12" cy="19.3" r="1.6" fill="currentColor"/>
  ${bars === 0 ? '<path d="M4 4l16 16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' : ''}
</svg>`;

export function initNetStatus() {
  const el = document.createElement('div');
  el.id = 'net-status';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.hidden = true;
  document.body.appendChild(el);

  let state: State = 'ok', okStreak = 0;
  const show = (s: State) => {
    if (s === state) return;
    state = s;
    el.hidden = s === 'ok';
    el.className = s;
    el.innerHTML = s === 'offline' ? `${WIFI(0)}<span>No connection</span>` : s === 'weak' ? `${WIFI(1)}<span>Weak connection</span>` : '';
  };

  // Time every request to the game server.
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(SUPABASE_URL)) return realFetch(input, init);
    const t0 = performance.now();
    // Still waiting after SLOW_MS: show the badge straight away (don't wait for the answer).
    const slowTimer = setTimeout(() => { if (navigator.onLine) show('weak'); }, SLOW_MS);
    try {
      const res = await realFetch(input, init);
      const ms = performance.now() - t0;
      if (ms > SLOW_MS) { okStreak = 0; show('weak'); } else if (++okStreak >= 2 || state === 'offline') show('ok');
      return res;
    } catch (e) {
      okStreak = 0;
      show(navigator.onLine ? 'weak' : 'offline');
      throw e;
    } finally {
      clearTimeout(slowTimer);
    }
  };

  // While the badge is showing, check again every 10 s (so it clears even if nothing else is loading).
  setInterval(() => {
    if (state === 'ok' || !navigator.onLine || document.hidden) return;
    void window.fetch(`${SUPABASE_URL}/auth/v1/health`, {headers: {apikey: SUPABASE_KEY}, cache: 'no-store'}).catch(() => {});
  }, 10_000);
  addEventListener('offline', () => show('offline'));
  addEventListener('online', () => show('weak')); // back, but unproven until a quick request comes through
  if (!navigator.onLine) show('offline');
}
