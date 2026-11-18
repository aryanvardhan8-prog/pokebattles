// Friend-battle screens (web pages in the menu's look): match options → waiting for your friend (link + QR)
// → team picker (Pokémon, moves & TMs, items) → ready → VS reveal → battle (canvas) → results.

import type {Home} from '../home';
import {SPECIES, MOVES} from '../engine/data';
import {
  DEFAULT_OPTIONS, LEVEL_CHOICES, PVP_ITEMS, TMS, levelsFor, randomTeam, isRandomFor, startingMoves, levelUpMovesAt,
  canLearnTm, needsTm, tmFor, isBanned, tmUses, teamError, type MatchOptions, type PickedMon, type PickedTeam, type Who,
} from '../engine/pvp';
import {Battle} from '../engine/battle';
import {aniUrl} from '../ui/ani';
import {TYPE_COLORS, powerLabel} from '../ui/teamViews';
import {drawItemIcon} from '../ui/itemIcons';
import {ITEM_INFO} from '../ui/teamViews';
import {flag} from '../countries';
import {qrSvg} from '../invite';
import {createMatch, cancelMatch, inviteToMatch, joinMatch, matchState, setTeam, roomReady, forfeit, matchLink, whoAmI, type MatchView} from './api';
import {setupFor} from './pvpBattle';
import {trainerUrl} from '../trainers';
import {moveDesc} from '../ui/moveDesc';
import {getFriends} from '../profile';
import {fetchBadges} from '../leaderboard';
import {equippedHtml} from '../badges';

// Equipped badges by lowercase username, filled in once fetched (lobby and VS screens show them).
let badgeMap: Record<string, string[]> = {};
const loadBadges = () => { void fetchBadges(true).then(m => { badgeMap = m; }); };
const badgesOf = (name: string) => equippedHtml(badgeMap[name.toLowerCase()], 26);
import {listLoadouts, saveLoadout, removeLoadout} from '../loadouts';

const esc = (s: string) => String(s).replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
const BASE = import.meta.env.BASE_URL;
const typeBadge = (t: string) => `<img class="tbadge" src="${BASE}types/${t}.png" alt="${t}" title="${t}" loading="lazy">`;
const nameOf = (sp: string) => SPECIES[sp]?.name ?? sp;
const LEVEL_TEXT: Record<string, string> = {30: 'Lv 30', 50: 'Lv 50', 70: 'Lv 70', 100: 'Lv 100', random: 'Random levels'};
const WHO_TEXT: Record<Who, string> = {off: 'Off', both: 'Both', host: 'Only me', guest: 'Only my friend'};

const itemIconUrl = (() => {
  const cache = new Map<string, string>();
  return (item: string) => {
    if (!cache.has(item)) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      drawItemIcon(c.getContext('2d')!, item, 0, 0, 64);
      cache.set(item, c.toDataURL());
    }
    return cache.get(item)!;
  };
})();

/** "Misty is here / left" line shown while picking teams. */
function presenceHtml(name: string, here: boolean) {
  return `<p class="opp-presence ${here ? 'here' : ''}" id="opp-presence"><i></i>${here ? `${esc(name)} is here, picking too` : `${esc(name)} left the match. They can come back from their Friends page (or the pop-up).`}</p>`;
}

/** The waiting screen's friend list: Invite / Invited for each friend. */
function friendsHtml(invited: string[]) {
  const list = getFriends();
  if (!list.length) return '<li class="board-empty small">No friends yet. Add some on the Friends page, or send the link below.</li>';
  const done = new Set(invited.map(n => n.toLowerCase()));
  return list.map(f => `<li class="friend lobby-friend">
    <div class="friend-who"><span class="friend-name">${esc(f.username)}${f.country ? `<span class="flag">${flag(f.country)}</span>` : ''}</span></div>
    <div class="chips">${done.has(f.username.toLowerCase())
      ? '<span class="chip chip-won">Invited ✓</span>'
      : `<button class="chip chip-battle" data-invite="${esc(f.username)}">Invite</button>`}</div><span></span></li>`).join('');
}

/** Summary chips of the match rules. */
function ruleChips(o: MatchOptions) {
  const names: Record<string, string> = {sleep: 'Sleep', freeze: 'Freeze', ohko: 'OHKO', evasion: 'Evasion', trap: 'Trapping', species: 'Species', gen1: 'Gen 1 moves only'};
  const rules = Object.entries(o.clauses).filter(([, on]) => on).map(([k]) => names[k] ?? k);
  return `<div class="pvp-chips">
    <span>${LEVEL_TEXT[String(o.level)]}</span>
    ${o.randomTeams !== 'off' ? `<span>Random teams: ${WHO_TEXT[o.randomTeams]}</span>` : ''}
    ${o.randomLevels !== 'off' ? `<span>Random levels: ${WHO_TEXT[o.randomLevels]}</span>` : ''}
    <span>${o.items} ${o.items === 1 ? 'item' : 'items'}</span>
    <span>${o.tms === null ? 'Unlimited TMs' : `${o.tms} TMs`}</span>
    <span>${o.timer ? `${o.timer}s turns` : 'No turn timer'}</span>
    ${rules.length ? `<span>Clauses: ${rules.join(', ')}</span>` : ''}
  </div>`;
}

export class PvpScreens {
  private poll = 0;
  /** Set by main: starts the battle screen for a match. */
  onBattle: (v: MatchView) => void = () => {};

  constructor(private home: Home) {}

  private presence = 0;
  private stopPresence() {
    clearInterval(this.presence);
    this.presence = 0;
  }
  private stopPoll() {
    clearInterval(this.poll);
    this.poll = 0;
  }
  private page(body: string, backLabel = 'Menu', onBack?: () => void) {
    this.stopPoll();
    return this.home.showPvpPage(body, backLabel, onBack ? () => { this.stopPoll(); this.stopPresence(); onBack(); } : () => { this.stopPoll(); this.stopPresence(); this.home.onMenu(); });
  }

  // ---------- 1. match options ----------

