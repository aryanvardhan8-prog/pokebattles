// Supabase Edge Function: a logged-in player's saved stats and friends.
// Stored as small private JSON files in Storage (bucket "profiles"): {userId}/stats.json and {userId}/friends.json.
// Every call needs the player's login token. Friends are mutual: adding someone adds you to their list too.
//
// POST {action: 'load'}                         → {stats, friends: [{id, username, country}]}
// POST {action: 'saveStats', stats}             → {ok}
// POST {action: 'addFriend', username}          → {friends}
// POST {action: 'removeFriend', id}             → {friends}
// POST {action: 'requestFriend', username}      → {sent} (or {friends, added} if they had already asked you)
// POST {action: 'answerRequest', id, accept}    → {friends, requests}
// Friend requests: {userId}/requests.json = ids asking me; {userId}/sent.json = ids I've asked.

import {createClient} from 'npm:@supabase/supabase-js@2';

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

async function ensureBucket() {
  if (bucketReady) return;
  const {data} = await db.storage.getBucket(BUCKET);
  if (!data) await db.storage.createBucket(BUCKET, {public: false});
  bucketReady = true;
}
async function readJson<T>(path: string, fallback: T): Promise<T> {
  const {data} = await db.storage.from(BUCKET).download(path);
  if (!data) return fallback;
  try { return JSON.parse(await data.text()); } catch { return fallback; }
}
async function writeJson(path: string, value: unknown) {
  const body = new Blob([JSON.stringify(value)], {type: 'application/json'});
  const {error} = await db.storage.from(BUCKET).upload(path, body, {upsert: true, contentType: 'application/json'});
  if (error) throw error;
  // Friend counts also live on the players table (for the owner's stats page).
  const f = /^([0-9a-f-]{36})\/friends\.json$/.exec(path);
  if (f && Array.isArray(value)) await db.from('players').update({friend_count: value.length}).eq('id', f[1]);
}

