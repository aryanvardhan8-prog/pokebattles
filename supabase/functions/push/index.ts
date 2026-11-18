// Supabase Edge Function: a logged-in player's notification settings.
// POST {action: 'subscribe', subscription, prefs?} → {prefs}   (adds this device)
// POST {action: 'unsubscribe', endpoint}          → {ok}      (removes this device)
// POST {action: 'prefs', prefs}                   → {prefs}
// POST {action: 'status', endpoint?}              → {prefs, devices, thisDevice}

import {db, readRecord, writeRecord, DEFAULT_PREFS, type Prefs} from '../_shared/push.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {...cors, 'Content-Type': 'application/json'}});
const cleanPrefs = (p: any): Partial<Prefs> => Object.fromEntries(Object.keys(DEFAULT_PREFS).filter(k => typeof p?.[k] === 'boolean').map(k => [k, p[k]]));

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: cors});
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const {data: auth} = token ? await db.auth.getUser(token) : {data: {user: null}};
  const me = auth?.user;
  if (!me) return json({error: 'Please log in to turn on notifications.'}, 401);
  let body: any;
  try { body = await req.json(); } catch { return json({error: 'Bad request.'}, 400); }
  const rec = await readRecord(me.id);
  switch (body.action) {
    case 'subscribe': {
      const sub = body.subscription;
      if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json({error: 'Bad subscription.'}, 400);
      rec.subs = [...rec.subs.filter(s => s.endpoint !== sub.endpoint), {endpoint: sub.endpoint, keys: sub.keys}].slice(-10);
      rec.prefs = {...rec.prefs, ...cleanPrefs(body.prefs)};
      await writeRecord(me.id, rec);
      return json({prefs: rec.prefs});
    }
    case 'unsubscribe':
      rec.subs = rec.subs.filter(s => s.endpoint !== body.endpoint);
      await writeRecord(me.id, rec);
      return json({ok: true});
    case 'prefs':
      rec.prefs = {...rec.prefs, ...cleanPrefs(body.prefs)};
      await writeRecord(me.id, rec);
      return json({prefs: rec.prefs});
    case 'status':
      return json({prefs: rec.prefs, devices: rec.subs.length, thisDevice: rec.subs.some(s => s.endpoint === body.endpoint)});
  }
  return json({error: 'Unknown action.'}, 400);
});
