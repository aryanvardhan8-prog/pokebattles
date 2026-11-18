// Supabase Edge Function: the owner's private stats page (?admin on the site). Only the AryanV account may call it.
// Gathers: accounts (new per day), time spent per player, daily-game plays, friend battles, friends, trainers, countries.

import {createClient} from 'npm:@supabase/supabase-js@2';

const OWNER = 'aryanv';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {...cors, 'Content-Type': 'application/json'}});
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const BUCKET = 'profiles';

async function read<T>(path: string, fallback: T): Promise<T> {
  const {data} = await db.storage.from(BUCKET).download(path);
  if (!data) return fallback;
  try { return JSON.parse(await data.text()); } catch { return fallback; }
}
async function list(prefix: string): Promise<{name: string}[]> {
  const out: {name: string}[] = [];
  for (let offset = 0; ; offset += 1000) {
    const {data} = await db.storage.from(BUCKET).list(prefix, {limit: 1000, offset});
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
/** Runs async jobs a few at a time. */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({length: n}, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

const CACHE = 'admin/cache.json';
const FRESH_MS = 10 * 60 * 1000;

/** One-time copy of the old per-file data into the new tables (run once by the owner's cron call ?job=migrate). */
async function migrate() {
  const actFiles = (await list('activity')).filter(f => f.name.endsWith('.json'));
  const acts = (await pool(actFiles, 12, f => read<any>(`activity/${f.name}`, null))).filter(Boolean);
  for (let i = 0; i < acts.length; i += 200) {
    await db.from('activity').upsert(acts.slice(i, i + 200).map((r: any) => ({key: String(r.key), username: r.username ?? '', total: r.total ?? 0,
      days: r.days ?? {}, visits: r.visits ?? 0, first: r.first ?? 0, last: r.last ?? 0})), {ignoreDuplicates: true});
  }
  const matchDirs = (await list('matches')).map(f => f.name);
  const rows = (await pool(matchDirs, 12, async id => {
    const files = new Set((await list(`matches/${id}`)).map(f => f.name));
    const meta = await read<any>(`matches/${id}/meta.json`, null);
    if (!meta) return null;
    const rounds = files.has('rounds.json') ? await read<any>(`matches/${id}/rounds.json`, {rounds: []}) : {rounds: []};
    const picks = async (side: string) => files.has(`team-${side}.json`) ? ((await read<any>(`matches/${id}/team-${side}.json`, {mons: []})).mons ?? []).map((m: any) => m.species) : [];
    return {id, host: meta.host?.name ?? '', guest: meta.guest?.name ?? '', created: meta.created ?? 0, declined: !!meta.declined,
      team_host: files.has('team-host.json'), team_guest: files.has('team-guest.json'), picks_host: await picks('host'), picks_guest: await picks('guest'),
      rounds: rounds.rounds?.length ?? 0, forfeit: [...files].some(f => f.startsWith('forfeit')), options: meta.options ?? null};
  })).filter(Boolean);
  for (let i = 0; i < rows.length; i += 200) await db.from('match_summary').upsert(rows.slice(i, i + 200));
  const {data: players} = await db.from('players').select('id');
  await pool(players ?? [], 12, async (p: {id: string}) => {
    const f = await read<string[]>(`${p.id}/friends.json`, []);
    if (f.length) await db.from('players').update({friend_count: f.length}).eq('id', p.id);
  });
  return {activity: acts.length, matches: rows.length};
}

/** Everything the stats page shows, from tables (one read each) plus a handful of small files. */
async function build() {
  const users: any[] = [];
  for (let page = 1; ; page++) {
    const {data, error} = await db.auth.admin.listUsers({page, perPage: 1000});
    if (error) break;
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  const accounts = users.map(u => ({
    id: u.id, email: String(u.email ?? ''), username: String(u.user_metadata?.username ?? ''), country: String(u.user_metadata?.country ?? ''),
    trainer: String(u.user_metadata?.trainer ?? ''), created: u.created_at, lastSignIn: u.last_sign_in_at,
  })).filter(u => u.username);
  const nameById = new Map(accounts.map(a => [a.id, a.username]));

  const [{data: act}, {data: results}, {data: ms}, {data: fc}, {data: errors}] = await Promise.all([
    db.from('activity').select('*').limit(100000),
    db.from('results').select('day, level, won, name, client_id, created_at').limit(100000),
    db.from('match_summary').select('*').limit(100000),
    db.from('players').select('friend_count').gt('friend_count', 0).limit(100000),
    db.from('client_errors').select('day, message, stack, page, device, username, site, count, last_at').order('last_at', {ascending: false}).limit(150),
  ]);
  const activity = (act ?? []).map((r: any) => ({key: r.key, username: r.username || nameById.get(r.key) || '', guest: String(r.key).startsWith('guest-'),
    total: r.total, days: r.days, visits: r.visits, first: Number(r.first), last: Number(r.last)}));
  const matches = (ms ?? []).map((m: any) => ({id: m.id, host: m.host, guest: m.guest, created: Number(m.created), declined: m.declined,
    teams: Number(m.team_host) + Number(m.team_guest), rounds: m.rounds, forfeit: m.forfeit, options: m.options, picks: [...m.picks_host, ...m.picks_guest]}));
  const counts = (fc ?? []).map((r: any) => r.friend_count as number);

  const pushFiles = (await list('push')).filter(f => f.name.endsWith('.json'));
  const push = (await pool(pushFiles, 8, async f => {
    const r = await read<any>(`push/${f.name}`, null);
    const id = f.name.replace(/\.json$/, '');
    return r ? {username: nameById.get(id) ?? '', devices: (r.subs ?? []).length, prefs: r.prefs ?? {}} : null;
  })).filter((p: any) => p && p.devices > 0);
  const fbFiles = (await list('feedback')).filter(f => f.name.endsWith('.json')).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 300);
  const feedback = (await pool(fbFiles, 8, f => read<any>(`feedback/${f.name}`, null))).filter(Boolean);

  return {now: Date.now(), accounts, push, feedback, errors: errors ?? [], activity, results: results ?? [], matches,
    friends: {pairs: Math.round(counts.reduce((a, b) => a + b, 0) / 2), withFriends: counts.length}};
}
async function buildAndSave() {
  const data = await build();
  await db.storage.from(BUCKET).upload(CACHE, new Blob([JSON.stringify(data)], {type: 'application/json'}), {upsert: true, contentType: 'application/json'});
  return data;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: cors});
  const job = new URL(req.url).searchParams.get('job');
  // Background jobs from pg_cron (cron secret from Vault): rebuild the cache every 5 minutes, or the one-time copy.
  if (job && req.headers.get('x-cron-secret') === Deno.env.get('CRON_SECRET')) {
    if (job === 'migrate') return json(await migrate());
    await buildAndSave();
    return json({ok: true});
  }
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const {data: auth} = token ? await db.auth.getUser(token) : {data: {user: null}};
  if (String(auth?.user?.user_metadata?.username ?? '').toLowerCase() !== OWNER) return json({error: 'Not allowed.'}, 403);
  // The owner: the pre-built copy straight away (rebuilt if it's older than 10 minutes or ?fresh=1).
  const fresh = new URL(req.url).searchParams.has('fresh');
  if (!fresh) {
    const cached = await read<any>(CACHE, null);
    if (cached && Date.now() - cached.now < FRESH_MS) return json(cached);
  }
  return json(await buildAndSave());
});