interface UserLite { id: string; username: string; country: string }
async function userByName(name: string): Promise<UserLite | null> {
  const {data} = await db.from('players').select('id, username, country').ilike('username', name.replace(/[%_\\]/g, '\\$&')).limit(1);
  return (data?.[0] as UserLite | undefined) ?? null;
}
async function usersByIds(ids: string[]): Promise<UserLite[]> {
  if (!ids.length) return [];
  const {data} = await db.from('players').select('id, username, country').in('id', ids);
  const users = (data ?? []) as UserLite[];
  return ids.map(id => users.find(u => u.id === id)).filter((u): u is UserLite => !!u && !!u.username);
}
async function makeFriends(a: string, b: string) {
  for (const [x, y] of [[a, b], [b, a]]) {
    const list: string[] = await readJson(`${x}/friends.json`, []);
    if (!list.includes(y)) { list.push(y); await writeJson(`${x}/friends.json`, list.slice(-500)); }
    // Any request between the two is settled.
    const req: string[] = await readJson(`${x}/requests.json`, []);
    if (req.includes(y)) await writeJson(`${x}/requests.json`, req.filter(i => i !== y));
    const sent: string[] = await readJson(`${x}/sent.json`, []);
    if (sent.includes(y)) await writeJson(`${x}/sent.json`, sent.filter(i => i !== y));
  }
}
async function friendsOf(userId: string): Promise<UserLite[]> {
  return usersByIds(await readJson(`${userId}/friends.json`, []));
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: cors});
  if (req.method !== 'POST') return json({error: 'POST only'}, 405);
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const {data: auth} = token ? await db.auth.getUser(token) : {data: {user: null}};
  const me = auth?.user;
  if (!me) return json({error: 'Please log in again.'}, 401);

  let body: {action?: string; stats?: unknown; username?: string; id?: string; loadouts?: unknown; accept?: boolean};
  try { body = await req.json(); } catch { return json({error: 'Bad request.'}, 400); }
  await ensureBucket();

  try {
    switch (body.action) {
      case 'load':
        return json({stats: await readJson(`${me.id}/stats.json`, null), friends: await friendsOf(me.id),
          loadouts: await readJson(`${me.id}/loadouts.json`, null),
          requests: await usersByIds(await readJson(`${me.id}/requests.json`, [])),
          sent: await usersByIds(await readJson(`${me.id}/sent.json`, []))});

      case 'requestFriend': {
        const name = String(body.username ?? '').trim().toLowerCase();
        const them = await userByName(name);
        if (!them) return json({error: 'No trainer has that username.'}, 404);
        if (them.id === me.id) return json({error: 'That’s you!'}, 400);
        const mine: string[] = await readJson(`${me.id}/friends.json`, []);
        if (mine.includes(them.id)) return json({error: `You and ${them.username} are already friends.`}, 400);
        // They already asked me: that's a yes from both sides.
        const asking: string[] = await readJson(`${me.id}/requests.json`, []);
        if (asking.includes(them.id)) {
          await makeFriends(me.id, them.id);
          return json({friends: await friendsOf(me.id), added: them.username});
        }
        const theirs: string[] = await readJson(`${them.id}/requests.json`, []);
        if (!theirs.includes(me.id)) await writeJson(`${them.id}/requests.json`, [...theirs, me.id].slice(-200));
        const sent: string[] = await readJson(`${me.id}/sent.json`, []);
        if (!sent.includes(them.id)) await writeJson(`${me.id}/sent.json`, [...sent, them.id].slice(-200));
        return json({sent: them.username});
      }

      case 'answerRequest': {
        const id = String(body.id ?? '');
        const asking: string[] = await readJson(`${me.id}/requests.json`, []);
        if (!asking.includes(id)) return json({error: 'That request is gone.'}, 404);
        if (body.accept) await makeFriends(me.id, id);
        else {
          await writeJson(`${me.id}/requests.json`, asking.filter(i => i !== id));
          const sent: string[] = await readJson(`${id}/sent.json`, []);
          await writeJson(`${id}/sent.json`, sent.filter(i => i !== me.id));
        }
        return json({friends: await friendsOf(me.id), requests: await usersByIds(await readJson(`${me.id}/requests.json`, []))});
      }

      case 'saveLoadouts': {
        // Saved teams, shared by every device and both sites (live + test) for this account.
        if (!Array.isArray(body.loadouts) || body.loadouts.length > 12) return json({error: 'Bad teams.'}, 400);
        if (JSON.stringify(body.loadouts).length > 60_000) return json({error: 'Too much data.'}, 400);
        await writeJson(`${me.id}/loadouts.json`, body.loadouts);
        return json({ok: true});
      }

      // Today's Elite Four run, so it can be continued on another device ({userId}/elite/{date}.json).
      case 'saveElite': {
        const date = String((body as any).date ?? '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({error: 'Bad date.'}, 400);
        const text = JSON.stringify((body as any).run ?? null);
        if (text.length > 300_000) return json({error: 'Too much data.'}, 400);
        await writeJson(`${me.id}/elite/${date}${(body as any).mode === 'hard' ? '-hard' : ''}.json`, (body as any).run);
        return json({ok: true});
      }
      case 'loadElite': {
        const date = String((body as any).date ?? '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({error: 'Bad date.'}, 400);
        return json({run: await readJson(`${me.id}/elite/${date}${(body as any).mode === 'hard' ? '-hard' : ''}.json`, null)});
      }

      case 'saveStats': {
        const text = JSON.stringify(body.stats ?? null);
        if (text.length > 400_000) return json({error: 'Too much data.'}, 400);
        await writeJson(`${me.id}/stats.json`, body.stats);
        return json({ok: true});
      }

      case 'addFriend': {
        const name = String(body.username ?? '').trim().toLowerCase();
        const them = await userByName(name);
        if (!them) return json({error: 'No trainer has that username.'}, 404);
        if (them.id === me.id) return json({error: 'That’s you!'}, 400);
        for (const [a, b] of [[me.id, them.id], [them.id, me.id]]) {
          const list: string[] = await readJson(`${a}/friends.json`, []);
          if (!list.includes(b)) {
            list.push(b);
            await writeJson(`${a}/friends.json`, list.slice(-500));
          }
        }
        return json({friends: await friendsOf(me.id), added: them.username});
      }

      case 'removeFriend': {
        const id = String(body.id ?? '');
        for (const [a, b] of [[me.id, id], [id, me.id]]) {
          if (!a || !b) continue;
          const list: string[] = await readJson(`${a}/friends.json`, []);
          await writeJson(`${a}/friends.json`, list.filter(x => x !== b));
        }
        return json({friends: await friendsOf(me.id)});
      }
    }
  } catch {
    return json({error: 'Something went wrong. Try again.'}, 500);
  }
  return json({error: 'Unknown action.'}, 400);
});