  showSetup(friend = '', base: MatchOptions = DEFAULT_OPTIONS) {
    const o = structuredClone(base);
    const seg = (name: string, values: (string | number)[], cur: string | number, label: (v: string | number) => string) =>
      `<div class="seg wrap" data-opt="${name}">${values.map(v => `<button type="button" data-v="${v}" aria-pressed="${String(v) === String(cur)}">${label(v)}</button>`).join('')}</div>`;
    const root = this.page(`
      <section class="board-head">
        <p class="eyebrow eyebrow-dark">Friend battle</p>
        <h1 class="page-title">${friend ? `Challenge ${esc(friend)}` : 'Battle a friend'}</h1>
        <p class="mode-desc">Choose the rules, then send the link (or let your friend scan the code). You both pick your teams at the same time.</p>
      </section>
      <section class="mode board pvp-form">
        <div class="opt"><h3>Level</h3>${seg('level', [...LEVEL_CHOICES, 'random'], o.level, v => (v === 'random' ? 'Random' : `Lv ${v}`))}
          <p class="fine">Random gives each Pokémon its own level from 30 to 100.</p></div>
        <div class="opt"><h3>Random teams</h3>${seg('randomTeams', ['off', 'both', 'host', 'guest'], o.randomTeams, v => WHO_TEXT[v as Who])}</div>
        <div class="opt"><h3>Random levels</h3>${seg('randomLevels', ['off', 'both', 'host', 'guest'], o.randomLevels, v => WHO_TEXT[v as Who])}</div>
        <div class="opt"><h3>Items per player</h3>${seg('items', [0, 1, 2, 3, 4, 5, 6], o.items, v => String(v))}</div>
        <div class="opt"><h3>TMs per team</h3>${seg('tms', ['null', 0, 2, 4, 6, 10], o.tms === null ? 'null' : o.tms, v => (v === 'null' ? 'Unlimited' : String(v)))}
          <p class="fine">HMs are always free. Moves a Pokémon learns by its level are free too.</p></div>
        <div class="opt"><h3>Turn timer</h3>${seg('timer', [30, 60, 0], o.timer, v => (v === 0 || v === '0' ? 'Off' : `${v}s`))}</div>
        <div class="opt"><h3>Clauses</h3><div class="toggles">
          ${([['sleep', 'Sleep'], ['freeze', 'Freeze'], ['ohko', 'OHKO moves banned'], ['evasion', 'Evasion moves banned'], ['trap', 'Wrap / Bind / Fire Spin / Clamp banned'], ['species', 'No duplicates in a team'], ['gen1', 'Gen 1 moves only (no moves from later games)']] as const)
            .map(([k, label]) => `<label class="tog"><input type="checkbox" data-clause="${k}" ${o.clauses[k] ? 'checked' : ''}><span>${label}</span></label>`).join('')}
        </div></div>
        <p class="board-msg" id="pvp-err" hidden></p>
        <button class="btn-dark big" id="pvp-create">Create match</button>
      </section>`);
    root.querySelectorAll<HTMLElement>('[data-opt]').forEach(g => {
      g.querySelectorAll<HTMLButtonElement>('button').forEach(b => {
        b.onclick = () => {
          g.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
          const k = g.dataset.opt!, v = b.dataset.v!;
          (o as any)[k] = k === 'tms' ? (v === 'null' ? null : Number(v)) : k === 'level' ? (v === 'random' ? 'random' : Number(v))
            : k === 'items' || k === 'timer' ? Number(v) : v;
        };
      });
    });
    root.querySelectorAll<HTMLInputElement>('[data-clause]').forEach(c => {
      c.onchange = () => { (o.clauses as any)[c.dataset.clause!] = c.checked; };
    });
    const btn = root.querySelector<HTMLButtonElement>('#pvp-create')!;
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Creating…';
      try {
        const {id, merged} = await createMatch(o, friend);
        // They had just challenged me: go straight into their match.
        if (merged) return void this.open(id);
        void this.showLobby(id, friend);
      } catch (e) {
        const err = root.querySelector<HTMLElement>('#pvp-err')!;
        err.textContent = (e as Error).message;
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Create match';
      }
    };
  }

  // ---------- 2. waiting for the friend to join ----------

  async showLobby(id: string, friend = '') {
    const v = await matchState(id);
    if (v.stage !== 'lobby') return this.route(v);
    const link = matchLink(id);
    const root = this.page(`
      <section class="board-head">
        <p class="eyebrow eyebrow-dark">Match ${esc(id)}</p>
        <h1 class="page-title">Waiting for ${friend ? esc(friend) : 'your friend'}…</h1>
        ${ruleChips(v.options)}
      </section>
      <section class="mode board">
        <h3 class="board-sub">Challenge a friend</h3>
        <ol class="friend-list" id="lobby-friends">${friendsHtml(v.invited ?? [])}</ol>
      </section>
      <section class="mode board invite">
        <div class="invite-main">
          <h3 class="board-sub">Or send the link</h3>
          <p class="mode-desc">${friend ? `If ${esc(friend)} is on DailyBattles right now, they get a pop-up to accept. Not online? Send them the link (or let them scan the code).` : 'Your friend opens this link (or scans the code), logs in, and you both start picking teams.'}</p>
          <div class="invite-row"><input id="invite-link" readonly value="${esc(link)}" aria-label="Match link"></div>
          <div class="invite-btns"><button class="btn-dark" id="lobby-share">Share link</button><button class="btn-light" id="lobby-cancel">Cancel match</button></div>
          <p class="res-note" id="lobby-note" role="status"></p>
          <p class="pvp-live"><i></i> This page updates by itself when they join.</p>
        </div>
        <figure class="invite-qr">${qrSvg(link, 190)}<figcaption><b>Friend next to you?</b> They scan this with their phone camera.</figcaption></figure>
      </section>`);
    const note = root.querySelector<HTMLElement>('#lobby-note')!;
    this.bindCancel(root.querySelector<HTMLButtonElement>('#lobby-cancel')!, id);
    // Invite friends from the list (pop-up if they're online, phone notification if they turned them on).
    const bindFriends = () => root.querySelectorAll<HTMLButtonElement>('[data-invite]').forEach(b => {
      b.onclick = async () => {
        b.disabled = true;
        b.textContent = 'Inviting…';
        try {
          const {invited} = await inviteToMatch(id, b.dataset.invite!);
          const ol = root.querySelector<HTMLElement>('#lobby-friends');
          if (ol) { ol.innerHTML = friendsHtml(invited); bindFriends(); }
        } catch (e) {
          b.disabled = false;
          b.textContent = 'Invite';
          note.textContent = (e as Error).message;
        }
      };
    });
    bindFriends();
    root.querySelector<HTMLButtonElement>('#lobby-share')!.onclick = async () => {
      const text = `${whoAmI()?.name ?? 'A friend'} challenged you to a Pokémon battle on DailyBattles! Accept here: ${link}`;
      try {
        if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({text}); note.textContent = 'Shared!'; return; }
        await navigator.clipboard.writeText(link);
        note.textContent = 'Link copied! Send it to your friend.';
      } catch { note.textContent = 'Select the link and copy it.'; }
    };
    this.poll = window.setInterval(async () => {
      try {
        const s = await matchState(id, true);
        if (s.stage !== 'lobby') { this.stopPoll(); this.route(s); }
        else if (s.declined) note.textContent = `${friend || 'Your friend'} said not now. You can still send the link.`;
      } catch { /* try again */ }
    }, 2000);
  }

  /** "Cancel match": tap twice (so it can't happen by accident), then it's gone for both players. */
  private bindCancel(btn: HTMLButtonElement, id: string) {
    const label = btn.textContent!;
    btn.onclick = async () => {
      if (btn.dataset.confirm !== '1') {
        btn.dataset.confirm = '1';
        btn.textContent = 'Tap again to cancel';
        setTimeout(() => { if (btn.isConnected) { btn.dataset.confirm = ''; btn.textContent = label; } }, 3000);
        return;
      }
      btn.disabled = true;
      this.stopPoll();
      try { await cancelMatch(id); } catch { /* already gone */ }
      this.home.showFriends('Match cancelled.');
    };
  }

  /** Opens a match from a link (joins it if there's a free seat). */
  async open(id: string) {
    try {
      this.route(await joinMatch(id));
    } catch (e) {
      this.page(`<section class="mode board"><p class="board-msg">${esc((e as Error).message)}</p></section>`);
    }
  }

  /** Sends a player to the right screen for where the match is. */
  route(v: MatchView) {
    this.stopPresence();
    if (v.stage === 'lobby') return void this.showLobby(v.id);
    if (v.stage === 'room') return this.showRoom(v);
    if (v.stage === 'cancelled') {
      const root = this.page(`<section class="mode board"><h1 class="page-title">Match cancelled</h1><p class="mode-desc">This match was cancelled. Start a new one from your Friends page.</p><button class="btn-dark big" id="mc-friends">Friends</button></section>`);
      root.querySelector<HTMLButtonElement>('#mc-friends')!.onclick = () => this.home.showFriends();
      return;
    }
    if (v.stage === 'picking') return v.myTeam ? this.showReady(v) : this.showPicker(v);
    if (v.stage === 'battle') return this.showVs(v);
    return this.showResult(v);
  }

  // ---------- 2b. battle room: both players must be here before picking starts ----------

  showRoom(v: MatchView) {
    loadBadges();
    const opp = (v.side === 'host' ? v.guest : v.host)!;
    const oppSide = v.side === 'host' ? 'guest' : 'host';
    let sending = false;
    const card = (p: NonNullable<MatchView['host']>, here: boolean, ready: boolean, you: boolean) => `
      <div class="room-p ${here ? 'here' : ''} ${ready ? 'ready' : ''}">
        <img src="${trainerUrl(p.trainer)}" alt="">
        <b>${esc(p.name)}${p.country ? ' ' + flag(p.country) : ''}${you ? ' <em>you</em>' : ''}</b>
        ${badgesOf(p.name)}
        <span class="room-st"><i></i>${!here ? 'Not in the lobby' : ready ? 'Ready!' : 'In the lobby'}</span>
      </div>`;
    const draw = (s: MatchView) => {
      const on = s.online ?? {host: false, guest: false};
      const rr = s.roomReady ?? {host: false, guest: false};
      const here = {host: s.side === 'host' || on.host, guest: s.side === 'guest' || on.guest};
      const meReady = rr[s.side], themHere = here[oppSide], themReady = rr[oppSide] && themHere;
      const title = !themHere ? `Waiting for ${esc(opp.name)} to join…` : meReady && themReady ? 'Both ready!' : meReady ? `Waiting for ${esc(opp.name)} to get ready…` : themReady ? `${esc(opp.name)} is ready. Are you?` : 'You’re both here!';
      return `<div id="room-wrap">
        <section class="board-head">
          <p class="eyebrow eyebrow-dark">Battle lobby · Match ${esc(s.id)}</p>
          <h1 class="page-title">${title}</h1>
          ${ruleChips(s.options)}
        </section>
        <section class="mode board room">
          <div class="room-row">${card(s.host, here.host, rr.host && here.host, s.side === 'host')}<div class="vs-badge">VS</div>${card(s.guest!, here.guest, rr.guest && here.guest, s.side === 'guest')}</div>
          <div class="room-go">${meReady
            ? `<button class="btn-light big" disabled>You’re ready ✓</button>`
            : `<button class="btn-dark big" id="room-ready">I’m ready</button>`}</div>
          <p class="room-cancel"><button class="link" id="room-cancel">Cancel this match</button></p>
          <p class="mode-desc room-note">Team picking starts when you’re <b>both in the lobby</b> and <b>both tap I’m ready</b>.${themHere ? '' : ` If ${esc(opp.name)} left by accident, they get a pop-up to come back.`}</p>
          <p class="pvp-live"><i></i> Updates by itself</p>
        </section></div>`;
    };
    const bind = () => {
      const c = document.getElementById('room-cancel') as HTMLButtonElement | null;
      if (c) this.bindCancel(c, v.id);
      const b = document.getElementById('room-ready') as HTMLButtonElement | null;
      if (b) b.onclick = async () => {
        if (sending) return;
        sending = true; b.disabled = true; b.textContent = 'Ready…';
        try { update(await roomReady(v.id)); } catch { b.disabled = false; b.textContent = 'I’m ready'; }
        sending = false;
      };
    };
    const countdown = (s: MatchView) => {
      this.stopPoll();
      const wrap = document.getElementById('room-wrap');
      if (!wrap) return this.route(s);
      wrap.querySelector('.room-go')!.innerHTML = '<div class="room-count" id="room-count">3</div>';
      wrap.querySelector('.room-note')!.textContent = 'Battle starting! Get ready to pick your team.';
      wrap.querySelector('.page-title')!.textContent = 'Both ready!';
      wrap.querySelectorAll('.room-p').forEach(c => { c.classList.add('here', 'ready'); c.querySelector('.room-st')!.innerHTML = '<i></i>Ready!'; });
      let n = 3;
      const t = window.setInterval(() => {
        n--;
        const el = document.getElementById('room-count');
        if (!el) return clearInterval(t);
        if (n > 0) { el.textContent = String(n); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); return; }
        clearInterval(t);
        this.route(s);
      }, 800);
    };
    const update = (s: MatchView) => {
      if (s.stage !== 'room') return countdown(s);
      const wrap = document.getElementById('room-wrap');
      if (!wrap) return;
      wrap.outerHTML = draw(s);
      bind();
    };
    this.page(draw(v), 'Leave');
    bind();
    this.poll = window.setInterval(async () => {
      if (!document.getElementById('room-wrap')) return this.stopPoll();
      try { update(await matchState(v.id, true)); } catch { /* try again */ }
    }, 1500);
  }

  // ---------- 3. team picker ----------

  /** `solo`: the daily Easy battle (build a team to face Red) — locking in calls `solo.onLock` instead of the server. */
  showPicker(v: MatchView, solo?: {onLock: (team: PickedTeam) => void; note: string; title?: string; lockLabel?: string; initial?: PickedTeam; hideSaved?: boolean; back?: () => void; recommend?: Record<string, number>}) {
    const o = v.options;
    const levels = levelsFor(o, v.seed, v.side);
    const randomMine = isRandomFor(o.randomTeams, v.side);
    const opp = (v.side === 'host' ? v.guest : v.host)!;
    const slots: (PickedMon | null)[] = randomMine ? randomTeam(o, v.seed, v.side).mons : Array(6).fill(null);
    const bag: Record<string, number> = {};
    let step: 1 | 2 | 3 = randomMine ? 2 : 1;
    let search = '', typeFilter = '', tmType = 'learnable';
    // A move waiting to be taught: from the TM shelf (any Pokémon that can learn it) or a Pokémon's dropdown (just that one).
    let pendingTm: string | null = null;
    let pendingMon: number | null = null;

    const team = (): PickedTeam => ({mons: slots.filter((m): m is PickedMon => !!m), bag: {...bag}});
    const tmsLeft = () => (o.tms === null ? Infinity : o.tms - tmUses(team()));
    const itemsLeft = () => o.items - Object.values(bag).reduce((a, b) => a + b, 0);
    const setSlot = (i: number, sp: string | null) => {
      slots[i] = sp ? {species: sp, level: levels[i], moves: startingMoves(sp, levels[i], o.clauses)} : null;
    };

    // Moving a Pokémon to another slot keeps its moves (TMs too); only moves it can't know at the new level go.
    const moveTo = (m: PickedMon, i: number): PickedMon => {
      const level = levels[i];
      if (level === m.level) return m;
      const moves = m.moves.filter(x => !needsTm(m.species, level, x) || canLearnTm(m.species, x));
      return {species: m.species, level, moves: moves.length ? moves : startingMoves(m.species, level, o.clauses)};
    };

    const slotHtml = () => slots.map((m, i) => `
      <div class="slot ${m ? 'full' : ''}" data-slot="${i}">
        <span class="slot-lv">${i === 0 ? 'Lead · ' : ''}Lv ${levels[i]}</span>
        ${m ? `<img src="${aniUrl(m.species)}" alt=""><b>${esc(nameOf(m.species))}</b>
          ${randomMine ? '' : `<div class="slot-tools">
            <button data-move="${i}" data-dir="-1" aria-label="Move left" ${i === 0 ? 'disabled' : ''}>‹</button>
            <button data-remove="${i}" aria-label="Remove">✕</button>
            <button data-move="${i}" data-dir="1" aria-label="Move right" ${i === 5 ? 'disabled' : ''}>›</button></div>`}`
        : `<span class="slot-empty">Empty</span>`}
      </div>`).join('');

    const gridHtml = () => {
      const q = search.trim().toUpperCase();
      return Object.entries(SPECIES)
        .filter(([, s]) => (!q || s.name.includes(q)) && (!typeFilter || s.types.includes(typeFilter)))
        .map(([id, s]) => {
          const picked = slots.some(m => m?.species === id);
          const b = s.base;
          return `<button class="mon-card ${picked ? 'picked' : ''}" data-add="${id}" title="HP ${b.hp} · ATK ${b.atk} · DEF ${b.def} · SPC ${b.spc} · SPE ${b.spe}">
            <span class="num">#${String(s.num).padStart(3, '0')}</span>
            <img src="${aniUrl(id)}" alt="" loading="lazy">
            <b>${esc(s.name)}</b>
            <span class="types">${s.types.map(typeBadge).join('')}</span>
            <span class="bst">${b.hp + b.atk + b.def + b.spc + b.spe} total</span>
          </button>`;
        }).join('');
    };

    const moveRow = (m: PickedMon, i: number, k: number) => {
      const id = m.moves[k];
      const mv = id ? MOVES[id] : null;
      const tm = id && needsTm(m.species, m.level, id) ? tmFor(id) : null;
      const teachable = pendingTm && (pendingMon === null ? canLearnTm(m.species, pendingTm) : pendingMon === i) && !m.moves.includes(pendingTm);
      return `<button class="move-row ${teachable ? 'target' : ''}" data-mon="${i}" data-k="${k}">
        ${mv ? `<span class="tdot" style="background:${TYPE_COLORS[mv.type] ?? '#999'}"></span><b>${esc(mv.name)}</b>
          <span class="mv-info" role="button" tabindex="0" aria-label="What ${esc(mv.name)} does" data-tip="${esc(moveDesc(id))}">i</span>
          <span class="mv-meta">${tm ? `<em>${tm.label}</em>` : ''}${powerLabel(id)} · ${mv.acc ?? '—'}%</span>
          ${tm ? `<span class="tm-x" role="button" tabindex="0" data-untm="${i}:${k}" aria-label="Remove ${esc(mv.name)}" title="Remove this TM">✕</span>` : ''}`
        : `<span class="mv-empty">${teachable ? 'Tap to teach here' : '— empty —'}</span>`}
      </button>`;
    };

    const movesHtml = () => {
      const mons = slots.map((m, i) => [m, i] as const).filter(([m]) => m) as [PickedMon, number][];
      const usable = new Set(TMS.filter(t => !isBanned(t.id, o.clauses) && mons.some(([m]) => canLearnTm(m.species, t.id))).map(t => t.id));
      const tmTypes = [...new Set(TMS.map(t => MOVES[t.id].type))].sort();
      const shelf = TMS.filter(t => !tmType || (tmType === 'learnable' ? usable.has(t.id) : MOVES[t.id].type === tmType)).map(t => {
        const ok = usable.has(t.id);
        return `<button class="tm ${ok ? 'ok' : 'no'} ${pendingTm === t.id ? 'on' : ''} ${t.hm ? 'hm' : ''}" data-tm="${t.id}" ${ok ? '' : 'disabled'} title="${esc(MOVES[t.id].name)}: ${esc(moveDesc(t.id))}${ok ? '' : ' (none of your team can learn this)'}">
          <span>${t.label}</span><b>${esc(MOVES[t.id].name)}</b>
          <small class="tm-stats">Pwr ${powerLabel(t.id)} · Acc ${MOVES[t.id].acc ? `${MOVES[t.id].acc}%` : '—'}</small>
          <i style="background:${TYPE_COLORS[MOVES[t.id].type] ?? '#999'}"></i></button>`;
      }).join('');
      return `
        <div class="tm-bar">
          <h3 class="board-sub">TMs &amp; HMs</h3>
          <span class="tm-count">${o.tms === null ? 'Unlimited TMs' : `TMs left: <b>${Math.max(0, tmsLeft())}</b> of ${o.tms}`} · HMs free</span>
        </div>
        <div class="tm-filter"><select id="tm-type" aria-label="Show TMs of one type">
          <option value="">All types</option><option value="learnable" ${tmType === 'learnable' ? 'selected' : ''}>Learnable by my team</option>
          ${tmTypes.map(t => `<option ${t === tmType ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <p class="fine">${pendingTm && pendingMon === null ? `Teaching <b>${esc(MOVES[pendingTm].name)}</b>: tap a move to replace on a Pokémon that can learn it (highlighted). <button class="link" id="tm-cancel">Cancel</button>` : 'Bright TMs can be learned by at least one of your Pokémon. Tap one, then tap the move it replaces.'}</p>
        <div class="tm-shelf">${shelf || '<p class="fine">No TMs of that type.</p>'}</div>
        <div class="mon-moves">${mons.map(([m, i]) => {
          const extra = levelUpMovesAt(m.species, m.level).filter(x => !m.moves.includes(x) && !isBanned(x, o.clauses));
          const tmOpts = TMS.filter(t => canLearnTm(m.species, t.id) && !m.moves.includes(t.id) && !isBanned(t.id, o.clauses) && needsTm(m.species, m.level, t.id));
          const opt = (x: string, label = '') => `<option value="${x}">${label}${esc(MOVES[x].name)} · ${powerLabel(x)}</option>`;
          const canTeach = pendingTm && (pendingMon === null ? canLearnTm(m.species, pendingTm) : pendingMon === i) && !m.moves.includes(pendingTm);
          return `<div class="mm ${pendingTm ? (canTeach ? 'can' : 'cant') : ''}">
            <div class="mm-head"><img src="${aniUrl(m.species)}" alt=""><div><b>${esc(nameOf(m.species))}</b><span class="mm-lv">Lv ${m.level} ${SPECIES[m.species].types.map(typeBadge).join('')}</span></div>
              <button class="link" data-reset="${i}">Reset</button></div>
            ${pendingTm && pendingMon === i ? `<p class="mm-ask">Which move should <b>${esc(MOVES[pendingTm].name)}</b> replace? Tap it. <button class="link" id="tm-cancel-${i}">Cancel</button></p>` : ''}
            <div class="mm-moves">${[0, 1, 2, 3].map(k => moveRow(m, i, k)).join('')}</div>
            ${extra.length || tmOpts.length ? `<label class="relearn">Swap in a level-up move or TM:
              <select data-relearn="${i}"><option value="">${pendingTm && pendingMon === i ? esc(MOVES[pendingTm].name) : 'Choose…'}</option>
                ${extra.length ? `<optgroup label="Level-up moves">${extra.map(x => opt(x)).join('')}</optgroup>` : ''}
                ${tmOpts.length ? `<optgroup label="TMs${o.tms === null ? '' : ` (${Math.max(0, tmsLeft())} left)`}">${tmOpts.map(t => opt(t.id, `${t.label} `)).join('')}</optgroup>` : ''}
              </select></label>` : ''}
          </div>`;
        }).join('')}</div>`;
    };

    const itemsHtml = () => o.items === 0
      ? '<p class="friends-soon">No items in this match.</p>'
      : `<div class="tm-bar"><h3 class="board-sub">Items</h3><span class="tm-count">${o.items >= 99 ? 'Unlimited' : `Left: <b>${itemsLeft()}</b> of ${o.items}`}</span></div>${solo?.recommend ? `
        <div class="rec-items"><button class="btn-light small" id="rec-items">★ Recommended</button>
          <span>${Object.entries(solo.recommend).map(([it, n]) => `${n} ${esc(it)}`).join(' · ')}</span></div>` : ''}
        <div class="item-grid">${PVP_ITEMS.map(it => `
          <div class="it ${bag[it] ? 'on' : ''}">
            <img src="${itemIconUrl(it)}" alt="">
            <div><b>${esc(it)}</b><span>${esc(ITEM_INFO[it] ?? '')}</span></div>
            <div class="it-ctl"><button data-item="${esc(it)}" data-d="-1" ${bag[it] ? '' : 'disabled'} aria-label="One less">−</button><b>${bag[it] ?? 0}</b>
              <button data-item="${esc(it)}" data-d="1" ${itemsLeft() > 0 ? '' : 'disabled'} aria-label="One more">+</button></div>
          </div>`).join('')}</div>`;

    // Saved teams: load one in a tap, or save the current six (with moves and items).
    let loadNote = '';
    const savedHtml = (full: boolean) => {
      const list = listLoadouts();
      return `<div class="saved">
        <div class="saved-head"><b>Saved teams</b>
          <button class="btn-light small" id="save-team" ${full ? '' : 'disabled'} title="${full ? 'Save these 6 with their moves and items' : 'Pick 6 Pokémon first'}">Save this team</button></div>
        ${list.length ? `<div class="saved-list">${list.map(l => `
          <div class="saved-item"><button class="saved-load" data-load="${l.id}" title="Load ${esc(l.name)}">
            <span class="saved-name">${esc(l.name)}</span>
            <span class="saved-mons">${l.team.mons.map(m => `<img src="${aniUrl(m.species)}" alt="" loading="lazy">`).join('')}</span></button>
            <button class="saved-x" data-unsave="${l.id}" aria-label="Delete ${esc(l.name)}" title="Delete">✕</button></div>`).join('')}</div>`
          : '<p class="fine">Save a team you like (with its moves and items) to use it again in one tap.</p>'}
        ${loadNote ? `<p class="fine saved-note">${loadNote}</p>` : ''}
      </div>`;
    };
    // Fits a saved team to this match: its levels, the clauses, and the item limit.
    const loadTeam = (t: PickedTeam) => {
      const notes: string[] = [];
      t.mons.slice(0, 6).forEach((m, i) => {
        const level = levels[i];
        let moves = m.moves.filter(x => !isBanned(x, o.clauses) && (levelUpMovesAt(m.species, level).includes(x) || canLearnTm(m.species, x)));
        if (moves.length < m.moves.length) notes.push(`${nameOf(m.species)} lost a move it can't use here`);
        if (!moves.length) moves = startingMoves(m.species, level, o.clauses);
        slots[i] = {species: m.species, level, moves};
      });
      for (const k of Object.keys(bag)) delete bag[k];
      let room = o.items;
      for (const [it, n] of Object.entries(t.bag ?? {})) {
        if (!PVP_ITEMS.includes(it) || room <= 0) continue;
        const take = Math.min(n, room);
        bag[it] = take;
        room -= take;
      }
      if (Object.values(t.bag ?? {}).reduce((a, b) => a + b, 0) > o.items) notes.push(`items cut to this match's limit (${o.items})`);
      if (o.tms !== null && tmUses(team()) > o.tms) notes.push(`it uses ${tmUses(team())} TMs but this match allows ${o.tms}: tap ✕ on some TMs in step 2`);
      loadNote = notes.length ? `Loaded. Note: ${notes.join('; ')}.` : 'Loaded!';
    };

    const types = [...new Set(Object.values(SPECIES).flatMap(s => s.types))].sort();
    let firstRender = true;
    let oppHere = !!v.online?.[v.side === 'host' ? 'guest' : 'host'];
    const render = () => {
      // Re-drawing the page must not jump back to the top (only the first time, and when changing step).
      const home = document.getElementById('home')!;
      const keep = firstRender ? null : {page: home.scrollTop, grid: document.getElementById('mon-grid')?.scrollTop ?? 0, shelf: document.querySelector('#home .tm-shelf')?.scrollTop ?? 0, step};
      firstRender = false;
      const full = slots.every(Boolean);
      const root = this.page(`
        <section class="board-head">
          ${solo ? `<p class="eyebrow eyebrow-dark">${solo.title ?? 'Easy · Vs Red'}</p>
          <h1 class="page-title">Build your team</h1>
          <p class="mode-desc">${solo.note}</p>` : `<p class="eyebrow eyebrow-dark">Vs ${esc(opp.name)}${opp.country ? ' ' + flag(opp.country) : ''} · picking at the same time</p>
          <h1 class="page-title">Pick your team</h1>
          ${ruleChips(o)}
          ${presenceHtml(opp.name, oppHere)}`}
        </section>
        <div class="steps">
          ${[['1', `Pokémon ${slots.filter(Boolean).length}/6`], ['2', 'Moves & TMs'], ['3', 'Items']].map(([n, l]) =>
            `<button class="step ${String(step) === n ? 'on' : ''}" data-step="${n}" ${n !== '1' && !full ? 'disabled' : ''}><span>${n}</span>${l}</button>`).join('')}
        </div>
        <section class="mode board team-row-card">
          <div class="team-row">${slotHtml()}</div>
          ${randomMine ? '<p class="fine">Random teams are on for you: this is your team. You can still choose moves, TMs and items.</p>' : solo?.hideSaved ? '' : savedHtml(full)}
        </section>
        ${step === 1 ? `
          <section class="mode board">
            <div class="grid-tools">
              <input id="mon-search" placeholder="Search Pokémon" value="${esc(search)}" autocomplete="off">
              <select id="mon-type"><option value="">All types</option>${types.map(t => `<option ${t === typeFilter ? 'selected' : ''}>${t}</option>`).join('')}</select>
              <button class="btn-light" id="mon-random">Randomise</button>
            </div>
            <div class="mon-grid" id="mon-grid">${gridHtml()}</div>
          </section>` : step === 2 ? `<section class="mode board">${movesHtml()}</section>` : `<section class="mode board">${itemsHtml()}</section>`}
        <p class="board-msg" id="pick-err" hidden></p>
        <div class="pick-actions">
          ${step < 3 ? `<button class="btn-dark big" id="pick-next" ${full ? '' : 'disabled'}>${step === 1 ? 'Next: moves & TMs' : 'Next: items'}</button>` : ''}
          <button class="${step === 3 ? 'btn-dark' : 'btn-light'} big" id="pick-done" ${full ? '' : 'disabled'}>${solo ? solo.lockLabel ?? 'Lock in &amp; battle Red' : 'Lock in team'}</button>
        </div>`, solo?.back ? 'Back' : 'Leave', solo?.back ?? (() => this.home.onMenu()));
      bind(root);
      if (keep) {
        const sameStep = keep.step === step;
        home.scrollTop = sameStep ? keep.page : home.querySelector<HTMLElement>('.steps')!.offsetTop - 12;
        if (sameStep) {
          const g = document.getElementById('mon-grid'); if (g) g.scrollTop = keep.grid;
          const sh = document.querySelector('#home .tm-shelf'); if (sh) sh.scrollTop = keep.shelf;
        }
      }
    };

    const bind = (root: HTMLElement) => {
      const err = root.querySelector<HTMLElement>('#pick-err')!;
      const show = (msg: string) => { err.textContent = msg; err.hidden = false; err.scrollIntoView({block: 'nearest'}); };
      root.querySelectorAll<HTMLButtonElement>('[data-step]').forEach(b => { b.onclick = () => { step = Number(b.dataset.step) as 1 | 2 | 3; pendingTm = null; pendingMon = null; render(); }; });
      root.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach(b => { b.onclick = () => { setSlot(Number(b.dataset.remove), null); render(); }; });
      root.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(b => {
        b.onclick = () => {
          const i = Number(b.dataset.move), j = i + Number(b.dataset.dir);
          const a = slots[i], c = slots[j];
          slots[i] = c ? moveTo(c, i) : null;
          slots[j] = a ? moveTo(a, j) : null;
          render();
        };
      });
      const grid = root.querySelector<HTMLElement>('#mon-grid');
      const bindGrid = () => grid?.querySelectorAll<HTMLButtonElement>('[data-add]').forEach(b => {
        b.onclick = () => {
          const sp = b.dataset.add!;
          const at = slots.findIndex(m => m?.species === sp);
          if (at >= 0) { setSlot(at, null); render(); return; }
          const free = slots.findIndex(m => !m);
          if (free < 0) return show('Your team is full. Remove one first (✕).');
          setSlot(free, sp);
          if (startingMoves(sp, levels[free], o.clauses)[0] === 'struggle') { setSlot(free, null); return show(`${nameOf(sp)} has no usable moves at this level.`); }
          render();
        };
      });
      bindGrid();
      const s = root.querySelector<HTMLInputElement>('#mon-search');
      if (s) s.oninput = () => { search = s.value; grid!.innerHTML = gridHtml(); bindGrid(); };
      const t = root.querySelector<HTMLSelectElement>('#mon-type');
      if (t) t.onchange = () => { typeFilter = t.value; grid!.innerHTML = gridHtml(); bindGrid(); };
      const rnd = root.querySelector<HTMLButtonElement>('#mon-random');
      if (rnd) rnd.onclick = () => {
        const r = randomTeam(o, `${v.seed}:${Date.now()}`, v.side);
        r.mons.forEach((m, i) => setSlot(i, m.species));
        render();
      };
      // Moves & TMs
      const tt = root.querySelector<HTMLSelectElement>('#tm-type');
      if (tt) tt.onchange = () => { tmType = tt.value; render(); };
      root.querySelectorAll<HTMLButtonElement>('[data-tm]').forEach(b => {
        b.onclick = () => {
          const id = b.dataset.tm!;
          pendingMon = null;
          if (pendingTm === id) { pendingTm = null; return render(); }
          if (!tmFor(id)!.hm && tmsLeft() <= 0) return show('No TMs left. Remove a TM move first (tap it and teach a level-up move, or Reset).');
          pendingTm = id;
          render();
        };
      });
      root.querySelectorAll<HTMLButtonElement>('#tm-cancel, [id^="tm-cancel-"]').forEach(c => c.addEventListener('click', () => { pendingTm = null; pendingMon = null; render(); }));
      root.querySelectorAll<HTMLButtonElement>('.move-row').forEach(b => {
        b.onclick = () => {
          if (!pendingTm) return;
          const m = slots[Number(b.dataset.mon)]!;
          if (pendingMon !== null && pendingMon !== Number(b.dataset.mon)) return show(`Pick one of ${nameOf(slots[pendingMon]!.species)}'s moves to replace.`);
          if (!canLearnTm(m.species, pendingTm) && needsTm(m.species, m.level, pendingTm)) return show(`${nameOf(m.species)} can't learn ${MOVES[pendingTm].name}.`);
          if (m.moves.includes(pendingTm)) return show(`${nameOf(m.species)} already knows ${MOVES[pendingTm].name}.`);
          const k = Number(b.dataset.k);
          const moves = [...m.moves];
          if (k < moves.length) moves[k] = pendingTm; else moves.push(pendingTm);
          m.moves = moves;
          if (o.tms !== null && tmUses(team()) > o.tms) { m.moves = m.moves.map(x => (x === pendingTm ? (startingMoves(m.species, m.level, o.clauses)[k] ?? x) : x)); return show('No TMs left.'); }
          pendingTm = null;
          pendingMon = null;
          render();
        };
      });
      // "i" next to a move: shows what it does (hover on a computer, tap on a phone).
      root.querySelectorAll<HTMLElement>('.mv-info').forEach(x => {
        x.onclick = e => {
          e.stopPropagation();
          const was = x.classList.contains('show');
          root.querySelectorAll('.mv-info.show').forEach(y => y.classList.remove('show'));
          if (!was) x.classList.add('show');
        };
      });
      // Saved teams
      root.querySelector<HTMLButtonElement>('#save-team')?.addEventListener('click', () => {
        const name = prompt('Name this team:', `Team ${listLoadouts().length + 1}`);
        if (name === null) return;
        saveLoadout(name, team());
        loadNote = `Saved “${esc(name.trim() || 'My team')}”.`;
        render();
      });
      root.querySelectorAll<HTMLButtonElement>('[data-load]').forEach(b => {
        b.onclick = () => { const l = listLoadouts().find(x => x.id === b.dataset.load); if (l) { loadTeam(l.team); render(); } };
      });
      root.querySelectorAll<HTMLButtonElement>('[data-unsave]').forEach(b => {
        b.onclick = () => {
          if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Delete?'; return; }
          removeLoadout(b.dataset.unsave!);
          loadNote = '';
          render();
        };
      });
      // ✕ on a taught TM: swap just that one back to a level-up move (frees the TM).
      root.querySelectorAll<HTMLElement>('[data-untm]').forEach(x => {
        x.onclick = e => {
          e.stopPropagation();
          const [i, k] = x.dataset.untm!.split(':').map(Number);
          const m = slots[i]!;
          const own = [...startingMoves(m.species, m.level, o.clauses), ...levelUpMovesAt(m.species, m.level)]
            .find(id => id !== 'struggle' && !m.moves.includes(id) && !isBanned(id, o.clauses));
          const moves = [...m.moves];
          if (own) moves[k] = own; else if (moves.length > 1) moves.splice(k, 1);
          m.moves = moves;
          pendingTm = null;
          pendingMon = null;
          render();
        };
      });
      root.querySelectorAll<HTMLButtonElement>('[data-reset]').forEach(b => {
        b.onclick = () => { const m = slots[Number(b.dataset.reset)]!; m.moves = startingMoves(m.species, m.level, o.clauses); render(); };
      });
      root.querySelectorAll<HTMLSelectElement>('[data-relearn]').forEach(sel => {
        sel.onchange = () => {
          if (!sel.value) return;
          const i = Number(sel.dataset.relearn), m = slots[i]!;
          if (m.moves.length < 4) { m.moves = [...m.moves, sel.value]; pendingTm = null; pendingMon = null; return render(); }
          // Then ask which move it replaces (the move rows light up).
          pendingTm = sel.value;
          pendingMon = i;
          render();
        };
      });
      // Items
      root.querySelector<HTMLButtonElement>('#rec-items')?.addEventListener('click', () => {
        for (const k of Object.keys(bag)) delete bag[k];
        Object.assign(bag, solo!.recommend);
        render();
      });
      root.querySelectorAll<HTMLButtonElement>('[data-item]').forEach(b => {
        b.onclick = () => {
          const it = b.dataset.item!, d = Number(b.dataset.d);
          const n = (bag[it] ?? 0) + d;
          if (d > 0 && itemsLeft() <= 0) return;
          if (n <= 0) delete bag[it]; else bag[it] = n;
          render();
        };
      });
      root.querySelector<HTMLButtonElement>('#pick-next')?.addEventListener('click', () => { step = (step + 1) as 2 | 3; pendingTm = null; pendingMon = null; render(); });
      root.querySelector<HTMLButtonElement>('#pick-done')?.addEventListener('click', async () => {
        const t2 = team();
        const problem = teamError(t2, o, levels);
        if (problem) return show(problem);
        const btn = root.querySelector<HTMLButtonElement>('#pick-done')!;
        btn.disabled = true;
        btn.textContent = 'Locking in…';
        if (solo) return solo.onLock(t2);
        try {
          this.route(await setTeam(v.id, t2));
        } catch (e) {
          show((e as Error).message);
          btn.disabled = false;
          btn.textContent = 'Lock in team';
        }
      });
    };
    if (solo?.initial) { loadTeam(solo.initial); loadNote = ''; } // editing a saved team
    render();
    if (solo) return;
    // Keeps me marked as here, and shows whether my friend is still picking or has left.
    this.stopPresence();
    this.presence = window.setInterval(async () => {
      if (!document.getElementById('opp-presence')) return this.stopPresence(); // left the picker some other way
      try {
        const s = await matchState(v.id, true);
        if (s.stage !== 'picking' && s.stage !== 'room') { this.stopPresence(); if (!slots.some(Boolean) || s.stage === 'done') this.route(s); return; }
        oppHere = !!s.online?.[v.side === 'host' ? 'guest' : 'host'];
        const el = document.getElementById('opp-presence');
        if (el) el.outerHTML = presenceHtml(opp.name, oppHere);
      } catch { /* try again */ }
    }, 3000);
  }

  // ---------- 4. ready: waiting for the other player ----------

  showReady(v: MatchView) {
    const opp = (v.side === 'host' ? v.guest : v.host)!;
    const mine = v.myTeam!;
    this.page(`
      <section class="pvp-ready mode board">
        <p class="eyebrow eyebrow-dark">You’re ready!</p>
        <h1 class="page-title">Waiting for ${esc(opp.name)}…</h1>
        <p class="mode-desc">${esc(opp.name)} is still picking. The battle starts as soon as they lock in their team.</p>
        ${presenceHtml(opp.name, !!v.online?.[v.side === 'host' ? 'guest' : 'host'])}
        <div class="mini-team">${mine.mons.map(m => `<div><img src="${aniUrl(m.species)}" alt=""><span>${esc(nameOf(m.species))} · Lv ${m.level}</span></div>`).join('')}</div>
        <p class="pvp-live"><i></i> Updates by itself</p>
      </section>`, 'Menu');
    this.poll = window.setInterval(async () => {
      try {
        const s = await matchState(v.id, true);
        if (s.stage !== 'picking') { this.stopPoll(); this.route(s); return; }
        const el = document.getElementById('opp-presence');
        if (el) el.outerHTML = presenceHtml(opp.name, !!s.online?.[v.side === 'host' ? 'guest' : 'host']);
      } catch { /* try again */ }
    }, 2000);
  }

  // ---------- 5. VS reveal ----------

  showVs(v: MatchView) {
    const t = v.teams!;
    // Your own team is shown; the friend's stays a mystery until each Pokémon is sent out.
    const side = (p: typeof v.host, team: PickedTeam, you: boolean) => `
      <div class="vs-side ${you ? 'you' : ''}">
        <img class="vs-trainer" src="${trainerUrl(p.trainer)}" alt="">
        <h3>${esc(p.name)}${p.country ? ' ' + flag(p.country) : ''}${you ? ' <em>you</em>' : ''}</h3>
        ${badgesOf(p.name)}
        <div class="vs-mons">${team.mons.map(m => you
          ? `<div><img src="${aniUrl(m.species)}" alt=""><span>${esc(nameOf(m.species))}</span><small>Lv ${m.level}</small></div>`
          : `<div class="mystery"><i class="ball">?</i><span>???</span><small>Lv ${m.level}</small></div>`).join('')}</div>
      </div>`;
    const root = this.page(`
      <section class="vs-card">
        ${side(v.host, t.host, v.side === 'host')}
        <div class="vs-badge">VS</div>
        ${side(v.guest!, t.guest, v.side === 'guest')}
      </section>
      <button class="btn-dark big vs-go" id="vs-go">${v.rounds.length ? 'Rejoin battle' : 'Battle!'}</button>`, 'Menu');
    const go = () => { this.stopPoll(); this.onBattle(v); };
    root.querySelector<HTMLButtonElement>('#vs-go')!.onclick = go;
    if (!v.rounds.length) this.poll = window.setTimeout(go, 5000) as unknown as number;
  }

  // ---------- 6. results ----------

  showResult(v: MatchView) {
    const won = v.winner === v.side;
    const opp = (v.side === 'host' ? v.guest : v.host)!;
    let final: Battle | null = null;
    try { final = v.teams ? Battle.replayPvp(setupFor(v), v.rounds) : null; } catch { /* show without HP */ }
    const teamCards = (side: 'player' | 'red') => (final ? final.sides[side].team : []).map(m => {
      const p = m.hp === 0 ? 0 : Math.max(1, Math.round((m.hp / m.maxHp) * 100));
      return `<li class="mon mon-${p === 0 ? 'fainted' : p > 50 ? 'good' : p > 20 ? 'mid' : 'low'}">
        <div class="mon-pic"><img src="${aniUrl(m.species)}" alt="" loading="lazy"></div>
        <span class="mon-name">${esc(nameOf(m.species))}</span>
        <span class="mon-bar"><i style="width:${p}%"></i></span>
        <span class="mon-hp">${p === 0 ? 'Fainted' : `${p}% HP`}</span></li>`;
    }).join('');
    const mineSide = v.side === 'host' ? 'player' : 'red', theirSide = v.side === 'host' ? 'red' : 'player';
    const how = v.how === 'forfeit' ? (won ? `${opp.name} forfeited.` : 'You forfeited.') : v.how === 'timeout' ? (won ? `${opp.name} ran out of time.` : 'You ran out of time.') : '';
    const root = this.page(`
      <section class="result-hero ${won ? 'is-won' : 'is-lost'}">
        <p class="eyebrow">Friend battle · vs ${esc(opp.name)}${opp.country ? ' ' + flag(opp.country) : ''}</p>
        <h1>${won ? 'Victory' : 'Defeat'}</h1>
        <p class="result-sub">${how || (won ? `You beat ${esc(opp.name)}!` : `${esc(opp.name)} won this one.`)}</p>
        <div class="result-facts">
          <div><b>${final ? final.sides[mineSide].team.filter(m => m.hp > 0).length : '–'}<small>/6</small></b><span>Your Pokémon left</span></div>
          <div><b>${final ? final.turn : v.rounds.length}</b><span>Turns</span></div>
        </div>
      </section>
      ${final ? `<section class="mode result-team"><h3>Your team</h3><ul class="team-grid">${teamCards(mineSide)}</ul></section>
      <section class="mode result-team"><h3>${esc(opp.name)}’s team</h3><ul class="team-grid">${teamCards(theirSide)}</ul></section>` : ''}
      <section class="result-actions">
        <button class="btn-dark" id="pvp-rematch">Rematch</button>
        <button class="btn-light" id="pvp-new">New rules</button>
        <button class="btn-light" id="pvp-menu">Menu</button>
      </section>`);
    root.querySelector<HTMLButtonElement>('#pvp-rematch')!.onclick = async () => {
      const {id, merged} = await createMatch(v.options, opp.name);
      if (merged) return void this.open(id);
      void this.showLobby(id, opp.name);
    };
    root.querySelector<HTMLButtonElement>('#pvp-new')!.onclick = () => this.showSetup(opp.name, v.options);
    root.querySelector<HTMLButtonElement>('#pvp-menu')!.onclick = () => this.home.onMenu();
  }

  /** Forfeits a running match (from the battle screen). */
  async forfeit(id: string) {
    return forfeit(id);
  }
}
