// Supabase Edge Function: saves a feedback message (also sent to Netlify Forms) so the owner's stats page can list it.
// Stored in the private bucket "profiles" as feedback/{time}-{random}.json. Anyone may send; login is optional.

import {createClient} from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {...cors, 'Content-Type': 'application/json'}});
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const clip = (v: unknown, n: number) => String(v ?? '').slice(0, n);

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: cors});
  if (req.method !== 'POST') return json({error: 'POST only'}, 405);
  let b: any;
  try { b = await req.json(); } catch { return json({error: 'Bad request.'}, 400); }
  // Errors from the game (src/errors.ts): grouped per day by their first line + where they happened.
  if (b.error) {
    const msg = clip(b.message, 500).trim();
    if (!msg) return json({error: 'Empty.'}, 400);
    const stack = clip(b.stack, 2000);
    const sig = (msg + '|' + (stack.split('\n').find((l: string) => /\.js|\.ts/.test(l)) ?? '').replace(/\?[^:)]*/g, '').replace(/:\d+:\d+/g, '')).slice(0, 300);
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const {data: auth} = token && token.split('.').length === 3 ? await db.auth.getUser(token) : {data: {user: null}};
    await db.rpc('log_client_error', {p_sig: sig, p_message: msg, p_stack: stack, p_page: clip(b.page, 200), p_device: clip(b.device, 300),
      p_username: auth?.user ? String(auth.user.user_metadata?.username ?? '') : '', p_site: clip(b.site, 80)});
    return json({ok: true});
  }
  const message = clip(b.message, 2000).trim();
  if (message.length < 3) return json({error: 'Message too short.'}, 400);
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const {data: auth} = token && token.split('.').length === 3 ? await db.auth.getUser(token) : {data: {user: null}};
  const rec = {
    at: Date.now(), kind: ['Idea', 'Bug', 'Other'].includes(b.kind) ? b.kind : 'Other', message,
    contact: clip(b.contact, 120), username: auth?.user ? String(auth.user.user_metadata?.username ?? '') : '',
    site: clip(b.site, 80), device: clip(b.device, 300),
  };
  const name = `feedback/${rec.at}-${crypto.randomUUID().slice(0, 8)}.json`;
  const {error} = await db.storage.from('profiles').upload(name, new Blob([JSON.stringify(rec)], {type: 'application/json'}), {contentType: 'application/json'});
  if (error) return json({error: 'Could not save.'}, 500);
  return json({ok: true});
});
