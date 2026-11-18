// Supabase Edge Function: creates a player account (email + password + username).
// Done on the server so usernames stay unique and accounts are ready to use straight away
// (no confirmation email to wait for). The player then logs in with email + password.

import {createClient} from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {...cors, 'Content-Type': 'application/json'}});

// Usernames show on the public leaderboard (which allows 10 characters).
const USERNAME = /^[A-Za-z0-9_]{3,10}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BLOCKED = ['fuck', 'shit', 'bitch', 'cunt', 'nigg', 'fag', 'rape', 'nazi', 'hitler', 'porn', 'sex', 'dick', 'pussy', 'whore', 'slut', 'retard', 'admin', 'moderator'];

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: cors});
  if (req.method !== 'POST') return json({error: 'POST only'}, 405);

  let body: {action?: string; email?: string; password?: string; username?: string; country?: string};
  try {
    body = await req.json();
  } catch {
    return json({error: 'Bad request.'}, 400);
  }
  if (body.action === 'rename') return rename(req, String(body.username ?? '').trim());
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const username = String(body.username ?? '').trim();
  const country = /^[A-Z]{2}$/.test(String(body.country ?? '')) ? String(body.country) : '';

  if (!EMAIL.test(email)) return json({error: 'Enter a valid email address.'}, 400);
  if (password.length < 6) return json({error: 'Password needs at least 6 characters.'}, 400);
  if (!USERNAME.test(username)) return json({error: 'Username: 3 to 10 letters, numbers or _.'}, 400);
  const lower = username.toLowerCase();
  if (BLOCKED.some(w => lower.includes(w))) return json({error: 'Please pick a different username.'}, 400);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Username must be unique (players table, kept in sync with accounts). A taken email is caught by createUser.
  if (await taken(db, lower)) return json({error: 'That username is taken.'}, 409);

  const {error} = await db.auth.admin.createUser({email, password, email_confirm: true, user_metadata: {username, country}});
  if (error) {
    if (/already/i.test(error.message)) return json({error: 'That email already has an account. Log in instead.'}, 409);
    return json({error: 'Could not create the account. Try again.'}, 500);
  }
  return json({ok: true, username});
});


/** Takes a username if nobody else has it (case-insensitive). */
async function taken(db: ReturnType<typeof createClient>, lower: string, exceptId = '') {
  const {data, error} = await db.from('players').select('id').ilike('username', lower.replace(/[%_\\]/g, '\\$&'));
  if (error) throw error;
  return (data ?? []).some((u: {id: string}) => u.id !== exceptId);
}

const RENAME_DAYS = 7;

/** A logged-in player changes their username (once a week). Their leaderboard entries, friend challenges
 *  and friend-battle history follow the new name. */
async function rename(req: Request, username: string) {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const {data: auth} = token ? await db.auth.getUser(token) : {data: {user: null}};
  const user = auth?.user;
  if (!user) return json({error: 'Log in first.'}, 401);
  const old = String(user.user_metadata?.username ?? '');
  if (!USERNAME.test(username)) return json({error: 'Username: 3 to 10 letters, numbers or _.'}, 400);
  const lower = username.toLowerCase();
  if (BLOCKED.some(w => lower.includes(w))) return json({error: 'Please pick a different username.'}, 400);
  if (username === old) return json({ok: true, username});
  const last = Number(user.user_metadata?.renamed_at ?? 0);
  const wait = last + RENAME_DAYS * 864e5 - Date.now();
  if (wait > 0 && lower !== old.toLowerCase()) return json({error: `You can change your username again in ${Math.ceil(wait / 864e5)} ${Math.ceil(wait / 864e5) === 1 ? 'day' : 'days'}.`}, 429);
  try {
    if (await taken(db, lower, user.id)) return json({error: 'That username is taken.'}, 409);
  } catch { return json({error: 'Could not change it. Try again.'}, 500); }
  const {error} = await db.auth.admin.updateUserById(user.id, {user_metadata: {...user.user_metadata, username,
    renamed_at: lower === old.toLowerCase() ? last : Date.now()}});
  if (error) return json({error: 'Could not change it. Try again.'}, 500);
  // The leaderboard shows names, so past results follow the new name.
  await db.from('results').update({name: username}).eq('client_id', user.id);
  // Pending challenges sent to the old name, and opponents' match lists (for head-to-head records).
  const bucket = db.storage.from('profiles');
  const read = async (p: string) => { const {data} = await bucket.download(p); try { return data ? JSON.parse(await data.text()) : null; } catch { return null; } };
  const write = (p: string, v: unknown) => bucket.upload(p, new Blob([JSON.stringify(v)], {type: 'application/json'}), {upsert: true, contentType: 'application/json'});
  const norm = (n: string) => `invites/${n.toLowerCase().replace(/[^a-z0-9_]/g, '')}.json`;
  try {
    const inv = await read(norm(old));
    if (inv && old.toLowerCase() !== lower) { await write(norm(username), inv); await bucket.remove([norm(old)]); }
    const mine: {id: string; opp: string}[] = (await read(`${user.id}/matches.json`)) ?? [];
    const done = new Set<string>();
    for (const e of mine.slice(0, 60)) {
      const meta = await read(`matches/${e.id}/meta.json`);
      if (!meta) continue;
      const mySide = meta.host?.id === user.id ? 'host' : 'guest';
      meta[mySide] = {...meta[mySide], name: username};
      await write(`matches/${e.id}/meta.json`, meta);
      const opp = mySide === 'host' ? meta.guest : meta.host;
      if (!opp?.id || done.has(opp.id)) continue;
      done.add(opp.id);
      const theirs: {opp: string}[] | null = await read(`${opp.id}/matches.json`);
      if (theirs) { theirs.forEach(x => { if (x.opp.toLowerCase() === old.toLowerCase()) x.opp = username; }); await write(`${opp.id}/matches.json`, theirs); }
    }
  } catch { /* the name change itself worked */ }
  return json({ok: true, username});
}
