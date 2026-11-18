// Friend battles: the match logic shared by the "match" server function and the dev-only local mode.
// Everything is kept as small JSON files through a Store (Supabase Storage on the server, localStorage locally):
//   matches/{id}/meta.json        host, guest, options, seed, created
//   matches/{id}/team-host.json   the host's picked team (hidden from the guest until both are ready); same for guest
//   matches/{id}/rounds.json      {rounds: [[hostAction, guestAction]...], auto: [[bool,bool]...], at: when this round began}
//   matches/{id}/turn-{n}-host.json  one side's secret choice for round n (deleted once the round is played)
//   matches/{id}/forfeit-{side}.json
//   {userId}/matches.json         that player's match list
// The battle itself is never stored: it is rebuilt from the teams + rounds with the engine (deterministic),
// exactly as both players' screens do.

import {Battle} from './battle';
import {RECHARGE_FROM_MS, NO_MISS_FROM_MS} from './daily';
import {teamError, levelsFor, randomTeam, isRandomFor, toMons, DEFAULT_OPTIONS, type PickedTeam} from './pvp';

export interface Store {
  read<T>(path: string, fallback: T): Promise<T>;
  write(path: string, value: unknown): Promise<void>;
  remove(paths: string[]): Promise<void>;
}
type Side = 'host' | 'guest';
const engineSide = (s: Side) => (s === 'host' ? 'player' : 'red');

export interface Player { id: string; name: string; country: string; trainer?: string }
interface Meta { id: string; seed: string; options: typeof DEFAULT_OPTIONS; host: Player; guest: Player | null; created: number; invited?: string; invitedAll?: string[]; declined?: boolean; cancelled?: boolean }
/** A pop-up challenge waiting for a logged-in friend (invites/{lowercase username}.json). */
interface Invite { id: string; from: Player; at: number }
const INVITE_MS = 24 * 3600 * 1000; // challenges stay on the Friends page for a day (pop-ups only for fresh ones)
const invitePath = (name: string) => `invites/${name.toLowerCase().replace(/[^a-z0-9_]/g, '')}.json`;
interface Rounds { rounds: [unknown, unknown][]; auto: [boolean, boolean][]; at: number }

const CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** A short, easy-to-read match code (no 0/O or 1/I). */
export const randomMatchId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => CODE[b % CODE.length]).join('');

/** Adds a match to a player's list (for "Your matches" and head-to-head records). */
async function remember(store: Store, userId: string, entry: {id: string; opp: string; role: Side; at: number}) {
  const list: typeof entry[] = await store.read(`${userId}/matches.json`, []);
  if (!list.some(m => m.id === entry.id)) list.unshift(entry);
  else list.forEach(m => { if (m.id === entry.id) m.opp = entry.opp; });
  await store.write(`${userId}/matches.json`, list.slice(0, 200));
}

function setupOf(meta: Meta, host: PickedTeam, guest: PickedTeam) {
  return {
    seed: meta.seed,
    clauses: {sleep: meta.options.clauses.sleep, freeze: meta.options.clauses.freeze, alwaysRecharge: meta.created >= RECHARGE_FROM_MS, sureHit: meta.created >= NO_MISS_FROM_MS},
    host: {name: meta.host.name, team: toMons(host), bag: host.bag ?? {}},
    guest: {name: meta.guest!.name, team: toMons(guest), bag: guest.bag ?? {}},
  };
}

