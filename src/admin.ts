// The owner's private stats page (open the site with ?admin while logged in as AryanV).
// Data comes from the `admin` edge function, which refuses everyone else.

import type {Home} from './home';
import {SUPABASE_URL, SUPABASE_KEY} from './config';
import {accessToken, currentUser} from './account';
import {flag, countryName} from './countries';
import {TRAINERS} from './trainers';
import {SPECIES} from './engine/data';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
const DAY = 864e5;
const today = () => new Date().toISOString().slice(0, 10);
const dayOf = (t: number | string) => new Date(t).toISOString().slice(0, 10);
/** Your own calendar day (sign-ups are shown in your time zone). */
const localDay = (t: number | string) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const localDaysBack = (n: number) => Array.from({length: n}, (_, i) => localDay(Date.now() - (n - 1 - i) * DAY));
const daysBack = (n: number) => Array.from({length: n}, (_, i) => new Date(Date.now() - (n - 1 - i) * DAY).toISOString().slice(0, 10));
const shortDay = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, {day: 'numeric', month: 'short'});
const when = (t: number | string | null) => (t ? new Date(t).toLocaleString(undefined, {day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'}) : '–');
function dur(sec: number) {
  if (sec < 60) return `${sec}s`;
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

interface Data {
  now: number;
  accounts: {id: string; email: string; username: string; country: string; trainer: string; created: string; lastSignIn: string | null}[];
  activity: {key: string; username: string; guest: boolean; total: number; days: Record<string, number>; visits: number; first: number; last: number}[];
  results: {day: string; level: string; won: boolean; name: string; client_id: string; created_at: string}[];
  matches: {id: string; host: string; guest: string; created: number; declined: boolean; teams: number; rounds: number; forfeit: boolean; options?: any; picks?: string[]}[];
  friends: {pairs: number; withFriends: number};
  feedback?: {at: number; kind: string; message: string; contact: string; username: string; site: string; device: string}[];
  errors?: {day: string; message: string; stack: string; page: string; device: string; username: string; site: string; count: number; last_at: string}[];
  push?: {username: string; devices: number; prefs: {challenge?: boolean; daily?: boolean; streak?: boolean}}[];
}

export async function fetchAdmin(fresh = false): Promise<Data> {
  const token = await accessToken();
  if (!token) throw new Error('Log in as AryanV to see the stats.');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin${fresh ? '?fresh=1' : ''}`, {method: 'POST', headers: {apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`}});
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error === 'Not allowed.' ? 'This page is only for the owner of DailyBattles.' : body.error ?? 'Could not load the stats.');
  return body;
}

