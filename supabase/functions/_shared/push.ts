// Web push for DailyBattles (shared by the push, push-cron and match functions).
// Subscriptions live in the private bucket "profiles" at push/{userId}.json:
//   {subs: [PushSubscription JSON], prefs: {challenge, daily, streak}}
// Keys come from the Supabase secrets VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT.

import webpush from 'npm:web-push@3.6.7';
import {createClient} from 'npm:@supabase/supabase-js@2';

export const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const BUCKET = 'profiles';
webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

export type Prefs = {challenge: boolean; daily: boolean; streak: boolean};
export interface PushRecord { subs: any[]; prefs: Prefs }
export const DEFAULT_PREFS: Prefs = {challenge: true, daily: true, streak: true};

export async function readRecord(userId: string): Promise<PushRecord> {
  const {data} = await db.storage.from(BUCKET).download(`push/${userId}.json`);
  if (!data) return {subs: [], prefs: {...DEFAULT_PREFS}};
  try { const r = JSON.parse(await data.text()); return {subs: r.subs ?? [], prefs: {...DEFAULT_PREFS, ...(r.prefs ?? {})}}; }
  catch { return {subs: [], prefs: {...DEFAULT_PREFS}}; }
}
export async function writeRecord(userId: string, rec: PushRecord) {
  await db.storage.from(BUCKET).upload(`push/${userId}.json`, new Blob([JSON.stringify(rec)], {type: 'application/json'}), {upsert: true, contentType: 'application/json'});
}
export async function allUserIds(): Promise<string[]> {
  const {data} = await db.storage.from(BUCKET).list('push', {limit: 10000});
  return (data ?? []).map(f => f.name.replace(/\.json$/, '')).filter(Boolean);
}

/** Sends one notification to every device of a player who allows this kind. Drops dead subscriptions. */
export async function notify(userId: string, kind: keyof Prefs, msg: {title: string; body: string; url?: string; tag?: string}) {
  const rec = await readRecord(userId);
  if (!rec.prefs[kind] || !rec.subs.length) return 0;
  let sent = 0;
  const alive: any[] = [];
  for (const sub of rec.subs) {
    try {
      await webpush.sendNotification(sub, JSON.stringify({...msg, url: msg.url ?? '/'}), {TTL: 6 * 3600});
      alive.push(sub);
      sent++;
    } catch (e) {
      const code = (e as {statusCode?: number}).statusCode;
      if (code !== 404 && code !== 410) alive.push(sub); // 404/410 = the device unsubscribed
    }
  }
  if (alive.length !== rec.subs.length) await writeRecord(userId, {...rec, subs: alive});
  return sent;
}

/** Finds an account id by username (case-insensitive). */
export async function userIdByName(name: string): Promise<string | null> {
  const want = name.toLowerCase();
  for (let page = 1; ; page++) {
    const {data, error} = await db.auth.admin.listUsers({page, perPage: 1000});
    if (error) return null;
    const u = data.users.find(x => String(x.user_metadata?.username ?? '').toLowerCase() === want);
    if (u) return u.id;
    if (data.users.length < 1000) return null;
  }
}