/** Everything the server knows about a match right now (rebuilt from the files). */
async function load(store: Store, id: string) {
  const dir = `matches/${id}`;
  const meta = await store.read<Meta | null>(`${dir}/meta.json`, null);
  if (!meta) return null;
  const [teamHost, teamGuest, rounds, ffHost, ffGuest, seenHost, seenGuest, started, rrHost, rrGuest] = await Promise.all([
    store.read<any>(`${dir}/team-host.json`, null), store.read<any>(`${dir}/team-guest.json`, null),
    store.read<Rounds>(`${dir}/rounds.json`, {rounds: [], auto: [], at: 0}),
    store.read<any>(`${dir}/forfeit-host.json`, null), store.read<any>(`${dir}/forfeit-guest.json`, null),
    store.read<{at: number} | null>(`${dir}/seen-host.json`, null), store.read<{at: number} | null>(`${dir}/seen-guest.json`, null),
    store.read<any>(`${dir}/started.json`, null),
    store.read<any>(`${dir}/room-ready-host.json`, null), store.read<any>(`${dir}/room-ready-guest.json`, null),
  ]);
  let battle: Battle | null = null;
  if (teamHost && teamGuest && meta.guest) battle = Battle.replayPvp(setupOf(meta, teamHost, teamGuest), rounds.rounds as never);
  const autos = (s: 0 | 1) => rounds.auto.filter(a => a[s]).length;
  let winner: Side | null = null, how = '';
  if (ffHost) { winner = 'guest'; how = 'forfeit'; }
  else if (ffGuest) { winner = 'host'; how = 'forfeit'; }
  else if (autos(0) >= 3) { winner = 'guest'; how = 'timeout'; }
  else if (autos(1) >= 3) { winner = 'host'; how = 'timeout'; }
  else if (battle?.winner) { winner = battle.winner === 'player' ? 'host' : 'guest'; how = 'battle'; }
  const seen = {host: seenHost?.at ?? 0, guest: seenGuest?.at ?? 0};
  return {dir, meta, teamHost, teamGuest, rounds, battle, winner, how, seen, started: !!started, roomReady: {host: !!rrHost, guest: !!rrGuest}};
}
const aliveOn = (b: Battle, side: Side) => b.sides[side === 'host' ? 'player' : 'red'].team.filter(x => x.hp > 0).length;
type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;

const ONLINE_MS = 10_000;
export const FIRST_TURN_EXTRA = 45;
/** The battle room: both players have joined but haven't been in it at the same time yet (old matches skip it). */
const inRoom = (m: {meta: Meta; started: boolean; teamHost: unknown; teamGuest: unknown}) => !!m.meta.guest && !m.started && !m.teamHost && !m.teamGuest;
const stageOf = (m: Loaded) => m.meta.cancelled && !m.winner ? 'cancelled' : !m.meta.guest ? 'lobby' : inRoom(m) ? 'room' : !(m.teamHost && m.teamGuest) ? 'picking' : m.winner ? 'done' : 'battle';

/** Cancels a match that hasn't started battling: gone from both players' lists and from pending challenges. */
async function cancelMatch(store: Store, meta: Meta) {
  await store.write(`matches/${meta.id}/meta.json`, {...meta, cancelled: true});
  for (const p of [meta.host, meta.guest]) {
    if (!p) continue;
    const list: {id: string}[] = await store.read(`${p.id}/matches.json`, []);
    if (list.some(e => e.id === meta.id)) await store.write(`${p.id}/matches.json`, list.filter(e => e.id !== meta.id));
  }
  if (meta.invited) {
    const inv = await store.read<Invite[]>(invitePath(meta.invited), []);
    if (inv.some(x => x.id === meta.id)) await store.write(invitePath(meta.invited), inv.filter(x => x.id !== meta.id));
  }
}

/** Opens team picking when both players pressed Ready in the room and both are still here. */
async function maybeStart(store: Store, m: Loaded) {
  const now = Date.now();
  if (!inRoom(m) || !m.roomReady.host || !m.roomReady.guest) return false;
  if (now - m.seen.host > ONLINE_MS || now - m.seen.guest > ONLINE_MS) return false;
  await store.write(`${m.dir}/started.json`, {at: now});
  return true;
}

/** What this side has to do this round: 'act' (a move/switch/item), 'switch' (forced), or 'wait'. */
function duty(b: Battle, side: Side): 'act' | 'switch' | 'wait' {
  const mine = side === 'host' ? b.needSwitch : b.needSwitchRed;
  const theirs = side === 'host' ? b.needSwitchRed : b.needSwitch;
  if (mine) return 'switch';
  if (theirs) return 'wait';
  return 'act';
}

