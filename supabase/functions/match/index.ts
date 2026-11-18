// Supabase Edge Function: live friend battles. The rules live in src/engine/matchCore.ts (bundled into engine.js,
// shared with the dev-only local mode); this file only adds login and Supabase Storage.

import {createClient} from 'npm:@supabase/supabase-js@2';
import {handleMatch, randomMatchId} from './engine.js';
import {notify, userIdByName} from '../_shared/push.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {...cors, 'Content-Type': 'application/json'}});

const BUCKET = 'profiles';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
let bucketReady = false;

const store = {
  async read<T>(path: string, fallback: T): Promise<T> {
    const {data} = await db.storage.from(BUCKET).download(path);
    if (!data) return fallback;
    try { return JSON.parse(await data.text()); } catch { return fallback; }
  },
  async write(path: string, value: unknown) {
    const {error} = await db.storage.from(BUCKET).upload(path, new Blob([JSON.stringify(value)], {type: 'application/json'}),
      {upsert: true, contentType: 'application/json'});
    if (error) throw error;
    await summarise(path, value).catch(() => {});
  },
  async remove(paths: string[]) {
    if (paths.length) await db.storage.from(BUCKET).remove(paths);
  },
};

/** Keeps a one-row summary of each match in the `match_summary` table (sql/012) for the owner's stats page,
 *  from the files as they're written (no extra reads). */
// deno-lint-ignore no-explicit-any
async function summarise(path: string, v: any) {
  const m = /^matches\/([^/]+)\/(.+)\.json$/.exec(path);
  if (!m) return;
  const [, id, file] = m;
  // deno-lint-ignore no-explicit-any
  let row: Record<string, any> | null = null;
  if (file === 'meta') row = {host: v?.host?.name ?? '', guest: v?.guest?.name ?? '', created: v?.created ?? 0, declined: !!v?.declined, options: v?.options ?? null};
  else if (file === 'team-host' || file === 'team-guest') {
    const side = file.slice(5);
    row = {[`team_${side}`]: true, [`picks_${side}`]: (v?.mons ?? []).map((x: {species: string}) => x.species)};
  } else if (file === 'rounds') row = {rounds: (v?.rounds ?? []).length};
  else if (file.startsWith('forfeit')) row = {forfeit: true};
  if (row) await db.from('match_summary').upsert({id, ...row, updated_at: new Date().toISOString()});
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: cors});
  if (req.method !== 'POST') return json({error: 'POST only'}, 405);
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const {data: auth} = token ? await db.auth.getUser(token) : {data: {user: null}};
  const user = auth?.user;
  if (!user) return json({error: 'Log in to play a friend.'}, 401);
  let body: unknown;
  try { body = await req.json(); } catch { return json({error: 'Bad request.'}, 400); }
  if (!bucketReady) {
    const {data} = await db.storage.getBucket(BUCKET);
    if (!data) await db.storage.createBucket(BUCKET, {public: false});
    bucketReady = true;
  }
  const me = {id: user.id, name: String(user.user_metadata?.username ?? 'Trainer'), country: String(user.user_metadata?.country ?? ''), trainer: String(user.user_metadata?.trainer ?? '').slice(0, 20)};
  const [status, out] = await handleMatch(store, me, body, randomMatchId, () => crypto.randomUUID());
  // A challenge to a named friend: also send them a phone notification (if they turned them on).
  const b = body as {action?: string; invite?: string; id?: string};
  if (status === 200 && (b.action === 'create' || b.action === 'invite') && typeof b.invite === 'string' && b.invite) {
    const id = b.action === 'invite' ? String(b.id ?? '').toUpperCase() : (out as {id: string}).id;
    const friendId = await userIdByName(b.invite).catch(() => null);
    if (friendId && friendId !== user.id) {
      await notify(friendId, 'challenge', {title: `${me.name} challenged you! ⚔️`, body: 'Tap to pick your team and battle.',
        url: `/?invite=${encodeURIComponent(me.name)}&match=${id}`, tag: `match-${id}`}).catch(() => 0);
    }
  }
  return json(out, status);
});
