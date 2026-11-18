// Sends errors players hit to the server (feedback function → client_errors table), so the owner's
// stats page shows what broke and where. At most a few per visit; off on the local dev server.

import {SUPABASE_URL, SUPABASE_KEY} from './config';
import {accessToken} from './account';

const MAX = 5;
const IGNORE = [/ResizeObserver loop/i, /^Script error\.?$/i, /extension:\/\//i, /Load failed$/i, /Failed to fetch$/i, /NetworkError/i, /AbortError/i,
  /ethereum|web3|metamask|solana/i, // crypto-wallet apps on the player's device, not our code
  /audio device|AudioContext/i, // the phone wouldn't let the browser play sound
  /^Rejected$/i]; // a feature refused by the browser (in-app browsers block some)

export function initErrorReports() {
  if (import.meta.env.DEV) return;
  let sent = 0;
  const seen = new Set<string>();
  const report = async (message: string, stack = '') => {
    if (!message || sent >= MAX || IGNORE.some(r => r.test(message) || r.test(stack))) return;
    const key = message + stack.slice(0, 200);
    if (seen.has(key)) return;
    seen.add(key);
    sent++;
    try {
      const token = await accessToken().catch(() => null);
      await fetch(`${SUPABASE_URL}/functions/v1/feedback`, {
        method: 'POST', keepalive: true,
        headers: {apikey: SUPABASE_KEY, Authorization: `Bearer ${token ?? SUPABASE_KEY}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({error: true, message: message.slice(0, 500), stack: stack.slice(0, 2000),
          page: location.pathname + location.search.slice(0, 80), device: navigator.userAgent, site: location.host}),
      });
    } catch { /* offline */ }
  };
  addEventListener('error', e => void report(e.message || String(e.error ?? ''), e.error?.stack ?? `${e.filename}:${e.lineno}:${e.colno}`));
  addEventListener('unhandledrejection', e => {
    const r = e.reason;
    void report(r instanceof Error ? r.message : String(r ?? ''), r instanceof Error ? r.stack ?? '' : '');
  });
}