/** Plays the current round if both choices are in (safe to run twice: the result is the same). */
async function tryResolve(store: Store, m: Loaded): Promise<boolean> {
  const b = m.battle;
  if (!b || m.winner) return false;
  const n = m.rounds.rounds.length;
  const [h, g] = await Promise.all([store.read<any>(`${m.dir}/turn-${n}-host.json`, null), store.read<any>(`${m.dir}/turn-${n}-guest.json`, null)]);
  const dh = duty(b, 'host'), dg = duty(b, 'guest');
  const needH = dh !== 'wait', needG = dg !== 'wait';
  if ((needH && !h) || (needG && !g)) return false;
  const ev = b.stepPvp(needH ? h.action : null, needG ? g.action : null);
  if (ev.length === 1 && ev[0].t === 'text' && b.pvpLog.length === n) {
    // Someone's choice became illegal (shouldn't happen): drop both and let them choose again.
    await store.remove([`${m.dir}/turn-${n}-host.json`, `${m.dir}/turn-${n}-guest.json`]);
    return false;
  }
  const fresh = await store.read<Rounds>(`${m.dir}/rounds.json`, {rounds: [], auto: [], at: 0});
  if (fresh.rounds.length === n) {
    fresh.rounds.push([needH ? h.action : null, needG ? g.action : null]);
    fresh.auto.push([!!h?.auto, !!g?.auto]);
    fresh.at = Date.now();
    await store.write(`${m.dir}/rounds.json`, fresh);
  }
  await store.remove([`${m.dir}/turn-${n}-host.json`, `${m.dir}/turn-${n}-guest.json`]);
  return true;
}

/** A simple automatic choice when a player runs out of time: first usable move, or first healthy POKéMON. */
function autoAction(b: Battle, side: Side) {
  const es = engineSide(side) as 'player' | 'red';
  const s = b.sides[es];
  if (duty(b, side) === 'switch') return {type: 'switch', index: s.team.findIndex((p, i) => p.hp > 0 && i !== s.active)};
  const usable = b.usableSlots(es);
  return {type: 'move', slot: usable.length ? usable[0] : -1};
}

/** What one player is allowed to see. */
async function view(store: Store, m: Loaded, side: Side) {
  const n = m.rounds.rounds.length;
  const other: Side = side === 'host' ? 'guest' : 'host';
  const [mineIn, theirsIn] = await Promise.all([
    store.read<any>(`${m.dir}/turn-${n}-${side}.json`, null).then(Boolean),
    store.read<any>(`${m.dir}/turn-${n}-${other}.json`, null).then(Boolean),
  ]);
  const bothReady = !!(m.teamHost && m.teamGuest);
  const myTeam = side === 'host' ? m.teamHost : m.teamGuest;
  const stage = stageOf(m);
  const now = Date.now();
  return {
    online: {host: now - m.seen.host < ONLINE_MS, guest: now - m.seen.guest < ONLINE_MS},
    roomReady: m.roomReady,
    id: m.meta.id, side, stage, options: m.meta.options, seed: m.meta.seed,
    host: m.meta.host, guest: m.meta.guest, created: m.meta.created, declined: !!m.meta.declined,
    invited: m.meta.invitedAll ?? (m.meta.invited ? [m.meta.invited] : []),
    myTeam, ready: {host: !!m.teamHost, guest: !!m.teamGuest},
    // Teams are only revealed once both players are ready.
    teams: bothReady ? {host: m.teamHost, guest: m.teamGuest} : null,
    rounds: bothReady ? m.rounds.rounds : [],
    roundStarted: m.rounds.at || m.meta.created,
    duty: m.battle && !m.winner ? duty(m.battle, side) : null,
    chosen: {me: mineIn, them: theirsIn},
    winner: m.winner, how: m.how,
  };
}