/** A small bar chart: one bar per day. */
function bars(days: string[], values: number[], label: (v: number) => string = String) {
  const max = Math.max(1, ...values);
  return `<div class="ad-bars">${days.map((d, i) => `
    <div class="ad-bar" title="${shortDay(d)}: ${label(values[i])}"><b>${values[i] ? label(values[i]) : ''}</b>
      <i style="height:${Math.round((values[i] / max) * 100)}%"></i><span>${shortDay(d).replace(' ', '<br>')}</span></div>`).join('')}</div>`;
}
const tile = (big: string | number, label: string, sub = '') => `<div class="ad-tile"><b>${big}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;

/** Errors players hit in the game (grouped per day), newest first. */
function errorsHtml(list: NonNullable<Data['errors']>) {
  const device = (ua: string) => /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Other';
  const total = list.reduce((n, e) => n + e.count, 0);
  return `<section class="mode board">
    <h3 class="board-sub">Errors <small>${list.length ? `${total} in the last ${new Set(list.map(e => e.day)).size} days` : 'none'}</small></h3>
    ${list.length ? `<div class="ad-fb">${list.map(e => `
      <article class="ad-fb-item bug">
        <header><span class="ad-kind">×${e.count}</span><b>${e.username ? esc(e.username) : 'Guest'}</b>
          <small>${when(Date.parse(e.last_at))} · ${device(e.device)} · ${esc(e.page)}${e.site.includes('dev') ? ' · test site' : ''}</small></header>
        <p><b>${esc(e.message)}</b></p>
        ${e.stack ? `<details><summary>Details</summary><pre style="white-space:pre-wrap;font-size:11px">${esc(e.stack)}</pre></details>` : ''}
      </article>`).join('')}</div>` : '<p class="board-empty small">No errors reported. When something breaks for a player, it shows up here automatically.</p>'}
  </section>`;
}

/** Feedback messages from the menu form, newest first. */
function feedbackHtml(list: NonNullable<Data['feedback']>) {
  const device = (ua: string) => /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Other';
  const counts = ['Idea', 'Bug', 'Other'].map(k => `${list.filter(f => f.kind === k).length} ${k === 'Bug' ? 'bug reports' : k === 'Idea' ? 'ideas' : 'other'}`).join(' · ');
  return `<section class="mode board">
    <h3 class="board-sub">Feedback <small>${list.length} ${list.length === 1 ? 'message' : 'messages'}${list.length ? ` · ${counts}` : ''}</small></h3>
    ${list.length ? `<div class="ad-fb">${list.map(f => `
      <article class="ad-fb-item ${f.kind === 'Bug' ? 'bug' : f.kind === 'Idea' ? 'idea' : ''}">
        <header><span class="ad-kind">${esc(f.kind === 'Bug' ? 'Bug report' : f.kind)}</span><b>${f.username ? esc(f.username) : 'Guest'}</b>
          <small>${when(f.at)} · ${device(f.device)}${f.site.includes('dev') ? ' · test site' : ''}</small></header>
        <p>${esc(f.message).replace(/\n/g, '<br>')}</p>
        ${f.contact ? `<p class="ad-contact">Reply to: <a href="mailto:${esc(f.contact)}">${esc(f.contact)}</a></p>` : ''}
      </article>`).join('')}</div>` : '<p class="board-empty small">No feedback yet. Messages from the form at the bottom of the menu show up here.</p>'}
  </section>`;
}

/** Which friend-battle rules people choose (all matches made; "fought" = matches that were actually battled). */
function rulesHtml(m: Data['matches']) {
  const withOpts = m.filter(x => x.options);
  if (!withOpts.length) return '';
  const fought = new Set(withOpts.filter(x => x.teams === 2 && x.rounds > 0).map(x => x.id));
  const WHO: Record<string, string> = {off: 'Off', both: 'Both players', host: 'Only the creator', guest: 'Only the friend'};
  const rows: [string, (o: any) => string][] = [
    ['Level', o => (o.level === 'random' ? 'Random (30–100)' : `Lv ${o.level}`)],
    ['Random teams', o => WHO[o.randomTeams] ?? String(o.randomTeams)],
    ['Random levels', o => WHO[o.randomLevels] ?? String(o.randomLevels)],
    ['Items per player', o => String(o.items)],
    ['TMs per team', o => (o.tms === null ? 'Unlimited' : String(o.tms))],
    ['Turn timer', o => (o.timer ? `${o.timer}s` : 'Off')],
  ];
  const clauseNames: Record<string, string> = {sleep: 'Sleep Clause', freeze: 'Freeze Clause', ohko: 'OHKO moves banned', evasion: 'Evasion moves banned', trap: 'Trapping moves banned', species: 'No duplicates in a team'};
  const block = (title: string, get: (o: any) => string) => {
    const counts = new Map<string, {n: number; f: number}>();
    for (const x of withOpts) {
      const k = get(x.options);
      const c = counts.get(k) ?? {n: 0, f: 0};
      c.n++; if (fought.has(x.id)) c.f++;
      counts.set(k, c);
    }
    const total = withOpts.length;
    return `<div class="ad-rule"><h4>${esc(title)}</h4>${[...counts].sort((a, b) => b[1].n - a[1].n).map(([k, c]) => `
      <div class="ad-opt"><span>${esc(k)}</span><i style="width:${Math.round((c.n / total) * 100)}%"></i><b>${Math.round((c.n / total) * 100)}%</b><small>${c.n} made · ${c.f} fought</small></div>`).join('')}</div>`;
  };
  const clauses = Object.keys(clauseNames).map(k => {
    const on = withOpts.filter(x => x.options.clauses?.[k]).length;
    return `<div class="ad-opt"><span>${clauseNames[k]}</span><i style="width:${Math.round((on / withOpts.length) * 100)}%"></i><b>${Math.round((on / withOpts.length) * 100)}%</b><small>on in ${on} of ${withOpts.length}</small></div>`;
  }).join('');
  // Most picked Pokémon in friend battles (both teams of every locked-in match).
  const pickCount = new Map<string, number>();
  for (const x of m) for (const sp of x.picks ?? []) pickCount.set(sp, (pickCount.get(sp) ?? 0) + 1);
  const topPicks = [...pickCount].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const defaults = withOpts.filter(x => x.options.level === 50 && x.options.items === 3 && x.options.tms === 4 && x.options.timer === 60 && x.options.randomTeams === 'off' && x.options.randomLevels === 'off').length;
  return `<section class="mode board">
    <h3 class="board-sub">Friend battle rules <small>${withOpts.length} matches · ${Math.round((defaults / withOpts.length) * 100)}% kept the default rules</small></h3>
    <div class="ad-rules">${rows.map(([t, g]) => block(t, g)).join('')}<div class="ad-rule"><h4>Clauses</h4>${clauses}</div></div>
    ${topPicks.length ? `<h3 class="board-sub">Most picked Pokémon</h3><ol class="ad-list ad-picks">${topPicks.map(([sp, c]) => `<li><b>${esc(SPECIES[sp]?.name ?? sp)}</b><span>${c}</span></li>`).join('')}</ol>` : ''}
    <p class="fine">“Made” counts every match created; “fought” only the ones that were actually battled.</p>
  </section>`;
}

export async function showAdmin(home: Home, data?: Data, fresh = false) {
  const page = (body: string) => home.showPvpPage(`<section class="board-head"><p class="eyebrow eyebrow-dark">Owner only</p><h1 class="page-title">DailyBattles stats</h1></section>${body}`, 'Menu');
  if (!data) {
    if (!currentUser()) { page('<section class="mode board"><p class="board-empty">Log in as AryanV (profile button, top right) to see the stats.</p></section>'); return; }
    page('<section class="mode board"><p class="board-empty">Loading stats…</p></section>');
    try { data = await fetchAdmin(fresh); } catch (e) { page(`<section class="mode board"><p class="board-empty">${esc((e as Error).message)}</p></section>`); return; }
  }
  const d = data, t = today(), last14 = daysBack(14);
  const weekAgo = Date.now() - 7 * DAY;

  // ---- accounts ----
  const accounts = [...d.accounts].sort((a, b) => +new Date(b.created) - +new Date(a.created));
  const newToday = accounts.filter(a => localDay(a.created) === localDay(Date.now())).length;
  const new7 = accounts.filter(a => +new Date(a.created) > weekAgo).length;
  const localLast14 = localDaysBack(14);
  const newPerDay = localLast14.map(day => accounts.filter(a => localDay(a.created) === day).length);

  // ---- time on site ----
  const act = [...d.activity].sort((a, b) => b.total - a.total);
  const totalTime = act.reduce((n, a) => n + a.total, 0);
  const todayTime = act.reduce((n, a) => n + (a.days[t] ?? 0), 0);
  const activeToday = act.filter(a => (a.days[t] ?? 0) > 0).length;
  const week = (a: Data['activity'][number]) => daysBack(7).reduce((n, day) => n + (a.days[day] ?? 0), 0);
  const timePerDay = last14.map(day => act.reduce((n, a) => n + (a.days[day] ?? 0), 0));
  const guests = act.filter(a => a.guest);

  // ---- daily game ----
  const r = d.results;
  const playersToday = new Set(r.filter(x => x.day === t).map(x => x.name.toLowerCase())).size;
  const playsPerDay = last14.map(day => r.filter(x => x.day === day).length);
  const levels = ['easy', 'medium', 'hard'].map(l => {
    const rows = r.filter(x => x.level === l), w = rows.filter(x => x.won).length;
    return {l, played: rows.length, rate: rows.length ? Math.round((w / rows.length) * 100) : 0};
  });
  const perName = new Map<string, number>();
  for (const x of r) perName.set(x.name, (perName.get(x.name) ?? 0) + 1);
  const topPlayers = [...perName].sort((a, b) => b[1] - a[1]).slice(0, 10);

  // ---- friend battles ----
  const m = d.matches;
  const fought = m.filter(x => x.teams === 2 && x.rounds > 0);
  const pvpPlayers = new Set(m.flatMap(x => [x.host, x.guest]).filter(Boolean));
  const rivalries = new Map<string, number>();
  for (const x of fought) { const k = [x.host, x.guest].sort().join(' vs '); rivalries.set(k, (rivalries.get(k) ?? 0) + 1); }
  const pvpPerDay = last14.map(day => fought.filter(x => dayOf(x.created) === day).length);

  // ---- trainers & countries ----
  const trainerCount = new Map<string, number>();
  for (const a of d.accounts) if (a.trainer) trainerCount.set(a.trainer, (trainerCount.get(a.trainer) ?? 0) + 1);
  const countries = new Map<string, number>();
  for (const a of d.accounts) if (a.country) countries.set(a.country, (countries.get(a.country) ?? 0) + 1);

  page(`
    <section class="ad-tiles">
      ${tile(accounts.length, 'accounts', `+${newToday} today · +${new7} this week`)}
      ${tile(activeToday, 'people on the site today', `${playersToday} played Red today`)}
      ${tile(dur(todayTime), 'time on site today', `${dur(totalTime)} in total`)}
      ${tile(r.length, 'daily battles played', `${r.filter(x => x.day === t).length} today`)}
      ${tile(fought.length, 'friend battles fought', `${pvpPlayers.size} players · ${m.length} matches made`)}
      ${tile(d.friends.pairs, 'friendships', `${d.friends.withFriends} players have friends`)}
      ${tile((d.push ?? []).length, 'notifications on', `${(d.push ?? []).reduce((n, p) => n + p.devices, 0)} devices`)}
    </section>

    <section class="mode board"><h3 class="board-sub">New accounts per day <small>your time zone · accounts started 14 Oct 2026</small></h3>${bars(localLast14, newPerDay)}</section>

    <section class="mode board">
      <h3 class="board-sub">Time on site, per player <small>most to least · counted since 14 Oct 2026, 20:25 UTC · days in UTC</small></h3>
      ${bars(last14, timePerDay, v => dur(v))}
      ${act.length ? `<table class="ad-table"><thead><tr><th>#</th><th>Player</th><th>Total</th><th>Last 7 days</th><th>Today</th><th>Visits</th><th>Last seen</th></tr></thead><tbody>
        ${act.slice(0, 100).map((a, i) => `<tr><td>${i + 1}</td><td>${a.guest ? `<span class="ad-guest">Guest</span> <small>${esc(a.key.slice(6, 12))}</small>` : `<b>${esc(a.username)}</b>`}</td>
          <td><b>${dur(a.total)}</b></td><td>${dur(week(a))}</td><td>${dur(a.days[t] ?? 0)}</td><td>${a.visits}</td><td>${when(a.last)}</td></tr>`).join('')}
      </tbody></table>
      <p class="fine">${act.length - guests.length} with accounts, ${guests.length} guests (each guest is one browser). A visit = coming back after 30+ minutes away. Idle tabs don’t count.</p>`
      : '<p class="board-empty small">No time recorded yet. It starts counting once this update is live.</p>'}
    </section>

    <section class="mode board">
      <h3 class="board-sub">Newest accounts</h3>
      <table class="ad-table"><thead><tr><th>Player</th><th>Joined</th><th>Last login</th><th>Trainer</th></tr></thead><tbody>
        ${accounts.slice(0, 30).map(a => `<tr><td><b>${esc(a.username)}</b> ${a.country ? flag(a.country) : ''}</td><td>${when(a.created)}</td><td>${when(a.lastSignIn)}</td><td>${esc(TRAINERS.find(x => x.id === a.trainer)?.name ?? '–')}</td></tr>`).join('')}
      </tbody></table>
    </section>

    <section class="mode board">
      <h3 class="board-sub">Daily game (vs Red) <small>game days (UTC); before accounts, players entered just a name</small></h3>
      ${bars(last14, playsPerDay)}
      <div class="ad-tiles small">${levels.map(x => tile(x.played, `${x.l} battles`, `${x.rate}% won`)).join('')}</div>
      <h3 class="board-sub">Most battles played</h3>
      <ol class="ad-list">${topPlayers.map(([n, c]) => `<li><b>${esc(n)}</b><span>${c}</span></li>`).join('')}</ol>
    </section>

    <section class="mode board">
      <h3 class="board-sub">Friend battles</h3>
      ${bars(last14, pvpPerDay)}
      <div class="ad-tiles small">
        ${tile(m.length, 'matches made')}${tile(m.filter(x => x.guest).length, 'a friend joined')}${tile(fought.length, 'battles fought')}
        ${tile(fought.reduce((n, x) => n + x.rounds, 0), 'turns played')}${tile(m.filter(x => x.declined).length, 'invites declined')}${tile(fought.filter(x => x.forfeit).length, 'ended by forfeit')}
      </div>
      <h3 class="board-sub">Biggest rivalries</h3>
      <ol class="ad-list">${[...rivalries].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, c]) => `<li><b>${esc(k)}</b><span>${c} ${c === 1 ? 'battle' : 'battles'}</span></li>`).join('') || '<li>None yet</li>'}</ol>
      <h3 class="board-sub">Latest matches</h3>
      <table class="ad-table"><thead><tr><th>When</th><th>Players</th><th>Status</th><th>Turns</th></tr></thead><tbody>
        ${[...m].sort((a, b) => b.created - a.created).slice(0, 25).map(x => `<tr><td>${when(x.created)}</td><td><b>${esc(x.host)}</b> vs ${x.guest ? `<b>${esc(x.guest)}</b>` : '<i>nobody joined</i>'}</td>
          <td>${x.declined ? 'Declined' : !x.guest ? 'Waiting' : x.teams < 2 ? 'Picking teams' : x.forfeit ? 'Forfeit' : x.rounds ? 'Battled' : 'Never started'}</td><td>${x.rounds || '–'}</td></tr>`).join('')}
      </tbody></table>
    </section>

    ${errorsHtml(d.errors ?? [])}

    ${feedbackHtml(d.feedback ?? [])}

    ${rulesHtml(m)}

    <section class="mode board">
      <h3 class="board-sub">Phone notifications <small>${(d.push ?? []).length} players</small></h3>
      ${(d.push ?? []).length ? `<table class="ad-table"><thead><tr><th>Player</th><th>Devices</th><th>Challenges</th><th>New island</th><th>Streak</th></tr></thead><tbody>
        ${(d.push ?? []).sort((a, b) => a.username.localeCompare(b.username)).map(p => `<tr><td><b>${esc(p.username || '?')}</b></td><td>${p.devices}</td>
          ${(['challenge', 'daily', 'streak'] as const).map(k => `<td>${p.prefs[k] === false ? '–' : '✓'}</td>`).join('')}</tr>`).join('')}
      </tbody></table>` : '<p class="board-empty small">Nobody has turned notifications on yet.</p>'}
      <p class="fine">Players turn them on in their profile panel. Daily island 00:05 UTC, streak reminder 14:30 UTC.</p>
    </section>

    <section class="mode board">
      <div class="tm-bar"><h3 class="board-sub">All accounts and emails <small>${accounts.length}</small></h3><button class="btn-light" id="ad-copy">Copy all emails</button></div>
      <table class="ad-table"><thead><tr><th>#</th><th>Player</th><th>Email</th><th>Joined</th></tr></thead><tbody>
        ${accounts.map((a, i) => `<tr><td>${i + 1}</td><td><b>${esc(a.username)}</b> ${a.country ? flag(a.country) : ''}</td><td class="ad-email">${esc(a.email)}</td><td>${when(a.created)}</td></tr>`).join('')}
      </tbody></table>
      <p class="fine">Private: only you can see this. Players didn’t sign up for a mailing list, so check privacy rules before emailing them about anything other than their account.</p>
    </section>

    <section class="mode board ad-two">
      <div><h3 class="board-sub">Trainer pictures chosen</h3><ol class="ad-list">${[...trainerCount].sort((a, b) => b[1] - a[1]).map(([k, c]) => `<li><b>${esc(TRAINERS.find(x => x.id === k)?.name ?? k)}</b><span>${c}</span></li>`).join('') || '<li>None yet</li>'}</ol></div>
      <div><h3 class="board-sub">Countries</h3><ol class="ad-list">${[...countries].sort((a, b) => b[1] - a[1]).map(([k, c]) => `<li><b>${flag(k)} ${esc(countryName(k))}</b><span>${c}</span></li>`).join('')}</ol></div>
    </section>
    <p class="fine ad-foot">Feedback messages are in Netlify → dailybattles → Forms. Updated ${when(d.now)}. <button class="link" id="ad-refresh">Refresh</button></p>`);
  document.getElementById('ad-refresh')?.addEventListener('click', () => void showAdmin(home));
  const copy = document.getElementById('ad-copy');
  copy?.addEventListener('click', async () => {
    const list = accounts.map(a => a.email).filter(Boolean).join(', ');
    try { await navigator.clipboard.writeText(list); copy.textContent = `Copied ${accounts.filter(a => a.email).length} emails`; }
    catch { copy.textContent = 'Couldn’t copy. Select them in the table instead.'; }
    setTimeout(() => { copy.textContent = 'Copy all emails'; }, 3000);
  });
  // How fresh the numbers are (the server rebuilds them every 5 minutes), with a Refresh for right-now numbers.
  const head = document.querySelector('#home .board-head');
  if (head) {
    const mins = Math.max(0, Math.round((Date.now() - d.now) / 60000));
    head.insertAdjacentHTML('beforeend', `<p class="fine">Updated ${mins < 1 ? 'just now' : `${mins} min ago`} · <button class="link" id="ad-refresh">Refresh now</button></p>`);
    document.getElementById('ad-refresh')!.onclick = () => void showAdmin(home, undefined, true);
  }
}