/** Handles one request from a logged-in player. Returns [HTTP status, body]. */
export async function handleMatch(store: Store, me: Player, body: any, newId: () => string, uuid: () => string): Promise<[number, unknown]> {
  const out = (b: unknown, status = 200): [number, unknown] => [status, b];
  try {
    if (body.action === 'create') {
      const o = {...DEFAULT_OPTIONS, ...(body.options ?? {})};
      o.clauses = {...DEFAULT_OPTIONS.clauses, ...(body.options?.clauses ?? {})};
      o.items = Math.max(0, Math.min(6, Math.floor(Number(o.items) || 0)));
      if (o.tms !== null) o.tms = Math.max(0, Math.min(24, Math.floor(Number(o.tms) || 0)));
      if (![30, 50, 70, 100, 'random'].includes(o.level)) o.level = 50;
      if (![0, 30, 60].includes(o.timer)) o.timer = 60;
      const invitedName = typeof body.invite === 'string' ? body.invite.trim().slice(0, 10).toLowerCase() : '';
      if (invitedName) {
        // They already challenged me (we both tapped Battle at once): join their match instead of making a second one.
        const mine = (await store.read<Invite[]>(invitePath(me.name), [])).filter(x => Date.now() - x.at < INVITE_MS && x.from.name.toLowerCase() === invitedName);
        for (const x of mine) {
          const meta = await store.read<Meta | null>(`matches/${x.id}/meta.json`, null);
          if (meta && !meta.guest && !meta.declined && !meta.cancelled) return out({id: x.id, merged: true});
        }
        // My older open challenges to the same friend are replaced by this one (no pile of lobbies).
        const list: {id: string; opp: string; role: Side; at: number}[] = await store.read(`${me.id}/matches.json`, []);
        for (const e of list.filter(e => e.role === 'host' && !e.opp && Date.now() - e.at < INVITE_MS).slice(0, 15)) {
          const meta = await store.read<Meta | null>(`matches/${e.id}/meta.json`, null);
          if (meta && !meta.guest && !meta.cancelled && meta.invited?.toLowerCase() === invitedName) await cancelMatch(store, meta);
        }
      }
      const id = newId();
      const meta: Meta = {id, seed: `${id}-${uuid()}`, options: o, host: me, guest: null, created: Date.now()};
      const invited = typeof body.invite === 'string' ? body.invite.trim().slice(0, 10) : '';
      if (invited && invited.toLowerCase() !== me.name.toLowerCase()) {
        meta.invited = invited;
        const list: Invite[] = (await store.read<Invite[]>(invitePath(invited), [])).filter(x => Date.now() - x.at < INVITE_MS && x.from.id !== me.id);
        await store.write(invitePath(invited), [{id, from: me, at: meta.created}, ...list].slice(0, 10));
      }
      await store.write(`matches/${id}/meta.json`, meta);
      await remember(store, me.id, {id, opp: '', role: 'host', at: meta.created});
      return out({id});
    }

    // Pop-up challenges for me from friends (polled while the site is open).
    if (body.action === 'invites') {
      const list = (await store.read<Invite[]>(invitePath(me.name), [])).filter(x => Date.now() - x.at < INVITE_MS);
      const open: Invite[] = [];
      for (const x of list) {
        const meta = await store.read<Meta | null>(`matches/${x.id}/meta.json`, null);
        if (meta && !meta.guest && !meta.cancelled) open.push(x); // declining removes it from your own list
      }
      return out({invites: open});
    }
    if (body.action === 'decline') {
      const id = String(body.id ?? '').toUpperCase();
      const list = await store.read<Invite[]>(invitePath(me.name), []);
      await store.write(invitePath(me.name), list.filter(x => x.id !== id));
      const meta = await store.read<Meta | null>(`matches/${id}/meta.json`, null);
      if (meta && !meta.guest && meta.invited?.toLowerCase() === me.name.toLowerCase()) await store.write(`matches/${id}/meta.json`, {...meta, declined: true});
      return out({ok: true});
    }

    if (body.action === 'list') {
      const list: {id: string; opp: string; role: Side; at: number}[] = await store.read(`${me.id}/matches.json`, []);
      const matches = [];
      // With `opp` (a username): only matches against that friend (for the head-to-head record).
      const opp = typeof body.opp === 'string' ? body.opp.toLowerCase() : '';
      const pick = opp ? list.filter(e => e.opp.toLowerCase() === opp).slice(0, 60) : list.slice(0, 20);
      for (const e of pick) {
        const m = await load(store, e.id);
        if (!m) continue;
        const side: Side = m.meta.host.id === me.id ? 'host' : 'guest';
        const opp = side === 'host' ? m.meta.guest : m.meta.host;
        const other: Side = side === 'host' ? 'guest' : 'host';
        matches.push({id: e.id, side, opp, at: e.at, stage: stageOf(m), oppOnline: Date.now() - m.seen[other] < 30_000,
          won: m.winner ? m.winner === side : null, how: m.how,
          left: m.battle ? {me: aliveOn(m.battle, side), opp: aliveOn(m.battle, side === 'host' ? 'guest' : 'host')} : null});
      }
      return out({matches});
    }

    const id = String(body.id ?? '').toUpperCase();
    let m = await load(store, id);
    if (!m) return out({error: 'That match was not found.'}, 404);

    if (body.action === 'join' && m.meta.cancelled && m.meta.host.id !== me.id && m.meta.guest?.id !== me.id) {
      return out({error: `${m.meta.host.name} cancelled this match.`}, 410);
    }
    if (body.action === 'join') {
      if (m.meta.host.id !== me.id && !m.meta.guest && !m.meta.cancelled) {
        m.meta.guest = me;
        m.meta.declined = false;
        const inv = await store.read<Invite[]>(invitePath(me.name), []);
        if (inv.some(x => x.id === id)) await store.write(invitePath(me.name), inv.filter(x => x.id !== id));
        await store.write(`${m.dir}/meta.json`, m.meta);
        await remember(store, me.id, {id, opp: m.meta.host.name, role: 'guest', at: Date.now()});
        await remember(store, m.meta.host.id, {id, opp: me.name, role: 'host', at: m.meta.created});
        m = (await load(store, id))!;
      }
    }

    const side: Side | null = m.meta.host.id === me.id ? 'host' : m.meta.guest?.id === me.id ? 'guest' : null;
    if (!side) return out({error: m.meta.guest ? 'This match already has two players.' : 'Open the match link to join.'}, 403);

    switch (body.action) {
      case 'join':
      case 'state':
        // "I'm on the match screen" (before the battle): marks the player as here, and opens team picking
        // once both have been in the battle room at the same time.
        // (During the battle too, so a friend who left can be offered "rejoin" only while I'm still playing.)
        if (body.here && !m.winner) {
          const now = Date.now();
          if (now - m.seen[side] > 4000) { await store.write(`${m.dir}/seen-${side}.json`, {at: now}); m.seen[side] = now; }
          if (await maybeStart(store, m)) m.started = true;
        }
        // If both choices arrived at the same moment, neither request played the round: do it now.
        if (m.battle && !m.winner && await tryResolve(store, m)) m = (await load(store, id))!;
        return out(await view(store, m, side));

      case 'roomReady': {
        // "I'm ready" in the battle room. Picking opens once both are ready and both still here.
        if (!inRoom(m)) return out(await view(store, m, side));
        await store.write(`${m.dir}/room-ready-${side}.json`, {at: Date.now()});
        m.roomReady[side] = true;
        const now = Date.now();
        await store.write(`${m.dir}/seen-${side}.json`, {at: now});
        m.seen[side] = now;
        if (await maybeStart(store, m)) m.started = true;
        return out(await view(store, m, side));
      }

      case 'setTeam': {
        if (!m.meta.guest) return out({error: 'Waiting for your friend to join.'}, 400);
        if (inRoom(m)) return out({error: 'Wait for your friend in the battle room first.'}, 400);
        if ((side === 'host' ? m.teamHost : m.teamGuest)) return out({error: 'Your team is already locked in.'}, 400);
        const team = body.team;
        const o = m.meta.options;
        // Levels are fixed by the options (or random per POKéMON, from the match seed): the same list the picker shows.
        const err = teamError(team, o, levelsFor(o, m.meta.seed, side));
        if (err) return out({error: err}, 400);
        if (isRandomFor(o.randomTeams, side)) {
          const want = randomTeam(o, m.meta.seed, side).mons.map((x: any) => x.species).join();
          if (team.mons.map((x: any) => x.species).join() !== want) return out({error: 'Random teams are on: keep the team you were given.'}, 400);
        }
        await store.write(`${m.dir}/team-${side}.json`, {mons: team.mons, bag: team.bag ?? {}});
        if (side === 'host' ? m.teamGuest : m.teamHost) await store.write(`${m.dir}/rounds.json`, {rounds: [], auto: [], at: Date.now()});
        return out(await view(store, (await load(store, id))!, side));
      }

      case 'act': {
        if (!m.battle || m.winner) return out({error: 'The battle is not running.'}, 400);
        const n = m.rounds.rounds.length;
        if (Number(body.round) !== n) return out(await view(store, m, side)); // out of date: send the latest
        const d = duty(m.battle, side);
        if (d === 'wait') return out({error: 'Waiting for your friend.'}, 400);
        const err = m.battle.validateFor(engineSide(side) as never, body.choice);
        if (err) return out({error: err}, 400);
        await store.write(`${m.dir}/turn-${n}-${side}.json`, {action: body.choice});
        await tryResolve(store, m);
        return out(await view(store, (await load(store, id))!, side));
      }

      case 'timeout': {
        // The waiting player asks: has my friend run out of time? Then the server picks for them.
        if (!m.battle || m.winner || !m.meta.options.timer) return out(await view(store, m, side));
        const other: Side = side === 'host' ? 'guest' : 'host';
        const n = m.rounds.rounds.length;
        const started = m.rounds.at || m.meta.created;
        // The first turn also covers loading and the intro animations: 45 s extra.
        const late = Date.now() - started > (m.meta.options.timer + (n === 0 ? FIRST_TURN_EXTRA : 0) + 5) * 1000;
        const theirs = await store.read<any>(`${m.dir}/turn-${n}-${other}.json`, null);
        if (late && !theirs && duty(m.battle, other) !== 'wait') {
          await store.write(`${m.dir}/turn-${n}-${other}.json`, {action: autoAction(m.battle, other), auto: true});
          await tryResolve(store, m);
        }
        return out(await view(store, (await load(store, id))!, side));
      }

      case 'invite': {
        // From the waiting screen: challenge a friend to this open match (pop-up + notification for them).
        const name = typeof body.invite === 'string' ? body.invite.trim().slice(0, 10) : '';
        if (side !== 'host' || m.meta.guest || m.meta.cancelled || !name || name.toLowerCase() === me.name.toLowerCase()) return out({error: 'Can’t invite to this match.'}, 400);
        const list: Invite[] = (await store.read<Invite[]>(invitePath(name), [])).filter(x => Date.now() - x.at < INVITE_MS && x.id !== id);
        await store.write(invitePath(name), [{id, from: me, at: Date.now()}, ...list].slice(0, 10));
        const invited = [...new Set([...(m.meta.invitedAll ?? (m.meta.invited ? [m.meta.invited] : [])), name])];
        await store.write(`${m.dir}/meta.json`, {...m.meta, invited: m.meta.invited ?? name, invitedAll: invited});
        return out({ok: true, invited});
      }

      case 'cancel':
        // Delete a lobby / unfinished match. Once the battle has started it counts as a forfeit instead.
        if (m.winner) return out(await view(store, m, side));
        if (m.battle) { await store.write(`${m.dir}/forfeit-${side}.json`, {at: Date.now()}); return out(await view(store, (await load(store, id))!, side)); }
        await cancelMatch(store, m.meta);
        return out({ok: true, cancelled: true});

      case 'forfeit':
        if (!m.winner) await store.write(`${m.dir}/forfeit-${side}.json`, {at: Date.now()});
        return out(await view(store, (await load(store, id))!, side));
    }
  } catch (e) {
    return out({error: 'Something went wrong. Try again.', detail: String(e)}, 500);
  }
  return out({error: 'Unknown action.'}, 400);
}
