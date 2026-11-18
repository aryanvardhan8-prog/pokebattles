// The home screen: a clean, modern menu (plain web page, no Game Boy frame).
// Fight Red (daily, with the 24-hour refresh clock and today's progress), coming-soon modes,
// and a profile panel with your stats and your account (needed for the leaderboard).

import {LEVELS, RED_TEAM, isV2, rulesFor, type Level} from './engine/daily';
import {type DayResult, type Stats, currentStreak, dayShareText} from './stats';
import {fetchBadges} from './leaderboard';
import {shareCard} from './shareCard';
import {BADGES, CAT_INFO, TIER_NAME, badgeHtml, equippedHtml, badgeStats, earned, type BadgeStats, type Cat} from './badges';
import {fetchTop, fetchAllTime, fetchEntry, fetchEliteEntry, fetchFlags, fetchHp, fetchTrainers, submittedFor, type Entry, type AllTimeEntry, type EntryDetail, type EliteEntry} from './leaderboard';
import {generateDay} from './engine/daily';
import {SPECIES, MOVES} from './engine/data';
import {aniUrl} from './ui/ani';
import {listLoadouts, removeLoadout} from './loadouts';
import {moveDesc} from './ui/moveDesc';
import {TYPE_COLORS, powerLabel} from './ui/teamViews';
import {currentUser, logIn, logOut, onSessionChange, signUp, setCountry, accessToken, changeUsername, setProfileData} from './account';
import {TRAINERS, trainerUrl, trainerFace, myTrainer, setMyTrainer} from './trainers';
import {pushSupport, pushStatus, enablePush, disablePush, setPushPrefs, type Prefs} from './push';
import {COUNTRIES, countryName, flag, guessCountry} from './countries';
import {getFriends, getRequests, getSent, onProfileChange, requestFriend, answerRequest, removeFriend, inviteLink, type Friend} from './profile';
import {qrSvg, shareInvite, downloadInviteCard} from './invite';
import {SUPABASE_URL, SUPABASE_KEY} from './config';
import {audio} from './audio';

export type LevelState = 'new' | 'playing' | 'won' | 'lost';

/** What the results page needs after a battle. */
export interface ResultsInfo {
  level: Level;
  dayNumber: number;
  date: string;
  dev: boolean;
  result: DayResult;
  stats: Stats;
  team: string[]; // species ids, in team order
  next: Level | null; // next difficulty not played yet today
}

export interface HomeInfo {
  dayNumber: number;
  date: string;
  dev: boolean;
  states: Record<Level, LevelState>;
  stats: Record<Level, Stats>;
}

const STATE_TEXT: Record<LevelState, string> = {new: 'Battle', playing: 'Continue', won: 'Victory', lost: 'Defeat'};
const LEVEL_TEXT: Record<Level, string> = {easy: 'Easy', medium: 'Medium', hard: 'Hard'};
const ELITE_NAMES = ['LORELEI', 'BRUNO', 'AGATHA', 'LANCE', 'BLUE'];
/** The small line under each difficulty button (Hard's level depends on the day's rules). */
const levelSub = (l: Level, date: string) => (l === 'easy' ? 'Build your team' : `Random · Lv ${rulesFor(date, l).playerLevel}`);

const esc = (s: string) => s.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
const pad = (n: number) => String(n).padStart(2, '0');
/** "Oct 14, 3:42 PM" in the viewer's own time zone. */
const when2 = (iso: string) => new Date(iso).toLocaleString(undefined, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
const todayUTCString = () => new Date().toISOString().slice(0, 10);
const dayNumberOf = (date: string) => generateDay(date).number;
/** How many days back the leaderboard goes (to Day #1). */
const daysSinceLaunch = (today: string) => dayNumberOf(today) - 1;

const ICONS = {
  person: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="4"/><path d="M4 20.5c1.2-4 4.4-6 8-6s6.8 2 8 6"/></svg>',
  crown: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/></svg>',
  friends: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8.5" cy="9" r="3.2"/><circle cx="16.5" cy="9.5" r="2.7"/><path d="M2.5 19.5c.8-3.3 3.2-5 6-5s5.2 1.7 6 5M14.5 14.6c.6-.2 1.3-.3 2-.3 2.4 0 4.3 1.5 5 4.6"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v5a5 5 0 01-10 0zM7 6H4v1.5A3.5 3.5 0 007.5 11M17 6h3v1.5A3.5 3.5 0 0116.5 11M12 14v4M8 20.5h8"/></svg>',
  sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.5 4.5 0 010 6M18 6.5a8 8 0 010 11"/></svg>',
  muted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
};

export interface EliteRecord { day: string; stage: number; won: boolean; turns: number; items: number | null }

export class Home {
  private root: HTMLElement;
  private sheet: HTMLElement;
  private timer: number | null = null;
  private info: HomeInfo | null = null;
  private accountWaiters: ((ok: boolean) => void)[] = [];
  private formMode: 'signup' | 'login' = 'signup';

  /** Set by main: back to the menu, and "put my result on the leaderboard" (account + submit). */
  onMenu: () => void = () => {};
  onSubmit: (level: Level) => Promise<string | null> = async () => null;
  /** Set by main: start a friend battle (optionally against a named friend), or open one of your matches. */
  onPlayFriend: (friend?: string) => void = () => {};
  /** Elite Four: start / continue today's run, and where it stands. */
  onElite: (mode?: 'easy' | 'hard') => void = () => {};
  /** Finished Elite Four runs saved on this device (for the profile stats). */
  eliteHistory: () => EliteRecord[] = () => [];
  eliteState: (mode?: 'easy' | 'hard') => {state: 'new'} | {state: 'playing'; cleared: number} | {state: 'done'; cleared: number; won: boolean} = () => ({state: 'new'});
  onOpenMatch: (id: string) => void = () => {};
  onCancelMatch: (id: string) => Promise<void> = async () => {};
  /** Friend challenges waiting for me, and turning one down. */
  listInvites: () => Promise<{id: string; from: {name: string; country: string}; at: number}[]> = async () => [];
  onDeclineInvite: (id: string) => Promise<void> = async () => {};
  onAdmin: () => void = () => {};
  listMatches: (opp?: string) => Promise<{id: string; side: 'host' | 'guest'; opp: {name: string; country: string} | null; at: number; stage: string; won: boolean | null; how?: string; left?: {me: number; opp: number} | null}[]> = async () => [];
  private date = '';

  constructor(private onPlay: (level: Level) => void) {
    this.root = document.createElement('div');
    this.root.id = 'home';
    // The chosen look: "Poké Ball Minimal" (style.css, data-look="c").
    const look = 'c';
    this.root.hidden = true;
    document.body.appendChild(this.root);
    this.sheet = document.createElement('div');
    this.sheet.id = 'profile';
    if (look) { this.root.dataset.look = look; this.sheet.dataset.look = look; }
    this.sheet.hidden = true;
    this.sheet.setAttribute('role', 'dialog');
    this.sheet.setAttribute('aria-modal', 'true');
    this.sheet.setAttribute('aria-label', 'Your profile');
    document.body.appendChild(this.sheet);
    onSessionChange(() => {
      if (this.info) this.render();
      if (!this.sheet.hidden) this.renderSheet();
    });
    audio.onMuteChange(() => { if (this.info) this.renderSoundButton(); });
    onProfileChange(() => { if (this.page === 'menu' && this.visible && this.info) this.render(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !this.sheet.hidden) this.closeSheet();
    });
  }

  /** Updates what the pages know about today (without showing the menu). */
  setInfo(info: HomeInfo) {
    this.info = info;
  }

  get visible() {
    return !this.root.hidden;
  }

  show(info: HomeInfo) {
    this.info = info;
    this.page = 'menu';
    document.body.classList.add('on-home');
    this.root.hidden = false;
    this.root.scrollTop = 0;
    this.render();
    if (this.timer === null) this.timer = window.setInterval(() => this.tickClock(), 1000);
  }

  hide() {
    document.body.classList.remove('on-home');
    this.root.hidden = true;
    this.closeSheet(false);
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Opens the profile panel on the account form. Resolves true once the player is logged in. */
  askForAccount(reason: string, guestLabel = ''): Promise<boolean> {
    if (currentUser()) return Promise.resolve(true);
    return new Promise(resolve => {
      this.accountWaiters.push(resolve);
      this.formMode = 'signup';
      this.openSheet(reason, guestLabel);
    });
  }

  /** Someone opened an invite link while logged out. */
  showInvite(name: string) {
    this.formMode = 'signup';
    this.openSheet(`${name} invited you to DailyBattles! Create a free account (or log in) and you’ll be friends, so you can compare results every day.`);
  }

  /** A short message at the bottom of the screen. */
  toast(msg: string) {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.setAttribute('role', 'status');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t!.classList.remove('show'), 3800);
  }
  private toastTimer = 0;

  /** New info about today (e.g. after logging in): redraws the menu if it's showing. */
  refreshMenu(info: HomeInfo) {
    this.info = info;
    if (this.page === 'menu' && this.visible) this.render();
  }

  // ---------- main menu ----------

  private page: 'menu' | 'results' | 'board' | 'friends' | 'friend' | 'pvp' = 'menu';

  private render() {
    if (this.page !== 'menu') return;
    const info = this.info!;
    const user = currentUser();
    const done = LEVELS.filter(l => info.states[l] === 'won' || info.states[l] === 'lost').length;
    const allDone = done === LEVELS.length;
    this.root.innerHTML = `
      <div class="home-wrap">
        <header class="home-top">
          <button class="brand brand-home" aria-label="Back to the main menu" title="Main menu"><span class="brand-poke">DAILY</span><span class="brand-battles">BATTLES</span></button>
          <div class="top-actions">
            <button class="icon-btn" id="home-sound" aria-label="Sound"></button>
            <button class="pill-btn" id="home-friends">${ICONS.friends}<span>Friends</span>${getFriends().length ? `<b>${getFriends().length}</b>` : ''}${getRequests().length ? `<i class="req-dot" title="Friend requests">${getRequests().length}</i>` : ''}</button>
            <button class="avatar" id="home-profile" aria-label="Your profile and stats">
              ${user ? `<span>${esc(user.username.slice(0, 1).toUpperCase())}</span>` : ICONS.person}
            </button>
          </div>
        </header>
        ${info.dev ? '<p class="dev-note">Test build: a new random team on every refresh. Nothing is saved. <a href="https://dailybattles.netlify.app/">Play the real game →</a></p>' : ''}
        ${!user && LEVELS.some(l => info.stats[l].played > 0) ? this.guestBanner(info) : ''}

        <section class="mode mode-red" aria-labelledby="red-title">
          <div class="red-main">
            <div class="red-head">
              <p class="eyebrow">Daily · Day #${info.dayNumber}</p>
              <span class="status ${allDone ? 'status-done' : ''}">
                ${allDone ? `${ICONS.check} Completed today` : `${done} of 3 done today`}
              </span>
            </div>
            <h2 id="red-title">Fight <em>Red</em></h2>
            ${this.descHtml()}
            <div class="levels">
              ${LEVELS.map(l => `
                <button class="level level-${info.states[l]}" data-level="${l}">
                  <span class="level-name">${LEVEL_TEXT[l]}</span>
                  ${isV2(info.date) ? `<span class="level-sub">${levelSub(l, info.date)}</span>` : ''}
                  <span class="level-state"><i></i>${STATE_TEXT[info.states[l]]}</span>
                </button>`).join('')}
            </div>
          </div>
          <div class="clock" aria-label="Time until the next island">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle class="clock-track" cx="60" cy="60" r="52"/>
              <circle class="clock-fill" cx="60" cy="60" r="52" pathLength="1000"/>
              ${Array.from({length: 24}, (_, i) => {
                const a = (i / 24) * Math.PI * 2 - Math.PI / 2, r1 = i % 6 === 0 ? 40 : 43;
                return `<line class="tick${i % 6 === 0 ? ' major' : ''}" x1="${60 + Math.cos(a) * r1}" y1="${60 + Math.sin(a) * r1}" x2="${60 + Math.cos(a) * 46}" y2="${60 + Math.sin(a) * 46}"/>`;
              }).join('')}
            </svg>
            <div class="clock-text">
              <span class="clock-time" id="clock-time">--:--</span>
              <span class="clock-sec" id="clock-sec">--</span>
              <span class="clock-label">until reset</span>
            </div>
          </div>
        </section>

        ${isV2(info.date) ? this.redTeamHtml() : ''}
        <div class="soon-grid">
          <button class="mode mode-soon mode-link" id="home-pvp">
            <div class="soon-icon">${ICONS.friends}</div>
            <div class="soon-body">
              <h3>Play a friend</h3>
              <p class="mode-desc">Pick any 6 of the 151, set the rules, and battle a friend live.</p>
            </div>
            <span class="soon-pill live-pill">Challenge a friend →</span>
          </button>
          ${this.eliteCard()}
          <button class="mode mode-soon mode-link" id="home-board">
            <div class="soon-icon">${ICONS.trophy}</div>
            <div class="soon-body">
              <h3>Leaderboard</h3>
              <p class="mode-desc">See how you and your friends rank today, and the best trainers worldwide.</p>
            </div>
            <span class="soon-pill live-pill">View rankings →</span>
          </button>
        </div>
        ${this.feedbackHtml()}
        <p class="home-foot">${user ? `Logged in as <b>${esc(user.username)}</b>.` : 'Playing as a guest. <button class="link" id="home-join">Create an account</button> to join the leaderboard.'}</p>
        <p class="legal-foot"><button class="link" id="how-to-play">How to play</button> · <a href="privacy.html">Privacy</a> · <a href="terms.html">Terms</a><br>
          Unofficial fan game, not affiliated with Nintendo, Game Freak, Creatures Inc. or The Pokémon Company. Pokémon © its owners.</p>
      </div>`;
    this.root.querySelectorAll<HTMLButtonElement>('.level').forEach(b => {
      b.onclick = () => { audio.unlock(); this.onPlay(b.dataset.level as Level); };
    });
    this.root.querySelector<HTMLButtonElement>('#home-profile')!.onclick = () => this.openSheet();
    this.root.querySelector<HTMLButtonElement>('#home-friends')!.onclick = () => this.showFriends();
    this.root.querySelector<HTMLButtonElement>('.brand-home')!.onclick = () => this.root.scrollTo({top: 0, behavior: 'smooth'});
    this.root.querySelector<HTMLButtonElement>('#home-pvp')!.onclick = () => this.onPlayFriend();
    this.root.querySelector<HTMLButtonElement>('#how-to-play')!.onclick = () => this.showTutorial();
    this.root.querySelectorAll<HTMLButtonElement>('[data-elite-mode]').forEach(b => { b.onclick = () => this.onElite(b.dataset.eliteMode as 'easy' | 'hard'); });
    this.bindSaveCard();
    this.root.querySelector<HTMLButtonElement>('#home-board')!.onclick = () => {
      void fetchFlags(true);
      const played = LEVELS.find(l => info.states[l] === 'won' || info.states[l] === 'lost');
      this.showBoard(played ?? 'easy', info.date);
    };
    const join = this.root.querySelector<HTMLButtonElement>('#home-join');
    if (join) join.onclick = () => { this.formMode = 'signup'; this.openSheet(); };
    this.renderSoundButton();
    this.tickClock();
    this.bindFeedback();
  }

  // ---------- feedback form (bottom of the menu; sent to Netlify Forms) ----------

  private fb = {kind: 'Idea', message: '', contact: '', sent: false};

  private feedbackHtml() {
    const f = this.fb;
    if (f.sent) return `<section class="mode feedback sent"><h3>Thanks for the feedback!</h3><p class="mode-desc">It goes straight to the person who makes DailyBattles. <button class="link" id="fb-again">Send more</button></p></section>`;
    return `<section class="mode feedback">
      <h3>Send feedback</h3>
      <p class="mode-desc">Found a bug, have an idea, or just want to say something? We read every message.</p>
      <form id="fb-form" name="feedback" method="POST" data-netlify="true" netlify-honeypot="bot-field">
        <div class="seg" role="radiogroup" aria-label="Type">${['Idea', 'Bug', 'Other'].map(k => `<button type="button" data-kind="${k}" aria-pressed="${f.kind === k}">${k === 'Bug' ? 'Bug report' : k}</button>`).join('')}</div>
        <textarea id="fb-msg" name="message" rows="4" maxlength="2000" placeholder="${f.kind === 'Bug' ? 'What happened? What were you doing just before?' : 'Tell us what you think…'}" required>${esc(f.message)}</textarea>
        <input id="fb-contact" name="contact" type="text" maxlength="120" placeholder="Email (optional, if you’d like a reply)" value="${esc(f.contact)}" autocomplete="email">
        <p class="hp" hidden><input name="bot-field" tabindex="-1" autocomplete="off"></p>
        <div class="fb-row"><span class="res-note" id="fb-note" role="status"></span><button class="btn-dark" type="submit" id="fb-send">Send</button></div>
      </form>
    </section>`;
  }

  private bindFeedback() {
    const again = this.root.querySelector<HTMLButtonElement>('#fb-again');
    if (again) again.onclick = () => { this.fb = {kind: 'Idea', message: '', contact: '', sent: false}; this.render(); };
    const form = this.root.querySelector<HTMLFormElement>('#fb-form');
    if (!form) return;
    const msg = form.querySelector<HTMLTextAreaElement>('#fb-msg')!, contact = form.querySelector<HTMLInputElement>('#fb-contact')!;
    // Keep what's typed if the menu re-draws (e.g. after logging in).
    msg.oninput = () => { this.fb.message = msg.value; };
    contact.oninput = () => { this.fb.contact = contact.value; };
    form.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(b => {
      b.onclick = () => {
        this.fb.kind = b.dataset.kind!;
        form.querySelectorAll('[data-kind]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        msg.placeholder = this.fb.kind === 'Bug' ? 'What happened? What were you doing just before?' : 'Tell us what you think…';
      };
    });
    form.onsubmit = async e => {
      e.preventDefault();
      const note = form.querySelector<HTMLElement>('#fb-note')!, btn = form.querySelector<HTMLButtonElement>('#fb-send')!;
      if (msg.value.trim().length < 3) { note.textContent = 'Write a few words first.'; return; }
      btn.disabled = true;
      btn.textContent = 'Sending…';
      const body = new URLSearchParams({
        'form-name': 'feedback', kind: this.fb.kind, message: msg.value.trim(), contact: contact.value.trim(),
        username: currentUser()?.username ?? 'guest', page: location.href, device: navigator.userAgent,
        'bot-field': (form.querySelector<HTMLInputElement>('[name="bot-field"]')!.value),
      });
      try {
        // Saved twice: on Supabase (listed on the owner's stats page) and Netlify Forms (email alerts).
        const token = await accessToken().catch(() => null);
        const toSupabase = fetch(`${SUPABASE_URL}/functions/v1/feedback`, {method: 'POST',
          headers: {apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
          body: JSON.stringify({kind: this.fb.kind, message: msg.value.trim(), contact: contact.value.trim(), site: location.host, device: navigator.userAgent})})
          .then(r => r.ok).catch(() => false);
        const toNetlify = fetch('/', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: body.toString()})
          .then(r => r.ok).catch(() => false);
        const [a, b] = await Promise.all([toSupabase, toNetlify]);
        if (!a && !b) throw new Error('not sent');
        this.fb = {kind: 'Idea', message: '', contact: '', sent: true};
        this.render();
      } catch {
        note.textContent = location.hostname === 'localhost' ? 'Test server: feedback only sends on the live site.' : 'Couldn’t send. Check your connection and try again.';
        btn.disabled = false;
        btn.textContent = 'Send';
      }
    };
  }

  /** The key facts under "Fight Red". */
  private descHtml() {
    if (this.info && isV2(this.info.date)) return `
      <ul class="facts">
        <li><b>6</b><span>Red’s legendary <br>team, all Lv 100</span></li>
        <li><b>3</b><span>Difficulties <br>to beat</span></li>
        <li><b>1</b><span>Try each, <br>every day</span></li>
      </ul>`;
    return `
      <ul class="facts">
        <li><b>6</b><span>Random Pokémon, <br>same for everyone</span></li>
        <li><b>3</b><span>Difficulties <br>to beat</span></li>
        <li><b>1</b><span>Try each, <br>new team daily</span></li>
      </ul>`;
  }

  /** Red's fixed team: who he brings to every battle, and their moves (tap to show). */
  private redTeamHtml() {
    const typeChip = (t: string) => `<span class="rt-type" style="background:${TYPE_COLORS[t] ?? '#999'}">${t}</span>`;
    return `
      <section class="mode board red-team" aria-labelledby="rt-title">
        <div class="rt-head">
          <div>
            <h3 class="board-sub" id="rt-title">Red’s team on Mt. Silver</h3>
            <p class="mode-desc">The same every day: six Lv 100 Pokémon with perfect stats. He always leads with Pikachu.</p>
          </div>
        </div>
        <ol class="rt-mons">${RED_TEAM.map(m => `
          <li><img src="${aniUrl(m.species)}" alt="" loading="lazy"><b>${esc(SPECIES[m.species].name)}</b><span class="rt-types">${SPECIES[m.species].types.map(typeChip).join('')}</span></li>`).join('')}
        </ol>
        <details class="rt-moves"><summary>Show Red’s moves</summary>
          <div class="rt-grid">${RED_TEAM.map(m => `
            <div class="rt-card"><b>${esc(SPECIES[m.species].name)}</b>
              <ul>${m.moves.map(id => `<li><i style="background:${TYPE_COLORS[MOVES[id].type] ?? '#999'}"></i>${esc(MOVES[id].name)}</li>`).join('')}</ul></div>`).join('')}
          </div>
        </details>
      </section>`;
  }

  // ---------- shared page header (results, leaderboard) ----------

  /** Friend-battle screens (src/pvp/screens.ts) use the same page frame. Returns the page element. */
  showPvpPage(body: string, backLabel = 'Menu', onBack?: () => void): HTMLElement {
    this.closeSheet(); // e.g. accepted a challenge while the profile was open: go straight to the match
    this.openPage('pvp', body);
    const back = this.root.querySelector<HTMLButtonElement>('#page-back')!;
    back.querySelector('span')!.textContent = backLabel;
    if (onBack) back.onclick = onBack;
    return this.root;
  }
  get pageName() { return this.page; }

  private openPage(page: 'results' | 'board' | 'friends' | 'friend' | 'pvp', body: string, backLabel?: string, onBack?: () => void) {
    this.page = page;
    document.body.classList.add('on-home');
    this.root.hidden = false;
    const user = currentUser();
    this.root.innerHTML = `
      <div class="home-wrap">
        <header class="home-top page-top">
          <button class="back" id="page-back" aria-label="Back to the menu">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg><span>Menu</span>
          </button>
          <button class="brand brand-home" aria-label="Back to the main menu" title="Main menu"><span class="brand-poke">DAILY</span><span class="brand-battles">BATTLES</span></button>
          <div class="top-actions">
            <button class="icon-btn" id="home-sound" aria-label="Sound"></button>
            <button class="pill-btn" id="page-friends" aria-label="Friends">${ICONS.friends}<span>Friends</span>${getFriends().length ? `<b>${getFriends().length}</b>` : ''}${getRequests().length ? `<i class="req-dot" title="Friend requests">${getRequests().length}</i>` : ''}</button>
            <button class="avatar" id="home-profile" aria-label="Your profile and stats">
              ${user ? `<span>${esc(user.username.slice(0, 1).toUpperCase())}</span>` : ICONS.person}
            </button>
          </div>
        </header>
        ${body}
      </div>`;
    this.root.scrollTop = 0;
    const back = this.root.querySelector<HTMLButtonElement>('#page-back')!;
    back.onclick = onBack ?? (() => this.onMenu());
    if (backLabel) back.querySelector('span')!.textContent = backLabel;
    this.root.querySelector<HTMLButtonElement>('#home-profile')!.onclick = () => this.openSheet();
    const fr = this.root.querySelector<HTMLButtonElement>('#page-friends')!;
    if (page === 'friends') fr.classList.add('on');
    fr.onclick = () => this.showFriends();
    this.root.querySelector<HTMLButtonElement>('.brand-home')!.onclick = () => this.onMenu();
    this.renderSoundButton();
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  // ---------- results (after a battle) ----------

  showResults(r: ResultsInfo) {
    this.date = r.date;
    const res = r.result;
    const won = res.won;
    const rate = r.stats.played ? Math.round((r.stats.wins / r.stats.played) * 100) : 0;
    const hpColor = (p: number) => (p === 0 ? 'fainted' : p > 50 ? 'good' : p > 20 ? 'mid' : 'low');
    const team = r.team.map((sp, i) => {
      const p = res.hp[i] ?? 0;
      return `
        <li class="mon mon-${hpColor(p)}">
          <div class="mon-pic"><img src="${aniUrl(sp)}" alt="" loading="lazy"></div>
          <span class="mon-name">${esc(SPECIES[sp]?.name ?? sp)}</span>
          <span class="mon-bar"><i style="width:${p}%"></i></span>
          <span class="mon-hp">${p === 0 ? 'Fainted' : `${p}% HP`}</span>
        </li>`;
    }).join('');
    this.openPage('results', `
      <section class="result-hero ${won ? 'is-won' : 'is-lost'}">
        <p class="eyebrow">Day #${r.dayNumber} · ${LEVEL_TEXT[r.level]}</p>
        <h1>${won ? 'Victory' : 'Defeat'}</h1>
        <p class="result-sub">${won ? `You beat Red with ${res.left} of 6 Pokémon left.` : 'Red won this time. A new team arrives tomorrow.'}</p>
        <div class="result-facts">
          <div><b>${res.left}<small>/6</small></b><span>Pokémon left</span></div>
          <div><b>${res.turns}</b><span>Turns</span></div>
          <div><b>${currentStreak(r.stats, r.date)}</b><span>Win streak</span></div>
        </div>
      </section>

      ${currentUser() ? '' : this.saveCard(true)}
      <div class="next-pair">
      ${(() => {
        const st = this.eliteState();
        if (st.state === 'done') return '';
        return `<section class="mode next-prompt is-elite">
          <div><p class="eyebrow eyebrow-dark">Next challenge</p>
            <h3>${st.state === 'playing' ? 'Finish your Elite Four run' : 'Take on the Elite Four'}</h3>
            <p class="mode-desc">Build your own team and battle Lorelei, Bruno, Agatha, Lance and Champion Blue back to back.</p></div>
          <button class="btn-dark" id="res-elite">${st.state === 'playing' ? 'Continue run' : 'Battle the Elite Four'} →</button>
        </section>`;
      })()}
      <section class="mode next-prompt">
        <div><p class="eyebrow eyebrow-dark">Tomorrow</p>
          <h3>Come back tomorrow</h3>
          <p class="mode-desc">You’ll get a brand-new team to try and beat Red again. New team in <b id="res-clock2">--:--:--</b>.</p></div>
      </section>
      </div>
      <section class="mode result-team">
        <h3>Your team</h3>
        <ul class="team-grid">${team}</ul>
      </section>

      <section class="result-actions">
        <button class="btn-dark" id="res-pic">Share picture</button>
        <button class="btn-light" id="res-share">Share today’s results</button>
        <button class="btn-light" id="res-board">${r.dev ? 'View leaderboard' : 'Leaderboard'}</button>
        ${r.next ? `<button class="btn-light" id="res-next">Play ${LEVEL_TEXT[r.next]} →</button>` : ''}
        <p class="res-note" id="res-note" role="status"></p>
      </section>

      <section class="mode result-stats">
        <h3>${LEVEL_TEXT[r.level]} record</h3>
        <div class="overview">
          <div><b>${r.stats.played}</b><span>Played</span></div>
          <div><b>${r.stats.wins}</b><span>Won</span></div>
          <div><b>${rate}%</b><span>Win rate</span></div>
          <div><b>${r.stats.maxStreak}</b><span>Best streak</span></div>
        </div>
        <p class="next-island">Next island in <b id="res-clock">--:--:--</b></p>
      </section>`);
    const note = this.root.querySelector<HTMLElement>('#res-note')!;
    this.bindSaveCard();
    this.root.querySelector<HTMLButtonElement>('#res-share')!.onclick = async () => {
      // The whole day in one message: Easy, Medium and Hard (unplayed ones say so).
      const day = Object.fromEntries(LEVELS.map(l => [l, l === r.level ? res : this.info?.stats[l].history[r.date]])) as Record<Level, DayResult | undefined>;
      const text = dayShareText(r.dayNumber, day, location.origin + location.pathname);
      note.textContent = await shareOrCopy(text);
    };
    this.root.querySelector<HTMLButtonElement>('#res-pic')!.onclick = async () => {
      note.textContent = 'Making your picture…';
      note.textContent = await shareCard({
        theme: 'red', eyebrow: `Day #${r.dayNumber} · ${LEVEL_TEXT[r.level]}`, title: won ? 'Victory!' : 'Defeat',
        sub: won ? `Beat Red with ${res.left} of 6 left` : 'Red won this time', user: currentUser()?.username,
        facts: [[`${res.left}/6`, 'Pokémon left'], [String(res.turns), 'Turns'], [String(currentStreak(r.stats, r.date)), 'Win streak']],
        team: r.team.map((sp, i) => ({species: sp, hp: res.hp[i] ?? 0})),
      }, `DailyBattles #${r.dayNumber} · ${LEVEL_TEXT[r.level]}: ${won ? `I beat Red with ${res.left}/6 left` : 'Red beat me'}! Can you do better? ${location.origin}/`);
    };
    this.root.querySelector<HTMLButtonElement>('#res-board')!.onclick = () => { void fetchFlags(true); this.showBoard(r.level, r.date); };
    const next = this.root.querySelector<HTMLButtonElement>('#res-next');
    if (next && r.next) next.onclick = () => this.onPlay(r.next!);
    const elite = this.root.querySelector<HTMLButtonElement>('#res-elite');
    if (elite) elite.onclick = () => this.onElite();
    const tick = () => {
      const el = this.root.querySelector('#res-clock');
      const el2 = this.root.querySelector('#res-clock2');
      if (!el) return;
      const now = new Date();
      const left = Math.max(0, Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000));
      el.textContent = `${pad(Math.floor(left / 3600))}:${pad(Math.floor((left % 3600) / 60))}:${pad(left % 60)}`;
      if (el2) el2.textContent = el.textContent;
    };
    tick();
    this.timer = window.setInterval(tick, 1000);
  }

  // ---------- leaderboard ----------

  /** when = a date (YYYY-MM-DD) or 'all' for all time. */
  showBoard(level: Level, when: string = this.date || this.info?.date || todayUTCString(), message = '') {
    if (when !== 'all') this.date = when;
    this.boardLevel = level;
    this.boardWhen = when;
    const today = todayUTCString();
    const day = when === 'all' ? today : when;
    const ago = Math.round((Date.parse(today) - Date.parse(day)) / 864e5);
    const first = ago >= daysSinceLaunch(today);
    const label = ago === 0 ? 'Today' : ago === 1 ? 'Yesterday' : `${ago} days ago`;
    const nice = new Date(day + 'T00:00:00Z').toLocaleDateString(undefined, {month: 'short', day: 'numeric', timeZone: 'UTC'});
    const mine = when !== 'all' ? submittedFor(day, level) : null;
    this.openPage('board', `
      <section class="board-head">
        <p class="eyebrow eyebrow-dark">Leaderboard</p>
        <h1 class="page-title">${when === 'all' ? 'All-time greats' : ago === 0 ? 'Today’s best trainers' : `Best trainers · ${label.toLowerCase()}`}</h1>
      </section>
      <div class="board-controls">
        <div class="seg seg-levels" role="tablist" aria-label="Difficulty">
          ${LEVELS.map(l => `<button role="tab" data-level="${l}" aria-selected="${l === level}">${LEVEL_TEXT[l]}</button>`).join('')}
          <button role="tab" class="tab-elite" data-elite aria-selected="false">Elite Four</button>
        </div>
        <div class="when">
          <div class="day-nav ${when === 'all' ? 'is-off' : ''}" role="group" aria-label="Day">
            <button class="day-arrow" id="day-prev" aria-label="Earlier day" ${when !== 'all' && first ? 'disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
            <button class="day-label" id="day-pick" aria-pressed="${when !== 'all'}">
              <b>${when === 'all' ? 'Daily' : label}</b><small>${when === 'all' ? 'pick a day' : `Day #${dayNumberOf(day)} · ${nice}`}</small>
            </button>
            <button class="day-arrow" id="day-next" aria-label="Later day" ${when === 'all' || ago === 0 ? 'disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
          </div>
          <button class="all-time" id="all-time" aria-pressed="${when === 'all'}">All time</button>
        </div>
      </div>
      ${message ? `<p class="board-msg">${esc(message)}</p>` : ''}

      <section class="mode board">
        <h3 class="board-sub">You &amp; friends</h3>
        <ol class="board-list" id="board-you"><li class="board-empty small">Loading…</li></ol>
        ${currentUser()
          ? `<div class="board-actions">${getFriends().length ? '' : '<p class="friends-soon">Invite friends to see how they did right here.</p>'}<button class="btn-dark" id="board-invite">Invite friends</button><button class="btn-light" id="board-friends">My friends</button></div>`
          : `<p class="friends-soon">Create a free account and your best result goes on the leaderboard automatically, next to your friends. <button class="link" data-save>Create account</button></p>`}
      </section>

      <section class="mode board">
        <h3 class="board-sub">Global</h3>
        <ol class="board-list" id="board-list"><li class="board-empty">Loading rankings…</li></ol>
        <p class="board-foot">${when === 'all' ? 'Ranked by total wins, then win rate, then Pokémon left. Date = latest battle.' : 'Ranked by wins, then Pokémon left, then fewest turns.'} Balls = each Pokémon’s health at the end: how full = health left (green 70%+, yellow 50%+, red under 50%, black ✕ = fainted). Tap a trainer to see their battle.</p>
      </section>`);
    this.root.querySelectorAll<HTMLButtonElement>('.seg-levels button[data-level]').forEach(b => {
      b.onclick = () => this.showBoard(b.dataset.level as Level, when);
    });
    this.root.querySelector<HTMLButtonElement>('.seg-levels [data-elite]')!.onclick = () => void this.showEliteBoard(when === 'all' ? 'all' : day);
    const shift = (d: number) => new Date(Date.parse(day) + d * 864e5).toISOString().slice(0, 10);
    this.root.querySelector<HTMLButtonElement>('#day-prev')!.onclick = () => this.showBoard(level, when === 'all' ? today : shift(-1));
    this.root.querySelector<HTMLButtonElement>('#day-next')!.onclick = () => this.showBoard(level, shift(1));
    this.root.querySelector<HTMLButtonElement>('#day-pick')!.onclick = () => { if (when === 'all') this.showBoard(level, today); };
    this.root.querySelector<HTMLButtonElement>('#all-time')!.onclick = () => this.showBoard(level, 'all');
    const inv = this.root.querySelector<HTMLButtonElement>('#board-invite');
    if (inv) inv.onclick = async () => { inv.textContent = await shareInvite(); setTimeout(() => { inv.textContent = 'Invite friends'; }, 2500); };
    const myf = this.root.querySelector<HTMLButtonElement>('#board-friends');
    if (myf) myf.onclick = () => this.showFriends();
    this.bindSaveCard();
    const add = this.root.querySelector<HTMLButtonElement>('#board-add');
    if (add) add.onclick = async () => {
      add.disabled = true;
      add.textContent = 'Adding…';
      const err = await this.onSubmit(level);
      this.showBoard(level, when, err ?? '');
    };
    void this.loadBoard(level, when);
  }

  private boardLevel: Level = 'easy';
  private boardWhen = '';

  private async loadBoard(level: Level, when: string) {
    const list = this.root.querySelector<HTMLElement>('#board-list');
    const you = this.root.querySelector<HTMLElement>('#board-you');
    if (!list || !you) return;
    const me = currentUser();
    const meKey = me?.username.toLowerCase();
    const chevron = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
    const [flags, trainers] = await Promise.all([fetchFlags(), fetchTrainers()]);
    // A little face of each player's chosen trainer (the top of their picture, in a circle).
    const faceOf = (name: string) => trainerFace(trainers[name.toLowerCase()]);
    const flagOf = (name: string) => {
      const c = flags[name.toLowerCase()];
      return c ? `<span class="flag" title="${esc(countryName(c))}">${flag(c)}</span>` : '';
    };
    // Six balls: each Pokémon's health at the end (filled in once the HP arrives).
    const balls = (id: number) => `<span class="turns hpballs" data-hp="${id}" title="Health of each Pokémon at the end">${'<i></i>'.repeat(6)}</span>`;
    let rows: string[] = [];
    let youRow = '';
    const friendNames = new Set(getFriends().map(f => f.username.toLowerCase()));
    const friendRows: string[] = [];
    let total = 0;
    try {
      if (when === 'all') {
        const {entries} = await fetchAllTime(level);
        total = entries.length;
        const row = (e: AllTimeEntry, rank: number, isMe: boolean) => `
          <li><button class="row ${rank <= 3 ? `top top-${rank}` : ''} ${isMe ? 'is-me' : ''}" data-id="${e.lastId}" aria-label="${esc(e.name)}: see their latest battle">
            <span class="rank">${rank}</span>
            <span class="who">${faceOf(e.name)}${esc(e.name)}${flagOf(e.name)}${isMe ? ' <em>you</em>' : ''}</span>
            <span class="res res-won">${e.wins} ${e.wins === 1 ? 'win' : 'wins'}</span>
            <span class="left">${Math.round((e.wins / e.played) * 100)}%</span>
            <span class="when-done">${when2(e.last)}</span>
            ${balls(e.lastId)}${chevron}
          </button></li>`;
        rows = entries.slice(0, 50).map((e, i) => row(e, i + 1, e.name.toLowerCase() === meKey));
        entries.forEach((e, i) => { if (friendNames.has(e.name.toLowerCase())) friendRows.push(row(e, i + 1, false)); });
        const at = meKey ? entries.findIndex(e => e.name.toLowerCase() === meKey) : -1;
        if (at >= 0) youRow = row(entries[at], at + 1, true);
      } else {
        const res = await fetchTop(when, level, 1000);
        total = res.total;
        const row = (e: Entry, rank: number, isMe: boolean) => `
          <li><button class="row ${rank <= 3 ? `top top-${rank}` : ''} ${isMe ? 'is-me' : ''}" data-id="${e.id}" aria-label="${esc(e.name)}: see their battle">
            <span class="rank">${rank}</span>
            <span class="who">${faceOf(e.name)}${esc(e.name)}${flagOf(e.name)}${isMe ? ' <em>you</em>' : ''}</span>
            <span class="res ${e.won ? 'res-won' : 'res-lost'}">${e.won ? 'Victory' : 'Defeat'}</span>
            <span class="left" title="Pokémon left">${e.won ? `${e.mons_left}/6` : '–'}</span>
            <span class="when-done">${when2(e.created_at)}</span>
            ${balls(e.id)}${chevron}
          </button></li>`;
        rows = res.entries.slice(0, 50).map((e, i) => row(e, i + 1, e.name.toLowerCase() === meKey));
        res.entries.forEach((e, i) => { if (friendNames.has(e.name.toLowerCase())) friendRows.push(row(e, i + 1, false)); });
        const at = meKey ? res.entries.findIndex(e => e.name.toLowerCase() === meKey) : -1;
        if (at >= 0) youRow = row(res.entries[at], at + 1, true);
      }
    } catch {
      list.innerHTML = '<li class="board-empty">Couldn’t load the rankings. Check your connection and try again.</li>';
      you.innerHTML = '';
      return;
    }
    if (this.page !== 'board' || !list.isConnected) return;
    // You and your friends, in global-rank order (each row shows the global rank).
    const mineAndFriends = [youRow, ...friendRows].filter(Boolean)
      .sort((a, b) => Number(/class="rank">(\d+)/.exec(a)?.[1]) - Number(/class="rank">(\d+)/.exec(b)?.[1]));
    you.innerHTML = mineAndFriends.length ? mineAndFriends.join('') : `<li class="board-empty small">${!me
      ? 'Log in to see your rank here. <button class="link" id="board-login">Log in or create an account</button>'
      : when === 'all' ? 'No results on this difficulty yet.' : 'You’re not on the board for this day.'}</li>`;
    const login = you.querySelector<HTMLButtonElement>('#board-login');
    if (login) login.onclick = () => this.openSheet();
    list.innerHTML = rows.length
      ? rows.join('') + (total > 50 ? `<li class="board-empty small">Showing the top 50 of ${total}.</li>` : '')
      : '<li class="board-empty">No results for this day yet.</li>';
    this.root.querySelectorAll<HTMLButtonElement>('.board-list .row').forEach(b => {
      b.onclick = () => this.showEntry(Number(b.dataset.id));
    });
    void this.fillBalls();
  }

  /** Colours the health balls: green 70%+, yellow 50–69%, red 1–49%, empty when fainted. */
  private async fillBalls() {
    const spots = [...this.root.querySelectorAll<HTMLElement>('.hpballs[data-hp]')];
    if (!spots.length) return;
    let hp: Map<number, number[]>;
    try { hp = await fetchHp(spots.map(s => Number(s.dataset.hp))); } catch { return; }
    for (const s of spots) {
      const team = hp.get(Number(s.dataset.hp));
      if (!team) continue;
      // Filled from the bottom in proportion to the health left (50% HP = half full).
      s.innerHTML = team.map(p => `<i class="${p >= 70 ? 'g' : p >= 50 ? 'y' : p > 0 ? 'r' : 'f'}" style="--p:${p}%" title="${p ? p + '% HP' : 'Fainted'}"></i>`).join('');
      s.classList.add('ready');
    }
  }

  // ---------- one trainer's battle (from the leaderboard) ----------

  async showEntry(id: number, backTo?: () => void, backName?: string) {
    const fromFriends = this.page === 'friends';
    const back = backTo ?? (() => (fromFriends ? this.showFriends() : this.showBoard(this.boardLevel, this.boardWhen)));
    this.openPage('board', `<section class="mode board"><p class="board-empty">Loading battle…</p></section>`);
    this.root.querySelector<HTMLButtonElement>('#page-back')!.onclick = back;
    this.root.querySelector('#page-back span')!.textContent = backName ?? (fromFriends ? 'Friends' : 'Leaderboard');
    let d: EntryDetail;
    try {
      d = await fetchEntry(id);
    } catch (e) {
      this.root.querySelector('.board')!.innerHTML = `<p class="board-empty">${esc((e as Error).message)}</p>`;
      return;
    }
    if (this.page !== 'board') return;
    const isMe = currentUser()?.username.toLowerCase() === d.name.toLowerCase();
    const cc = (await fetchFlags())[d.name.toLowerCase()];
    const rec = LEVELS.map(l => {
      const r = d.record[l];
      return `<tr><th>${LEVEL_TEXT[l]}</th><td>${r.played}</td><td>${r.wins}</td><td>${r.played ? Math.round((r.wins / r.played) * 100) + '%' : '–'}</td></tr>`;
    }).join('');
    const allPlayed = LEVELS.reduce((n, l) => n + d.record[l].played, 0), allWins = LEVELS.reduce((n, l) => n + d.record[l].wins, 0);
    const nice = new Date(d.day + 'T00:00:00Z').toLocaleDateString(undefined, {month: 'short', day: 'numeric', timeZone: 'UTC'});
    this.openPage('board', `
      <section class="result-hero ${d.won ? 'is-won' : 'is-lost'}">
        <p class="eyebrow"><button class="who-link" data-player="${esc(d.name)}">${esc(d.name)}${cc ? ' ' + flag(cc) : ''}${isMe ? ' (you)' : ''} ›</button> · Day #${d.dayNumber} · ${nice} · ${LEVEL_TEXT[d.level]}</p>
        <h1>${d.won ? 'Victory' : 'Defeat'}</h1>
        <p class="result-sub">${d.won ? `${esc(d.name)} beat Red with ${d.left} of 6 Pokémon left.` : `Red beat ${esc(d.name)} this time.`}</p>
        <div class="result-facts">
          <div><b>${d.left}<small>/6</small></b><span>Pokémon left</span></div>
          <div><b>${d.turns}</b><span>Turns</span></div>
          <div><b>${d.daysWon}</b><span>Days won</span></div>
        </div>
      </section>
      <section class="mode result-team">
        <h3>${esc(d.name)}’s team</h3>
        <ul class="team-grid">${this.teamHtml(d.team, true)}</ul>
      </section>
      <section class="mode result-team">
        <h3>Red’s team</h3>
        <ul class="team-grid">${this.teamHtml(d.red, false)}</ul>
      </section>
      <section class="mode result-stats">
        <h3>${esc(d.name)}’s record</h3>
        <div class="overview">
          <div><b>${d.daysPlayed}</b><span>Days played</span></div>
          <div><b>${d.daysWon}</b><span>Days won</span></div>
          <div><b>${allPlayed ? Math.round((allWins / allPlayed) * 100) : 0}%</b><span>Win rate</span></div>
          <div><b>${allWins}</b><span>Total wins</span></div>
        </div>
        <div class="table-wrap plain"><table class="diff">
          <thead><tr><th></th><th>Played</th><th>Won</th><th>Win %</th></tr></thead>
          <tbody>${rec}</tbody>
        </table></div>
      </section>`);
    const btn = this.root.querySelector<HTMLButtonElement>('#page-back')!;
    btn.onclick = back;
    btn.querySelector('span')!.textContent = fromFriends ? 'Friends' : 'Leaderboard';
    this.bindWhoLink(() => void this.showEntry(id, backTo, backName));
  }

  /** The trainer's name at the top of a battle/run page opens their trainer page. */
  private bindWhoLink(back: () => void) {
    this.root.querySelectorAll<HTMLButtonElement>('.who-link').forEach(b => {
      b.onclick = () => void this.showPlayer(b.dataset.player!, back, 'Back');
    });
  }

  /** Pokémon cards with picture, name, HP bar (and moves on hover). */
  private teamHtml(team: {species: string; hp: number; moves?: string[]}[], _mine: boolean) {
    const hpColor = (p: number) => (p === 0 ? 'fainted' : p > 50 ? 'good' : p > 20 ? 'mid' : 'low');
    return team.map(m => `
      <li class="mon mon-${hpColor(m.hp)}" title="${esc((m.moves ?? []).map(id => MOVES[id]?.name ?? id).join(' · '))}">
        <div class="mon-pic"><img src="${aniUrl(m.species)}" alt="" loading="lazy"></div>
        <span class="mon-name">${esc(SPECIES[m.species]?.name ?? m.species)}</span>
        <span class="mon-bar"><i style="width:${m.hp}%"></i></span>
        <span class="mon-hp">${m.hp === 0 ? 'Fainted' : `${m.hp}% HP`}</span>
      </li>`).join('');
  }

  // ---------- getting guests to create an account ----------

  /** The big "track your stats" card (results page after a battle). */
  private saveCard(big: boolean) {
    let hidden = false;
    try { hidden = localStorage.getItem(`pokebattles:notnow:${todayUTCString()}`) === '1'; } catch { /* ignore */ }
    if (hidden) return `<p class="save-mini">Playing as a guest. <button class="link" data-save>Create a free account</button> to track your stats and compare with friends.</p>`;
    return `
      <section class="save-card ${big ? 'is-big' : ''}">
        <div class="save-text">
          <p class="eyebrow">Free account</p>
          <h2>Battle your friends.<br>Track your stats.</h2>
          <ul class="perks">
            <li>${ICONS.friends}<span><b>Live friend battles</b>: challenge anyone, pick your teams, battle head to head</span></li>
            <li>${ICONS.trophy}<span><b>Your rank</b> on today’s leaderboard</span></li>
            <li>${ICONS.check}<span><b>Friends</b>: see how they did, every day</span></li>
            <li>${ICONS.check}<span><b>Streaks & stats</b> saved on every device</span></li>
          </ul>
        </div>
        <div class="save-actions">
          <button class="btn-dark save-go" data-save>Create free account</button>
          <button class="link" data-login>I already have one</button>
          <button class="link save-notnow" data-notnow>Not now</button>
        </div>
      </section>`;
  }

  /** Menu banner for returning guests. */
  private guestBanner(info: HomeInfo) {
    const streak = Math.max(...LEVELS.map(l => currentStreak(info.stats[l], info.date)));
    const played = new Set(LEVELS.flatMap(l => Object.keys(info.stats[l].history))).size;
    return `
      <section class="guest-banner">
        <div><b>${streak > 1 ? `Your ${streak}-day streak` : `Your ${played} ${played === 1 ? 'day' : 'days'} of results`} ${streak > 1 ? 'is' : 'are'} only saved on this device.</b>
        <span>Create a free account to keep it, get ranked and compare with friends.</span></div>
        <button class="btn-dark" data-save>Create account</button>
      </section>`;
  }

  private bindSaveCard() {
    this.root.querySelectorAll<HTMLButtonElement>('[data-save]').forEach(b => {
      b.onclick = () => { this.formMode = 'signup'; this.openSheet('Battle your friends live, track your stats and climb the leaderboard. It takes 20 seconds.'); };
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-login]').forEach(b => {
      b.onclick = () => { this.formMode = 'login'; this.openSheet(); };
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-notnow]').forEach(b => {
      b.onclick = () => {
        try { localStorage.setItem(`pokebattles:notnow:${todayUTCString()}`, '1'); } catch { /* ignore */ }
        const card = b.closest('.save-card');
        if (card) card.outerHTML = this.saveCard(false);
        this.bindSaveCard();
      };
    });
  }

  // ---------- friends ----------

  showFriends(message = '') {
    const me = currentUser();
    if (!me) {
      this.openPage('friends', `
        <section class="board-head"><p class="eyebrow eyebrow-dark">Friends</p><h1 class="page-title">Play with friends</h1></section>
        ${this.saveCard(true)}`);
      this.bindSaveCard();
      return;
    }
    const list = getFriends();
    this.openPage('friends', `
      <section class="board-head">
        <p class="eyebrow eyebrow-dark">Friends</p>
        <h1 class="page-title">Your friends</h1>
      </section>
      ${message ? `<p class="board-msg ok">${esc(message)}</p>` : ''}
      ${getRequests().length || getSent().length ? `<section class="mode board">
        <h3 class="board-sub">Friend requests</h3>
        <ol class="friend-list" id="request-list">${getRequests().map(r => `
          <li class="friend">
            <div class="friend-who">
              <button class="friend-name friend-open" data-player="${esc(r.username)}">${esc(r.username)}${r.country ? `<span class="flag">${flag(r.country)}</span>` : ''}<span class="chev">›</span></button>
              <span class="friend-rec">Wants to be your friend</span>
            </div>
            <div class="friend-actions"><button class="btn-dark small" data-accept="${esc(r.id)}">Accept</button><button class="btn-light small" data-decline="${esc(r.id)}">Decline</button></div>
          </li>`).join('')}${getSent().map(r => `
          <li class="friend">
            <div class="friend-who">
              <button class="friend-name friend-open" data-player="${esc(r.username)}">${esc(r.username)}<span class="chev">›</span></button>
              <span class="friend-rec">Request sent · waiting for them</span>
            </div>
          </li>`).join('')}</ol>
      </section>` : ''}
      <section class="mode board">
        <h3 class="board-sub">Challenges for you</h3>
        <ol class="friend-list" id="invite-list"><li class="board-empty small">Loading…</li></ol>
      </section>
      <section class="mode board invite">
        <div class="invite-main">
          <h3 class="board-sub">Invite friends</h3>
          <p class="mode-desc">Send your link or challenge card. When a friend opens it and creates an account, you’re friends and see each other’s results every day.</p>
          <div class="invite-row">
            <input id="invite-link" readonly value="${esc(inviteLink())}" aria-label="Your invite link">
          </div>
          <div class="invite-btns">
            <button class="btn-dark" id="invite-share">Share invite</button>
            <button class="btn-light" id="invite-card">Save challenge card</button>
          </div>
          <p class="res-note" id="invite-note" role="status"></p>
          <form class="add-row" id="add-friend">
            <input id="add-name" placeholder="Or send a request by username" autocomplete="off" maxlength="10" aria-label="Friend’s username">
            <button class="btn-light" type="submit">Add</button>
          </form>
        </div>
        <figure class="invite-qr">
          ${qrSvg(inviteLink(), 190)}
          <figcaption><b>With a friend right now?</b> They scan this with their phone camera and you’re friends instantly.</figcaption>
        </figure>
      </section>
      <section class="mode board">
        <h3 class="board-sub">Today · Day #${dayNumberOf(todayUTCString())} ${list.length ? `<small>(${list.length} ${list.length === 1 ? 'friend' : 'friends'})</small>` : ''}</h3>
        <ol class="friend-list" id="friend-list">${list.length ? '<li class="board-empty small">Loading…</li>' : '<li class="board-empty">No friends yet. Share your link to add some.</li>'}</ol>
      </section>
      <section class="mode board">
        <div class="tm-bar"><h3 class="board-sub">Friend battles</h3><button class="btn-dark" id="new-battle">New battle</button></div>
        <ol class="friend-list" id="match-list"><li class="board-empty small">Loading…</li></ol>
      </section>`);
    const note = this.root.querySelector<HTMLElement>('#invite-note')!;
    this.root.querySelector<HTMLButtonElement>('#invite-share')!.onclick = async () => { note.textContent = await shareInvite(); };
    this.root.querySelector<HTMLButtonElement>('#invite-card')!.onclick = async () => {
      note.textContent = 'Making your card…';
      await downloadInviteCard();
      note.textContent = 'Saved! Send the picture to your friends.';
    };
    this.root.querySelector<HTMLFormElement>('#add-friend')!.onsubmit = async e => {
      e.preventDefault();
      const input = this.root.querySelector<HTMLInputElement>('#add-name')!;
      const name = input.value.trim();
      if (!name) return;
      try {
        const r = await requestFriend(name);
        this.showFriends(r === 'friends' ? `You and ${name} are now friends!` : `Friend request sent to ${name}.`);
      } catch (ex) {
        note.textContent = (ex as Error).message;
      }
    };
    this.root.querySelectorAll<HTMLButtonElement>('[data-accept], [data-decline]').forEach(b => {
      b.onclick = async () => {
        b.disabled = true;
        const accept = !!b.dataset.accept, id = (b.dataset.accept ?? b.dataset.decline)!;
        const who = getRequests().find(r => r.id === id)?.username ?? '';
        try {
          await answerRequest(id, accept);
          this.showFriends(accept ? `You and ${who} are now friends!` : '');
        } catch (ex) { note.textContent = (ex as Error).message; b.disabled = false; }
      };
    });
    this.root.querySelectorAll<HTMLButtonElement>('#request-list [data-player]').forEach(b => {
      b.onclick = () => void this.showPlayer(b.dataset.player!, () => this.showFriends(), 'Friends');
    });
    if (list.length) void this.loadFriends(list);
    this.root.querySelector<HTMLButtonElement>('#new-battle')!.onclick = () => this.onPlayFriend();
    void this.loadMatches();
    void this.loadInvites();
  }

  /** Friend challenges waiting for me: they stay here (for a day) until accepted or declined. */
  async loadInvites() {
    const ol = this.root.querySelector<HTMLElement>('#invite-list');
    if (!ol) return;
    let rows: Awaited<ReturnType<Home['listInvites']>> = [];
    try { rows = await this.listInvites(); } catch { /* offline */ }
    if (this.page !== 'friends' || !ol.isConnected) return;
    const ago = (at: number) => { const m = Math.round((Date.now() - at) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
    ol.innerHTML = rows.length ? rows.map(r => `
      <li class="friend">
        <div class="friend-who">
          <span class="friend-name">${esc(r.from.name)}${r.from.country ? `<span class="flag">${flag(r.from.country)}</span>` : ''}</span>
          <span class="friend-rec">Challenged you ${ago(r.at)}</span>
        </div>
        <div class="chips"><button class="chip chip-battle" data-accept="${r.id}">Accept</button><button class="chip chip-none" data-decline="${r.id}">Decline</button></div>
        <span></span>
      </li>`).join('') : '<li class="board-empty small">No challenges right now. When a friend challenges you, it shows up here.</li>';
    ol.querySelectorAll<HTMLButtonElement>('[data-accept]').forEach(b => { b.onclick = () => this.onOpenMatch(b.dataset.accept!); });
    ol.querySelectorAll<HTMLButtonElement>('[data-decline]').forEach(b => {
      b.onclick = async () => { b.disabled = true; await this.onDeclineInvite(b.dataset.decline!).catch(() => {}); void this.loadInvites(); };
    });
  }

  /** Your recent friend battles: resume ones in progress, see results of finished ones. */
  private async loadMatches() {
    const ol = this.root.querySelector<HTMLElement>('#match-list');
    if (!ol) return;
    let rows: Awaited<ReturnType<Home['listMatches']>> = [];
    try { rows = await this.listMatches(); } catch { /* offline */ }
    if (this.page !== 'friends' || !ol.isConnected) return;
    const label: Record<string, string> = {lobby: 'Waiting for them to join', room: 'In the battle room', picking: 'Picking teams', battle: 'Battle in progress'};
    ol.innerHTML = rows.length ? rows.map(r => `
      <li class="friend">
        <div class="friend-who">
          <span class="friend-name">${r.opp ? esc(r.opp.name) + (r.opp.country ? `<span class="flag">${flag(r.opp.country)}</span>` : '') : 'Open challenge'}</span>
          <span class="friend-rec">${new Date(r.at).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})} · ${r.stage === 'done' ? (r.won ? 'You won' : 'You lost') : label[r.stage] ?? ''}</span>
        </div>
        <div class="chips">${r.stage === 'done'
          ? `<span class="chip ${r.won ? 'chip-won' : 'chip-lost'}">${r.won ? 'Victory' : 'Defeat'}</span>`
          : `<button class="chip chip-battle" data-open="${r.id}">${r.stage === 'lobby' ? 'Share link' : 'Rejoin'}</button>`}
          ${r.stage === 'done' ? `<button class="chip chip-none" data-open="${r.id}">Details</button>` : ''}</div>
        ${r.stage === 'done' ? '<span></span>' : `<button class="friend-x" data-cancel="${r.id}" aria-label="Delete this match" title="${r.stage === 'battle' ? 'Forfeit and remove' : 'Delete this match'}">${ICONS.close}</button>`}
      </li>`).join('') : '<li class="board-empty small">No friend battles yet. Tap New battle, or Battle next to a friend.</li>';
    ol.querySelectorAll<HTMLButtonElement>('[data-open]').forEach(b => { b.onclick = () => this.onOpenMatch(b.dataset.open!); });
    ol.querySelectorAll<HTMLButtonElement>('[data-cancel]').forEach(b => {
      b.onclick = async () => {
        if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.classList.add('confirm'); b.title = 'Tap again to delete'; return; }
        b.disabled = true;
        await this.onCancelMatch(b.dataset.cancel!).catch(() => {});
        void this.loadMatches();
      };
    });
  }

  private async loadFriends(list: Friend[]) {
    const ol = this.root.querySelector<HTMLElement>('#friend-list');
    if (!ol) return;
    const names = list.map(f => `"${f.username.replace(/"/g, '')}"`).join(',');
    const headers = {apikey: SUPABASE_KEY};
    let today: {id: number; name: string; level: Level; won: boolean; mons_left: number}[] = [];
    let all: {name: string; won: boolean}[] = [];
    try {
      const day = todayUTCString();
      [today, all] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/results?day=eq.${day}&replaced=is.false&name=in.(${encodeURIComponent(names)})&select=id,name,level,won,mons_left`, {headers}).then(r => r.json()),
        fetch(`${SUPABASE_URL}/rest/v1/results?name=in.(${encodeURIComponent(names)})&replaced=is.false&level=in.(easy,medium,hard)&select=name,won&limit=20000`, {headers}).then(r => r.json()),
      ]);
    } catch { /* show what we have */ }
    if (this.page !== 'friends' || !ol.isConnected) return;
    ol.innerHTML = list.map(f => {
      const key = f.username.toLowerCase();
      const mine = all.filter(r => r.name.toLowerCase() === key);
      const wins = mine.filter(r => r.won).length;
      const chips = LEVELS.map(l => {
        const r = today.find(t => t.name.toLowerCase() === key && t.level === l);
        return r
          ? `<button class="chip ${r.won ? 'chip-won' : 'chip-lost'}" data-id="${r.id}" title="See ${esc(f.username)}’s ${LEVEL_TEXT[l]} battle">${LEVEL_TEXT[l]} ${r.won ? `✓ ${r.mons_left}/6` : '✗'}</button>`
          : `<span class="chip chip-none">${LEVEL_TEXT[l]} –</span>`;
      }).join('');
      return `
        <li class="friend">
          <div class="friend-who">
            <button class="friend-name friend-open" data-profile="${f.id}" title="See ${esc(f.username)}’s profile">${esc(f.username)}${f.country ? `<span class="flag">${flag(f.country)}</span>` : ''}<span class="chev">›</span></button>
            <span class="friend-rec">${wins} ${wins === 1 ? 'win' : 'wins'} · ${mine.length} played</span>
          </div>
          <div class="chips">${chips}<button class="chip chip-battle" data-challenge="${esc(f.username)}">Battle</button></div>
          <button class="friend-x" data-remove="${f.id}" aria-label="Remove ${esc(f.username)}" title="Remove friend">${ICONS.close}</button>
        </li>`;
    }).join('');
    ol.querySelectorAll<HTMLButtonElement>('.chip[data-id]').forEach(b => { b.onclick = () => this.showEntry(Number(b.dataset.id)); });
    ol.querySelectorAll<HTMLButtonElement>('[data-challenge]').forEach(b => { b.onclick = () => this.onPlayFriend(b.dataset.challenge); });
    ol.querySelectorAll<HTMLButtonElement>('[data-profile]').forEach(b => {
      b.onclick = () => { const f = list.find(x => x.id === b.dataset.profile); if (f) void this.showFriendProfile(f); };
    });
    ol.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach(b => {
      b.onclick = async () => {
        if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.classList.add('confirm'); b.title = 'Tap again to remove'; return; }
        try { await removeFriend(b.dataset.remove!); } catch { /* ignore */ }
        this.showFriends();
      };
    });
  }

  /** A friend's page: your head-to-head record in friend battles, every battle between you (tap → full result). */
  async showFriendProfile(f: Friend, back: () => void = () => this.showFriends(), backLabel = 'Friends') {
    const name = esc(f.username) + (f.country ? ` <span class="flag">${flag(f.country)}</span>` : '');
    this.openPage('friend', `
      <section class="board-head">
        <p class="eyebrow eyebrow-dark">Friend</p>
        <h1 class="page-title">${name}</h1>
        <div class="pl-badges" id="pl-badges"></div>
      </section>
      <section class="mode board h2h" id="h2h"><p class="board-empty small">Loading your battles…</p></section>
      <section class="mode board" id="fp-red"><p class="board-empty small">Loading their battles with Red…</p></section>
      <section class="mode board" id="fp-elite"><p class="board-empty small">Loading their Elite Four runs…</p></section>
      <div class="pick-actions"><button class="btn-dark big" id="fp-battle">Battle ${esc(f.username)}</button></div>`, backLabel, back);
    void this.loadPlayerElite(f.username);
    void this.fillPlayerBadges(f.username);
    this.root.querySelector<HTMLButtonElement>('#fp-battle')!.onclick = () => this.onPlayFriend(f.username);
    void this.loadFriendRed(f);
    let rows: Awaited<ReturnType<Home['listMatches']>> = [];
    try { rows = await this.listMatches(f.username); } catch { /* offline */ }
    const box = this.root.querySelector<HTMLElement>('#h2h');
    if (this.page !== 'friend' || !box) return;
    rows = rows.filter(r => r.opp && r.opp.name.toLowerCase() === f.username.toLowerCase());
    const done = rows.filter(r => r.stage === 'done');
    const w = done.filter(r => r.won).length, l = done.length - w;
    const form = done.slice(0, 5).map(r => `<i class="${r.won ? 'w' : 'l'}">${r.won ? 'W' : 'L'}</i>`).join('');
    const label: Record<string, string> = {lobby: 'Waiting to join', picking: 'Picking teams', battle: 'In progress'};
    const howText = (r: typeof rows[number]) => r.how === 'forfeit' ? (r.won ? 'they forfeited' : 'you forfeited') : r.how === 'timeout' ? (r.won ? 'they ran out of time' : 'you ran out of time') : r.left ? `${r.left.me}–${r.left.opp} Pokémon left` : '';
    box.innerHTML = `
      <div class="h2h-score">
        <div><b>${w}</b><span>You</span></div>
        <em>–</em>
        <div><b>${l}</b><span>${esc(f.username)}</span></div>
      </div>
      <p class="h2h-sub">${done.length ? `${done.length} friend ${done.length === 1 ? 'battle' : 'battles'}${w > l ? ' · you lead' : w < l ? ` · ${esc(f.username)} leads` : ' · all square'}` : 'No friend battles yet. Challenge them!'}</p>
      ${form ? `<div class="h2h-form"><span>Last ${Math.min(5, done.length)}</span>${form}</div>` : ''}
      ${rows.length ? `<h3 class="board-sub">Battles <small>tap one to see the full result</small></h3>
      <ol class="h2h-list">${rows.map(r => `
        <li><button data-open="${r.id}">
          <span class="chip ${r.stage === 'done' ? (r.won ? 'chip-won' : 'chip-lost') : 'chip-battle'}">${r.stage === 'done' ? (r.won ? 'Victory' : 'Defeat') : label[r.stage] ?? ''}</span>
          <span class="h2h-when">${new Date(r.at).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'})}<small>${esc(howText(r))}</small></span>
          <span class="h2h-go">${r.stage === 'done' ? 'Details' : 'Resume'} ›</span>
        </button></li>`).join('')}</ol>` : ''}`;
    box.querySelectorAll<HTMLButtonElement>('[data-open]').forEach(b => { b.onclick = () => this.onOpenMatch(b.dataset.open!); });
  }

  /** Any trainer's page (from the leaderboard or a friend request): their record vs Red and in the Elite Four,
   *  and a friend-request button. Friends get the full friend page (head-to-head, Battle). */
  async showPlayer(username: string, back: () => void, backLabel = 'Leaderboard') {
    const friend = getFriends().find(f => f.username.toLowerCase() === username.toLowerCase());
    if (friend) return this.showFriendProfile(friend, back, backLabel);
    const me = currentUser();
    const cc = (await fetchFlags())[username.toLowerCase()];
    const f: Friend = {id: '', username, country: cc ?? ''};
    const isMe = me?.username.toLowerCase() === username.toLowerCase();
    const asked = getSent().some(x => x.username.toLowerCase() === username.toLowerCase());
    const asking = getRequests().find(x => x.username.toLowerCase() === username.toLowerCase());
    const action = isMe ? '<p class="friends-soon">This is you!</p>'
      : !me ? '<button class="btn-dark big" data-save>Create an account to add friends</button>'
      : asking ? `<button class="btn-dark big" id="pl-accept">Accept friend request</button>`
      : asked ? '<button class="btn-light big" disabled>Friend request sent ✓</button>'
      : '<button class="btn-dark big" id="pl-add">Add friend</button>';
    this.openPage('friend', `
      <section class="board-head">
        <p class="eyebrow eyebrow-dark">Trainer</p>
        <h1 class="page-title">${esc(username)}${cc ? ` <span class="flag">${flag(cc)}</span>` : ''}</h1>
        <div class="pl-badges" id="pl-badges"></div>
        <div class="pick-actions pl-actions">${action}</div>
        <p class="res-note" id="pl-note" role="status"></p>
      </section>
      <section class="mode board" id="fp-red"><p class="board-empty small">Loading their battles with Red…</p></section>
      <section class="mode board" id="fp-elite"><p class="board-empty small">Loading their Elite Four runs…</p></section>`, backLabel, back);
    this.bindSaveCard();
    const note = this.root.querySelector<HTMLElement>('#pl-note')!;
    const add = this.root.querySelector<HTMLButtonElement>('#pl-add');
    if (add) add.onclick = async () => {
      add.disabled = true;
      try {
        const r = await requestFriend(username);
        if (r === 'friends') return void this.showPlayer(username, back, backLabel);
        add.textContent = 'Friend request sent ✓';
        add.className = 'btn-light big';
        note.textContent = `${username} will see your request in their Friends page.`;
      } catch (ex) { add.disabled = false; note.textContent = (ex as Error).message; }
    };
    const acc = this.root.querySelector<HTMLButtonElement>('#pl-accept');
    if (acc && asking) acc.onclick = async () => {
      acc.disabled = true;
      try { await answerRequest(asking.id, true); void this.showPlayer(username, back, backLabel); }
      catch (ex) { acc.disabled = false; note.textContent = (ex as Error).message; }
    };
    void this.fillPlayerBadges(username);
    void this.loadFriendRed(f, () => void this.showPlayer(username, back, backLabel));
    void this.loadPlayerElite(username);
  }

  /** The badges a trainer shows on their profile. */
  private async fillPlayerBadges(username: string) {
    const ids = (await fetchBadges())[username.toLowerCase()];
    const el = this.root.querySelector<HTMLElement>('#pl-badges');
    if (el) el.innerHTML = equippedHtml(ids, 40);
  }

  /** A trainer's Elite Four record (from the leaderboard). */
  private async loadPlayerElite(username: string) {
    let rows: {id: number; day: string; stage: number; won: boolean; turns: number; items_used: number | null}[] = [];
    try {
      rows = await fetch(`${SUPABASE_URL}/rest/v1/results?level=in.(elite,elite-hard)&name=ilike.${encodeURIComponent(username)}&select=id,day,stage,won,turns,items_used&order=day.desc&limit=500`,
        {headers: {apikey: SUPABASE_KEY}}).then(r => r.json());
      if (!Array.isArray(rows)) rows = [];
    } catch { /* offline */ }
    const box = this.root.querySelector<HTMLElement>('#fp-elite');
    if (this.page !== 'friend' || !box) return;
    box.innerHTML = `<h3 class="board-sub sub-elite">Elite Four</h3>${rows.length
      ? this.eliteStatsHtml(rows.map(r => ({day: r.day, stage: r.stage ?? 0, won: r.won, turns: r.turns, items: r.items_used})), false)
      : `<p class="board-empty small">${esc(username)} hasn’t finished an Elite Four run yet.</p>`}`;
    const ids = new Map(rows.map(r => [r.day, r.id]));
    box.querySelectorAll<HTMLElement>('.elite-recent li[data-day]').forEach(li => {
      const id = ids.get(li.dataset.day!);
      if (id) li.onclick = () => void this.showEliteEntry(id, () => void this.showPlayer(username, () => this.onMenu(), 'Menu'));
    });
  }

  /** On a friend's page: their record against Red (per difficulty) and their recent daily battles (tap → full battle). */
  private async loadFriendRed(f: Friend, back: () => void = () => void this.showFriendProfile(f)) {
    type Row = {id: number; day: string; level: Level; won: boolean; mons_left: number};
    let rows: Row[] = [];
    try {
      rows = await fetch(`${SUPABASE_URL}/rest/v1/results?name=eq.${encodeURIComponent(f.username)}&replaced=is.false&level=in.(easy,medium,hard)&select=id,day,level,won,mons_left&order=day.desc&limit=300`,
        {headers: {apikey: SUPABASE_KEY}}).then(r => r.json());
      if (!Array.isArray(rows)) rows = [];
    } catch { /* offline */ }
    const box = this.root.querySelector<HTMLElement>('#fp-red');
    if (this.page !== 'friend' || !box) return;
    const wins = rows.filter(r => r.won).length;
    const days = [...new Set(rows.map(r => r.day))];
    const per = LEVELS.map(l => {
      const mine = rows.filter(r => r.level === l), w = mine.filter(r => r.won).length;
      return `<div><span>${LEVEL_TEXT[l]}</span><b>${w}/${mine.length}</b><small>${mine.length ? Math.round((w / mine.length) * 100) + '% won' : 'not played'}</small></div>`;
    }).join('');
    const shown = days.slice(0, 10);
    box.innerHTML = `
      <h3 class="board-sub">Battles with Red</h3>
      ${rows.length ? `
      <div class="fp-stats">
        <div><b>${days.length}</b><span>days played</span></div>
        <div><b>${wins}</b><span>wins</span></div>
        <div><b>${Math.round((wins / rows.length) * 100)}%</b><span>win rate</span></div>
      </div>
      <div class="fp-levels">${per}</div>
      <ol class="h2h-list">${shown.map(day => {
        const chips = LEVELS.map(l => {
          const r = rows.find(x => x.day === day && x.level === l);
          return r ? `<button class="chip ${r.won ? 'chip-won' : 'chip-lost'}" data-id="${r.id}">${LEVEL_TEXT[l]} ${r.won ? `✓ ${r.mons_left}/6` : '✗'}</button>`
            : `<span class="chip chip-none">${LEVEL_TEXT[l]} –</span>`;
        }).join('');
        return `<li class="fp-day"><span class="h2h-when">Day #${dayNumberOf(day)}<small>${new Date(day + 'T00:00:00Z').toLocaleDateString(undefined, {day: 'numeric', month: 'short'})}</small></span><div class="chips">${chips}</div></li>`;
      }).join('')}</ol>
      <p class="fine">Tap a result to see their team, Red’s team and how it went.</p>`
      : `<p class="board-empty small">${esc(f.username)} hasn’t battled Red yet.</p>`}`;
    box.querySelectorAll<HTMLButtonElement>('[data-id]').forEach(b => { b.onclick = () => this.showEntry(Number(b.dataset.id), back, f.username); });
  }

  /** Profile: your saved teams as compact cards; tap one to open its own page. */
  private savedTeamsHtml() {
    const list = listLoadouts();
    const user = currentUser();
    return `<section class="saved-teams" id="saved-teams">
      <h3 class="sheet-sub">Saved teams</h3>
      ${list.length ? list.map(l => `
        <button class="st-team" data-open-team="${l.id}">
          <span class="st-name">${esc(l.name)}</span>
          <span class="st-mons">${l.team.mons.map(m => `<img src="${aniUrl(m.species)}" alt="" loading="lazy">`).join('')}</span>
          <span class="st-chev" aria-hidden="true">›</span>
        </button>`).join('')
        : '<p class="fine">No saved teams yet. Build a team for Easy, the Elite Four or a friend battle and tap “Save this team”.</p>'}
      <p class="fine">${user ? 'Saved to your account, so they’re on every device and on the test site too.' : 'Saved on this device. Create an account to have them everywhere.'}</p>
    </section>`;
  }

  /** Edit a saved team in the team builder (main.ts opens it, then comes back here). */
  onEditTeam: (id: string) => void = () => {};

  /** A saved team's own page: every Pokémon with its types, and each move's power, accuracy, PP and what it does. */
  showTeam(id: string) {
    const l = listLoadouts().find(x => x.id === id);
    if (!l) return this.onMenu();
    const typeBadge = (t: string) => `<img class="tbadge" src="${import.meta.env.BASE_URL}types/${t}.png" alt="${t}" title="${t}">`;
    this.openPage('results', `
      <section class="board-head">
        <p class="eyebrow eyebrow-dark">Saved team</p>
        <h1 class="page-title">${esc(l.name)}</h1>
        <div class="team-actions"><button class="btn-dark" id="team-edit">Edit team</button><button class="btn-light" id="team-del">Delete</button></div>
      </section>
      <div class="team-detail">${l.team.mons.map(m => `
        <section class="mode td-mon">
          <div class="td-head"><img src="${aniUrl(m.species)}" alt="">
            <div><h3>${esc(SPECIES[m.species]?.name ?? m.species)}</h3><span class="td-types">Lv ${m.level} ${(SPECIES[m.species]?.types ?? []).map(typeBadge).join('')}</span></div></div>
          <ul class="td-moves">${m.moves.map(mid => {
            const mv = MOVES[mid];
            if (!mv) return '';
            return `<li><div class="td-move-top"><i style="background:${TYPE_COLORS[mv.type] ?? '#999'}"></i><b>${esc(mv.name)}</b>
              <span>${mv.type} · ${powerLabel(mid) === '-' ? 'Status move' : `Pwr ${powerLabel(mid)}`}${mv.acc ? ` · Acc ${mv.acc}%` : ''} · PP ${mv.pp}</span></div>
              <p>${esc(moveDesc(mid))}</p></li>`;
          }).join('')}</ul>
        </section>`).join('')}
      </div>
      ${Object.keys(l.team.bag ?? {}).length ? `<section class="mode td-items"><h3>Items</h3><p>${Object.entries(l.team.bag).map(([it, n]) => `${esc(it)} ×${n}`).join(' · ')}</p></section>` : ''}`,
      'Profile', () => { this.onMenu(); this.openSheet(); });
    this.root.querySelector<HTMLButtonElement>('#team-edit')!.onclick = () => this.onEditTeam(id);
    const del = this.root.querySelector<HTMLButtonElement>('#team-del')!;
    del.onclick = () => {
      if (del.dataset.confirm !== '1') { del.dataset.confirm = '1'; del.textContent = 'Tap again to delete'; return; }
      removeLoadout(id);
      this.onMenu();
      this.openSheet();
    };
  }

  /** The Elite Four card on the menu: start, continue, or today's result. */
  private eliteCard() {
    const reached = (n: number) => ELITE_NAMES[Math.min(n, 4)];
    const cap = (n: string) => n[0] + n.slice(1).toLowerCase();
    const btn = (m: 'easy' | 'hard', label: string, sub: string) => {
      const st = this.eliteState(m);
      const state = st.state === 'new' ? 'Start run' : st.state === 'playing' ? `Continue · ${cap(reached(st.cleared))}` : st.won ? 'Champion! 👑' : `Reached ${cap(reached(st.cleared))}`;
      return `<button class="e4-btn ${st.state === 'done' ? (st.won ? 'is-won' : 'is-done') : ''}" data-elite-mode="${m}">
        <b>${label}</b><small>${sub}</small><span>${state}</span></button>`;
    };
    return `
      <section class="mode mode-soon" id="home-elite">
        <div class="soon-icon">${ICONS.crown}</div>
        <div class="soon-body">
          <h3>Elite Four</h3>
          <p class="mode-desc">Lorelei, Bruno, Agatha, Lance and Champion Blue, back to back. One run a day on each difficulty.</p>
          <div class="e4-btns">${btn('easy', 'Easy', 'Build your team')}${btn('hard', 'Hard', 'Random team · items locked')}</div>
        </div>
      </section>`;
  }

  /** Hard Elite Four: today's random team (moves and items locked) before the run starts. */
  showEliteHardTeam(team: {mons: {species: string; level: number; moves: string[]}[]; bag: Record<string, number>}, onStart: () => void) {
    const typeBadge = (t: string) => `<img class="tbadge" src="${import.meta.env.BASE_URL}types/${t}.png" alt="${t}" title="${t}">`;
    this.openPage('results', `
      <section class="board-head">
        <p class="eyebrow eyebrow-dark" style="color:#6b3fd0">Elite Four · Hard · Day #${dayNumberOf(this.date || todayUTCString())}</p>
        <h1 class="page-title">Today’s team</h1>
        <p class="mode-desc">Everyone gets this same random team today, with these moves and items. No changes allowed. HP, PP and status carry over between battles; lose once and the run ends.</p>
      </section>
      <div class="team-detail">${team.mons.map(m => `
        <section class="mode td-mon">
          <div class="td-head"><img src="${aniUrl(m.species)}" alt="">
            <div><h3>${esc(SPECIES[m.species]?.name ?? m.species)}</h3><span class="td-types">Lv ${m.level} ${(SPECIES[m.species]?.types ?? []).map(typeBadge).join('')}</span></div></div>
          <ul class="td-moves">${m.moves.map(mid => {
            const mv = MOVES[mid];
            if (!mv) return '';
            return `<li><div class="td-move-top"><i style="background:${TYPE_COLORS[mv.type] ?? '#999'}"></i><b>${esc(mv.name)}</b>
              <span>${mv.type} · ${powerLabel(mid) === '-' ? 'Status move' : `Pwr ${powerLabel(mid)}`}${mv.acc ? ` · Acc ${mv.acc}%` : ''} · PP ${mv.pp}</span></div></li>`;
          }).join('')}</ul>
        </section>`).join('')}
      </div>
      <section class="mode td-items"><h3>Items</h3><p>${Object.entries(team.bag).map(([it, n]) => `${esc(it)} ×${n}`).join(' · ')}</p></section>
      <div class="pick-actions"><button class="btn-dark big" id="e4-hard-go">Enter the League</button></div>`);
    this.root.querySelector<HTMLButtonElement>('#e4-hard-go')!.onclick = onStart;
  }

  /** After an Elite Four run: how far you got, your team, and the Elite Four leaderboard. */
  showEliteResult(r: {date: string; mode?: 'easy' | 'hard'; cleared: number; won: boolean; turns: number; items?: number; reached: string; team: {species: string; hp: number}[]}) {
    const hard = r.mode === 'hard';
    const hpColor = (p: number) => (p === 0 ? 'fainted' : p > 50 ? 'good' : p > 20 ? 'mid' : 'low');
    const name = (n: string) => n[0] + n.slice(1).toLowerCase();
    this.openPage('results', `
      <section class="result-hero ${r.won ? 'is-won' : 'is-lost'}">
        <p class="eyebrow">Elite Four · ${hard ? 'Hard' : 'Easy'} · Day #${dayNumberOf(r.date)}</p>
        <h1>${r.won ? 'Champion!' : 'Run over'}</h1>
        <p class="result-sub">${r.won ? 'You beat all four and Champion Blue. You’re the new Champion!' : `You made it to ${name(r.reached)}. A new run opens tomorrow.`}</p>
        <div class="result-facts">
          <div><b>${r.cleared}<small>/5</small></b><span>Beaten</span></div>
          <div><b>${r.team.filter(m => m.hp > 0).length}<small>/6</small></b><span>Pokémon left</span></div>
          <div><b>${r.turns}</b><span>Turns</span></div>${r.items != null ? `
          <div><b>${r.items}</b><span>Items used</span></div>` : ''}
        </div>
      </section>
      ${currentUser() ? '' : this.saveCard(true)}
      <section class="mode result-team">
        <h3>Your team at the end</h3>
        <ul class="team-grid">${r.team.map(m => `
          <li class="mon mon-${hpColor(m.hp)}">
            <div class="mon-pic"><img src="${aniUrl(m.species)}" alt="" loading="lazy"></div>
            <span class="mon-name">${esc(SPECIES[m.species]?.name ?? m.species)}</span>
            <span class="mon-bar"><i style="width:${m.hp}%"></i></span>
            <span class="mon-hp">${m.hp === 0 ? 'Fainted' : `${m.hp}% HP`}</span></li>`).join('')}</ul>
      </section>
      <section class="result-actions">
        <button class="btn-dark" id="elite-share">Share my run</button>
        <button class="btn-light" id="elite-board">Elite Four leaderboard</button>
        <button class="btn-light" id="elite-menu">Menu</button>
        <p class="res-note" id="elite-note" role="status"></p>
      </section>`);
    this.root.querySelector<HTMLButtonElement>('#elite-share')!.onclick = async () => {
      const note = this.root.querySelector<HTMLElement>('#elite-note')!;
      note.textContent = 'Making your picture…';
      const left = r.team.filter(m => m.hp > 0).length;
      note.textContent = await shareCard({
        theme: 'elite', eyebrow: `Elite Four · ${hard ? 'Hard' : 'Easy'} · Day #${dayNumberOf(r.date)}`, title: r.won ? 'Champion!' : `Reached ${name(r.reached)}`,
        sub: r.won ? 'Beat all four and Champion Blue' : `Cleared ${r.cleared} of 5 rooms`, user: currentUser()?.username,
        rooms: Array.from({length: r.cleared}, () => true),
        facts: [[`${left}/6`, 'Pokémon left'], [String(r.turns), 'Turns'], ...(r.items != null ? [[String(r.items), 'Items used'] as [string, string]] : [])],
        team: r.team,
      }, r.won ? `I became Champion on DailyBattles using ${r.items ?? '?'} items! Beat that: ${location.origin}/` : `I reached ${name(r.reached)} in the Elite Four on DailyBattles. Can you go further? ${location.origin}/`);
    };
    this.bindSaveCard();
    this.root.querySelector<HTMLButtonElement>('#elite-board')!.onclick = () => void this.showEliteBoard(r.date, r.mode ?? 'easy');
    this.root.querySelector<HTMLButtonElement>('#elite-menu')!.onclick = () => this.onMenu();
  }

  /** Elite Four board. A day: furthest first, then Pokémon left, then fewest turns.
   *  All time: most Champion wins, then furthest reached, then runs played. */
  async showEliteBoard(when: string, mode: 'easy' | 'hard' = 'easy') {
    const lvl = mode === 'hard' ? 'elite-hard' : 'elite';
    const all = when === 'all';
    const today = todayUTCString();
    const day = all ? today : when;
    const ago = Math.round((Date.parse(today) - Date.parse(day)) / 864e5);
    const first = day <= '2026-10-17'; // the Elite Four opened on this day
    const label = ago === 0 ? 'Today' : ago === 1 ? 'Yesterday' : `${ago} days ago`;
    const nice = new Date(day + 'T00:00:00Z').toLocaleDateString(undefined, {month: 'short', day: 'numeric', timeZone: 'UTC'});
    this.openPage('board', `
      <section class="board-head"><p class="eyebrow eyebrow-dark" style="color:#6b3fd0">Elite Four</p>
        <h1 class="page-title">${all ? 'All-time Champions' : ago === 0 ? 'Today’s League' : `The League · ${label.toLowerCase()}`}</h1></section>
      <div class="board-controls">
        <div class="seg seg-levels" role="tablist" aria-label="Board">
          ${LEVELS.map(l => `<button role="tab" data-level="${l}" aria-selected="false">${LEVEL_TEXT[l]}</button>`).join('')}
          <button role="tab" class="tab-elite" aria-selected="true">Elite Four</button>
        </div>
        <div class="when">
          <div class="day-nav ${all ? 'is-off' : ''}" role="group" aria-label="Day">
            <button class="day-arrow" id="day-prev" aria-label="Earlier day" ${!all && first ? 'disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
            <button class="day-label" id="day-pick" aria-pressed="${!all}">
              <b>${all ? 'Daily' : label}</b><small>${all ? 'pick a day' : `Day #${dayNumberOf(day)} · ${nice}`}</small>
            </button>
            <button class="day-arrow" id="day-next" aria-label="Later day" ${all || ago === 0 ? 'disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
          </div>
          <button class="all-time" id="all-time" aria-pressed="${all}">All time</button>
        </div>
        <div class="seg e4-seg" role="tablist" aria-label="Difficulty">
          <button role="tab" data-e4="easy" aria-selected="${mode === 'easy'}">Easy</button><button role="tab" data-e4="hard" aria-selected="${mode === 'hard'}">Hard</button>
        </div>
      </div>
      <section class="mode board"><ol class="board-list" id="elite-list"><li class="board-empty small">Loading…</li></ol>
        <p class="board-foot">${all ? 'Ranked by Champion wins, then furthest room reached, then fewest items in their best run.' : 'Ranked by rooms cleared, then fewest items used, then Pokémon left, then fewest turns.'} Tap a trainer to see their run.</p></section>`);
    this.root.querySelectorAll<HTMLButtonElement>('.seg-levels [data-level]').forEach(b => {
      b.onclick = () => this.showBoard(b.dataset.level as Level, all ? 'all' : day);
    });
    const shift = (d: number) => new Date(Date.parse(day) + d * 864e5).toISOString().slice(0, 10);
    this.root.querySelector<HTMLButtonElement>('#day-prev')!.onclick = () => void this.showEliteBoard(all ? today : shift(-1), mode);
    this.root.querySelector<HTMLButtonElement>('#day-next')!.onclick = () => void this.showEliteBoard(shift(1), mode);
    this.root.querySelector<HTMLButtonElement>('#day-pick')!.onclick = () => void this.showEliteBoard(day, mode);
    this.root.querySelector<HTMLButtonElement>('#all-time')!.onclick = () => void this.showEliteBoard('all', mode);
    this.root.querySelectorAll<HTMLButtonElement>('[data-e4]').forEach(b => { b.onclick = () => void this.showEliteBoard(when, b.dataset.e4 as 'easy' | 'hard'); });
    const ol = this.root.querySelector<HTMLElement>('#elite-list')!;
    type Row = {id: number; name: string; stage: number; won: boolean; mons_left: number; turns: number; items_used: number | null; day: string};
    let rows: Row[] = [];
    try {
      const q = all ? `level=eq.${lvl}&select=id&limit=1` : `day=eq.${day}&level=eq.${lvl}&order=stage.desc,items_used.asc.nullslast,mons_left.desc,turns.asc,created_at.asc&limit=100`;
      rows = await fetch(`${SUPABASE_URL}/rest/v1/results?${q}&select=id,name,stage,won,mons_left,turns,items_used,day`,
        {headers: {apikey: SUPABASE_KEY}}).then(r => r.json());
    } catch { /* offline */ }
    if (!ol.isConnected) return;
    if (!Array.isArray(rows)) rows = [];
    const me = currentUser()?.username.toLowerCase();
    const reached = (st: number) => (st >= 5 ? 'Champion 👑' : `Reached ${ELITE_NAMES[st][0] + ELITE_NAMES[st].slice(1).toLowerCase()}`);
    const items = (n: number | null) => (n != null ? ` · ${n} ${n === 1 ? 'item' : 'items'}` : '');
    if (all) {
      // Added up on the server (alltime_elite, refreshed every 10 minutes).
      const agg: {name: string; wins: number; best: number; runs: number; last_id: number; fewest: number | null}[] =
        await fetch(`${SUPABASE_URL}/rest/v1/alltime_elite?level=eq.${lvl}&select=name,wins,best,runs,last_id,fewest&limit=100000`, {headers: {apikey: SUPABASE_KEY}}).then(r => r.json()).catch(() => []);
      const by = new Map((Array.isArray(agg) ? agg : []).map(r => [r.name.toLowerCase(), {name: r.name, wins: r.wins, best: r.best, runs: r.runs, last: r.last_id, fewest: r.fewest ?? 999}]));
      const list = [...by.values()].sort((a, b) => b.wins - a.wins || b.best - a.best || a.fewest - b.fewest || b.runs - a.runs).slice(0, 100);
      ol.innerHTML = list.length ? list.map((a, i) => `
        <li><button class="board-row is-link ${a.name.toLowerCase() === me ? 'is-me' : ''}" data-run="${a.last}">
          <span class="rank">${i + 1}</span>
          <span class="who"><b>${esc(a.name)}</b><small>Best: ${a.best >= 5 ? 'Champion 👑' : reached(a.best).replace('Reached ', '')}</small></span>
          <span class="score"><b>${a.wins}× 👑</b><small>${a.runs} ${a.runs === 1 ? 'run' : 'runs'}${a.fewest < 999 ? ` · best ${a.fewest} items` : ''}</small></span>
          <span class="chev" aria-hidden="true">›</span>
        </button></li>`).join('') : '<li class="board-empty">No finished runs yet. Be the first!</li>';
      ol.querySelectorAll<HTMLButtonElement>('[data-run]').forEach(b => {
        b.onclick = () => void this.showEliteEntry(Number(b.dataset.run), () => void this.showEliteBoard('all', mode));
      });
      return;
    }
    ol.innerHTML = rows.length ? rows.map((r, i) => `
      <li><button class="board-row is-link ${r.name.toLowerCase() === me ? 'is-me' : ''}" data-run="${r.id}">
        <span class="rank">${i + 1}</span>
        <span class="who"><b>${esc(r.name)}</b><small>${reached(r.stage ?? 0)}</small></span>
        <span class="score"><b>${r.mons_left}/6 · ${r.turns} turns</b><small>${items(r.items_used).replace(' · ', '')}</small></span>
        <span class="chev" aria-hidden="true">›</span>
      </button></li>`).join('') : `<li class="board-empty">${ago === 0 ? 'No finished runs yet today. Be the first!' : 'No Elite Four runs that day.'}</li>`;
    ol.querySelectorAll<HTMLButtonElement>('[data-run]').forEach(b => {
      b.onclick = () => void this.showEliteEntry(Number(b.dataset.run), () => void this.showEliteBoard(when, mode));
    });
  }

  /** One Elite Four run: how far they got, each room, their team with moves, and the items they took and used. */
  async showEliteEntry(id: number, back: () => void) {
    this.openPage('results', `<section class="mode board"><p class="board-empty">Loading run…</p></section>`);
    const setBack = () => {
      const btn = this.root.querySelector<HTMLButtonElement>('#page-back');
      if (!btn) return;
      btn.onclick = back;
      btn.querySelector('span')!.textContent = 'Leaderboard';
    };
    setBack();
    let d: EliteEntry;
    try { d = await fetchEliteEntry(id); } catch (e) {
      const el = this.root.querySelector('.board');
      if (el) el.innerHTML = `<p class="board-empty">${esc((e as Error).message)}</p>`;
      return;
    }
    if (this.page !== 'results') return;
    const isMe = currentUser()?.username.toLowerCase() === d.name.toLowerCase();
    const cc = (await fetchFlags())[d.name.toLowerCase()];
    const cap = (n: string) => n[0] + n.slice(1).toLowerCase();
    const typeBadge = (t: string) => `<img class="tbadge" src="${import.meta.env.BASE_URL}types/${t}.png" alt="${t}" title="${t}">`;
    const reachedName = d.stage >= 5 ? 'Champion' : cap(ELITE_NAMES[d.stage]);
    const nice = new Date(d.day + 'T00:00:00Z').toLocaleDateString(undefined, {month: 'short', day: 'numeric', timeZone: 'UTC'});
    const rooms = ELITE_NAMES.map((n, i) => {
      const r = d.rooms[i];
      const state = !r ? 'not reached' : r.won ? `Won · ${r.turns} turns · ${r.left}/6 left` : `Lost · ${r.turns} turns · they had ${r.foeLeft} left`;
      return `<li class="er-room ${!r ? 'is-off' : r.won ? 'is-won' : 'is-lost'}"><span class="er-dot">${!r ? '–' : r.won ? '✓' : '✕'}</span>
        <b>${i === 4 ? 'Champion Blue' : cap(n)}</b><small>${state}</small></li>`;
    }).join('');
    const mons = d.team.map(m => `
        <section class="mode td-mon">
          <div class="td-head"><img src="${aniUrl(m.species)}" alt="">
            <div><h3>${esc(SPECIES[m.species]?.name ?? m.species)}</h3><span class="td-types">Lv 100 ${(SPECIES[m.species]?.types ?? []).map(typeBadge).join('')}</span>
              <small class="td-hp">${m.hp === 0 ? 'Fainted' : `${m.hp}% HP at the end`}</small></div></div>
          <ul class="td-moves">${m.moves.map(mid => {
            const mv = MOVES[mid];
            if (!mv) return '';
            return `<li><div class="td-move-top"><i style="background:${TYPE_COLORS[mv.type] ?? '#999'}"></i><b>${esc(mv.name)}</b>
              <span>${mv.type} · ${powerLabel(mid) === '-' ? 'Status move' : `Pwr ${powerLabel(mid)}`}${mv.acc ? ` · Acc ${mv.acc}%` : ''} · PP ${mv.pp}</span></div></li>`;
          }).join('')}</ul>
        </section>`).join('');
    const itemRows = Object.keys({...d.bag, ...d.used}).map(it => `<tr><th>${esc(it)}</th><td>${d.bag[it] ?? 0}</td><td>${d.used[it] ?? 0}</td></tr>`).join('');
    this.openPage('results', `
      <section class="result-hero ${d.won ? 'is-won' : 'is-lost'} is-elite">
        <p class="eyebrow"><button class="who-link" data-player="${esc(d.name)}">${esc(d.name)}${cc ? ' ' + flag(cc) : ''}${isMe ? ' (you)' : ''} ›</button> · Elite Four ${d.mode === 'hard' ? 'Hard' : 'Easy'} · Day #${d.dayNumber} · ${nice}</p>
        <h1>${d.won ? 'Champion 👑' : `Reached ${reachedName}`}</h1>
        <p class="result-sub">${d.won ? `${esc(d.name)} beat all five with ${d.left} of 6 Pokémon left.` : `${esc(d.name)} cleared ${d.stage} of 5 rooms.`}</p>
        <div class="result-facts">
          <div><b>${d.stage}<small>/5</small></b><span>Rooms</span></div>
          <div><b>${d.turns}</b><span>Turns</span></div>
          <div><b>${d.itemsUsed}</b><span>Items used</span></div>
        </div>
      </section>
      <section class="mode result-team"><h3>The run</h3><ol class="er-rooms">${rooms}</ol></section>
      <section class="mode result-team"><h3>${esc(d.name)}’s team</h3>
        <ul class="team-grid er-team">${d.team.map((m, k) => `
          <li class="mon mon-${m.hp === 0 ? 'fainted' : m.hp > 50 ? 'good' : m.hp > 20 ? 'mid' : 'low'}"><button class="er-pick" data-mon="${k}" aria-expanded="false">
            <div class="mon-pic"><img src="${aniUrl(m.species)}" alt="" loading="lazy"></div>
            <span class="mon-name">${esc(SPECIES[m.species]?.name ?? m.species)}</span>
            <span class="mon-bar"><i style="width:${m.hp}%"></i></span>
            <span class="mon-hp">${m.hp === 0 ? 'Fainted' : `${m.hp}% HP`}</span></button></li>`).join('')}</ul>
        <p class="friends-soon er-hint">Tap a Pokémon to see its moves.</p>
        <div class="er-detail" hidden></div>
      </section>
      <section class="mode result-team"><h3>Items</h3>${itemRows
        ? `<div class="table-wrap plain"><table class="diff"><thead><tr><th></th><th>Took</th><th>Used</th></tr></thead><tbody>${itemRows}</tbody></table></div>`
        : '<p class="friends-soon">No items taken.</p>'}</section>
      <section class="mode result-stats"><h3>${esc(d.name)}’s Elite Four record</h3>
        <div class="overview">
          <div><b>${d.record.runs}</b><span>Runs</span></div>
          <div><b>${d.record.champion}</b><span>Champion</span></div>
          <div><b>${d.record.best >= 5 ? '👑' : cap(ELITE_NAMES[d.record.best])}</b><span>Best</span></div>
        </div></section>`);
    setBack();
    this.bindWhoLink(() => void this.showEliteEntry(id, back));
    // Tap a Pokémon: its moves open below the team (tap again to close).
    const cards = mons.split('<section class="mode td-mon">').slice(1).map(c => '<div class="td-mon">' + c.replace(/<\/section>\s*$/, '</div>'));
    const detail = this.root.querySelector<HTMLElement>('.er-detail')!;
    this.root.querySelectorAll<HTMLButtonElement>('.er-pick').forEach(b => {
      b.onclick = () => {
        const open = b.getAttribute('aria-expanded') === 'true';
        this.root.querySelectorAll('.er-pick').forEach(x => x.setAttribute('aria-expanded', 'false'));
        detail.hidden = open;
        if (!open) {
          b.setAttribute('aria-expanded', 'true');
          detail.innerHTML = cards[Number(b.dataset.mon)];
        }
      };
    });
  }

  /** Works out your badges and shows the ones you haven't seen yet, all together in one pop-up.
   *  The first time it runs, that includes everything already earned from past results. */
  private badgeCheck: Promise<void> | null = null;
  async checkNewBadges() {
    // One check at a time (login sync and a just-finished battle can both ask at once).
    if (!this.badgeCheck) this.badgeCheck = this.runBadgeCheck().finally(() => { this.badgeCheck = null; });
    return this.badgeCheck;
  }
  private async runBadgeCheck() {
    const user = currentUser();
    if (!user) return;
    let duels = 0, duelWins = 0;
    try { const m = (await this.listMatches()).filter(r => r.stage === 'done'); duels = m.length; duelWins = m.filter(r => r.won).length; } catch { /* offline */ }
    this.myBadgeStats = await badgeStats(user.username, {friends: getFriends().length, duels, duelWins});
    // Badges already shown are remembered in the account (every device and both sites), plus this browser.
    const key = `pokebattles:badges-seen:${user.id}`;
    let local: string[] = [];
    try { local = JSON.parse(localStorage.getItem(key) ?? '[]'); } catch { /* ignore */ }
    const seen = new Set([...local, ...(currentUser()?.badgesSeen ?? [])]);
    const fresh = earned(this.myBadgeStats).filter(x => !seen.has(x.id));
    if (!fresh.length) return;
    const all = [...seen, ...fresh.map(x => x.id)];
    try { localStorage.setItem(key, JSON.stringify(all)); } catch { /* ignore */ }
    try { await setProfileData({badgesSeen: all}); } catch { /* offline: this browser still remembers */ }
    this.showBadgePopup(fresh.map(x => x.id));
  }

  /** One pop-up for every new badge (never one per badge). */
  showBadgePopup(ids: string[]) {
    const list = ids.map(id => BADGES.find(x => x.id === id)).filter((x): x is typeof BADGES[number] => !!x);
    if (!list.length) return;
    document.getElementById('badge-pop')?.remove();
    const pop = document.createElement('div');
    pop.id = 'badge-pop';
    pop.innerHTML = `<div class="bp-card" role="dialog" aria-label="New badges">
      <div class="bp-shine"></div>
      <p class="bp-eyebrow">${list.length === 1 ? 'New badge!' : `${list.length} new badges!`}</p>
      <h2>${list.length === 1 ? list[0].name : 'Look what you’ve earned'}</h2>
      <div class="bp-grid ${list.length === 1 ? 'one' : ''}">${list.map((x, k) => `<div class="bp-b" style="animation-delay:${Math.min(k, 12) * 70}ms">${badgeHtml(x, list.length === 1 ? 96 : 60)}<b>${x.name}</b><small>${x.desc}</small></div>`).join('')}</div>
      <div class="bp-actions"><button class="bp-main" id="bp-show">Show them on my profile</button><button class="bp-quiet" id="bp-ok">Nice!</button></div>
    </div>`;
    document.body.appendChild(pop);
    audio.sfx('blip');
    const close = () => pop.remove();
    pop.querySelector<HTMLButtonElement>('#bp-ok')!.onclick = close;
    pop.querySelector<HTMLButtonElement>('#bp-show')!.onclick = () => { close(); void this.showBadges(); };
    pop.onclick = e => { if (e.target === pop) close(); };
  }

  /** First-visit guide: three cards (daily Red, Elite Four, friends). Also opened from "How to play" in the footer. */
  showTutorial(start = 0) {
    const B = import.meta.env.BASE_URL;
    const steps = [
      {pic: `<img src="${B}sprites/trainers/red-hd.png" alt="">`, color: '#e3262e', title: 'Beat Red every day',
        text: 'A new battle against Red’s legendary Lv 100 team every day. <b>Easy</b>: build your own team. <b>Medium</b> and <b>Hard</b>: battle with a random strong team. One try each, then share your result.'},
      {pic: `<img src="${B}sprites/trainers/e4-lorelei.png" alt=""><img src="${B}sprites/trainers/e4-lance.png" alt="">`, color: '#6b3fd0', title: 'Take on the Elite Four',
        text: 'Five battles in a row, ending with Champion Blue. HP and PP carry over, so only your items heal you. Fewest items used ranks highest.'},
      {pic: `<img src="${B}sprites/trainers/t-misty.png" alt=""><img src="${B}sprites/trainers/t-brock.png" alt="">`, color: '#2f6fe0', title: 'Battle your friends',
        text: 'Create a free account to challenge friends to live battles, climb the leaderboard and earn badges.'},
    ];
    let k = start;
    document.getElementById('tut-pop')?.remove();
    const pop = document.createElement('div');
    pop.id = 'tut-pop';
    const close = () => pop.remove();
    try { localStorage.setItem('pokebattles:tutorial', '1'); } catch { /* ignore */ } // seen once it opens, even if the page is closed
    const draw = () => {
      const st = steps[k];
      pop.innerHTML = `<div class="tut-card" role="dialog" aria-label="How to play">
        <button class="tut-skip" id="tut-skip">Skip</button>
        <div class="tut-pic" style="--c:${st.color}">${st.pic}</div>
        <p class="tut-step" style="color:${st.color}">Step ${k + 1} of ${steps.length}</p>
        <h2>${st.title}</h2>
        <p class="tut-text">${st.text}</p>
        <div class="tut-dots">${steps.map((_, j) => `<i class="${j === k ? 'on' : ''}"></i>`).join('')}</div>
        <div class="tut-actions">${k > 0 ? '<button class="tut-back" id="tut-back">Back</button>' : ''}
          <button class="tut-next" id="tut-next">${k === steps.length - 1 ? 'Let’s battle!' : 'Next'}</button></div>
      </div>`;
      pop.querySelector<HTMLButtonElement>('#tut-skip')!.onclick = close;
      pop.querySelector<HTMLButtonElement>('#tut-next')!.onclick = () => { if (k === steps.length - 1) close(); else { k++; draw(); } };
      const bk = pop.querySelector<HTMLButtonElement>('#tut-back');
      if (bk) bk.onclick = () => { k--; draw(); };
    };
    draw();
    document.body.appendChild(pop);
  }

  private myBadgeStats: BadgeStats | null = null;
  /** All badges: earned ones in colour (tap to show up to 4 on your profile), locked ones grey with progress. */
  async showBadges() {
    const user = currentUser();
    const back = () => { this.onMenu(); this.openSheet(); };
    if (!user) { this.openSheet(); return; }
    this.openPage('results', `<section class="board-head"><p class="eyebrow eyebrow-dark">Badges</p><h1 class="page-title">Your badges</h1></section>
      <section class="mode result-team"><p class="board-empty small">Counting your badges…</p></section>`, 'Profile', back);
    if (!this.myBadgeStats) {
      let duels = 0, duelWins = 0;
      try { const m = (await this.listMatches()).filter(r => r.stage === 'done'); duels = m.length; duelWins = m.filter(r => r.won).length; } catch { /* offline */ }
      this.myBadgeStats = await badgeStats(user.username, {friends: getFriends().length, duels, duelWins});
    }
    const st = this.myBadgeStats;
    const have = new Set(earned(st).map(x => x.id));
    let on = (currentUser()?.badges ?? []).filter(id => have.has(id)).slice(0, 4);
    const render = (note = '') => {
      if (this.page !== 'results') return;
      const slots = Array.from({length: 4}, (_, k) => on[k] ? badgeHtml(BADGES.find(x => x.id === on[k])!, 56) : '<span class="bdg-slot"></span>').join('');
      const cats = (Object.keys(CAT_INFO) as Cat[]).map(cat => `
        <section class="mode result-team"><h3 style="color:${CAT_INFO[cat].c2}">${CAT_INFO[cat].name}</h3>
          <div class="bdg-grid">${BADGES.filter(x => x.cat === cat).map(x => {
            const got = have.has(x.id), n = Math.min(st[x.stat], x.need);
            return `<button class="bdg-card ${got ? 'got' : ''} ${on.includes(x.id) ? 'is-on' : ''}" data-b="${x.id}" ${got ? '' : 'disabled'}>
              ${badgeHtml(x, 58, !got)}<b>${x.name}</b><small>${x.desc}</small>
              ${got ? `<em>${on.includes(x.id) ? 'On profile ✓' : TIER_NAME[x.tier]}</em>` : `<span class="bdg-prog"><i style="width:${Math.round((n / x.need) * 100)}%"></i></span><em>${n}/${x.need}</em>`}
            </button>`;
          }).join('')}</div></section>`).join('');
      const host = this.root.querySelector<HTMLElement>('.board-head')!.parentElement!;
      host.querySelectorAll('section.mode').forEach(el => el.remove());
      host.insertAdjacentHTML('beforeend', `
        <section class="mode result-team bdg-equip"><h3>On your profile <small>${on.length}/4</small></h3>
          <div class="bdg-slots">${slots}</div>
          <p class="fine">${note || `You've earned ${have.size} of ${BADGES.length}. Tap an earned badge to show it (up to 4). They appear on your profile and in friend-battle lobbies. New results count within about 10 minutes.`}</p></section>${cats}`);
      host.querySelectorAll<HTMLButtonElement>('.bdg-card.got').forEach(btn => {
        btn.onclick = async () => {
          const id = btn.dataset.b!;
          if (on.includes(id)) on = on.filter(x => x !== id);
          else if (on.length >= 4) return render('You can show 4 badges. Tap one that’s on your profile to take it off first.');
          else on = [...on, id];
          render('Saving…');
          try { await setProfileData({badges: on}); void fetchBadges(true); render('Saved.'); } catch (e) { render((e as Error).message); }
        };
      });
    };
    render();
  }

  private soonCard(icon: keyof typeof ICONS, title: string, desc: string) {
    return `
      <section class="mode mode-soon" aria-disabled="true">
        <div class="soon-icon">${ICONS[icon]}</div>
        <div class="soon-body">
          <h3>${title}</h3>
          <p class="mode-desc">${desc}</p>
        </div>
        <span class="soon-pill">Coming soon</span>
      </section>`;
  }

  private renderSoundButton() {
    const b = this.root.querySelector<HTMLButtonElement>('#home-sound');
    if (!b) return;
    b.innerHTML = audio.muted ? ICONS.muted : ICONS.sound;
    b.setAttribute('aria-label', audio.muted ? 'Sound off. Turn on' : 'Sound on. Turn off');
    b.onclick = () => { audio.unlock(); audio.toggleMute(); };
  }

  /** The 24-hour clock: the ring empties as the day runs out (new team at midnight UTC). */
  private tickClock() {
    const now = new Date();
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const left = Math.max(0, Math.floor((next - now.getTime()) / 1000));
    const t = this.root.querySelector('#clock-time'), s = this.root.querySelector('#clock-sec');
    if (t) t.textContent = `${pad(Math.floor(left / 3600))}:${pad(Math.floor((left % 3600) / 60))}`;
    if (s) s.textContent = `${pad(left % 60)}s`;
    const fill = this.root.querySelector<SVGCircleElement>('.clock-fill');
    if (fill) fill.style.strokeDashoffset = String(1000 - (left / 86400) * 1000);
  }

  // ---------- profile panel ----------

  private openSheet(reason = '', guestLabel = '') {
    this.sheet.dataset.reason = reason;
    this.sheet.dataset.guest = guestLabel;
    this.sheet.hidden = false;
    document.body.classList.add('sheet-open');
    this.renderSheet();
    (this.sheet.querySelector('input, button') as HTMLElement | null)?.focus();
  }

  private closeSheet(answer = true) {
    if (this.sheet.hidden) return;
    this.sheet.hidden = true;
    document.body.classList.remove('sheet-open');
    if (answer) this.resolveWaiters(!!currentUser());
  }

  private resolveWaiters(ok: boolean) {
    const w = this.accountWaiters;
    this.accountWaiters = [];
    w.forEach(fn => fn(ok));
  }

  private renderSheet() {
    const user = currentUser();
    const reason = this.sheet.dataset.reason ?? '';
    const stats = this.info?.stats;
    this.sheet.innerHTML = `
      <div class="sheet-backdrop" data-close></div>
      <div class="sheet-panel">
        <div class="sheet-head">
          <div class="avatar big">${user ? `<span>${esc(user.username.slice(0, 1).toUpperCase())}</span>` : ICONS.person}</div>
          <div class="sheet-who">
            <h2>${user ? esc(user.username) : 'Guest'}</h2>
            <p>${user ? esc(user.email) : 'Stats are saved in this browser.'}</p>
          </div>
          <button class="icon-btn" data-close aria-label="Close">${ICONS.close}</button>
        </div>
        ${user ? `<section class="sheet-badges"><div class="sb-head"><h3 class="sheet-sub">Badges</h3><button class="sb-all" id="sheet-badges">All badges ›</button></div>
          ${equippedHtml(user.badges, 44) || '<p class="fine">Earn badges by beating Red, the Elite Four and your friends. Pick up to 4 to show on your profile.</p>'}</section>` : ''}
        ${stats && (user || !reason) ? this.statsHtml(stats) : ''}
        ${user || !reason ? this.trainerPickerHtml() : ''}
        ${user || !reason ? this.savedTeamsHtml() : ''}
        ${user ? '<section class="notif" id="notif"><h3>Notifications</h3><p class="fine">Checking…</p></section>' : ''}
        <div class="account ${!user && reason ? 'first' : ''}">
          ${user ? `<form class="rename" id="rename">
              <label for="new-name">Username</label>
              <div class="add-row"><input id="new-name" value="${esc(user.username)}" maxlength="10" autocomplete="off" spellcheck="false"><button class="btn-light" type="submit">Change</button></div>
              <p class="fine" id="rename-note">3 to 10 letters, numbers or _. You can change it once a week; your leaderboard results and friends come with you.</p>
            </form>
            ${this.countrySelect('my-country', user.country)}<p class="fine" id="country-note">Your flag shows next to your name on the leaderboard.</p>
            <button class="btn-main" id="sheet-invite">Invite friends</button>
            <button class="btn-quiet" id="sheet-friends">My friends${getFriends().length ? ` (${getFriends().length})` : ''}</button>
            ${user.username.toLowerCase() === 'aryanv' ? '<button class="btn-quiet" id="sheet-admin">Site stats (only you see this)</button>' : ''}
            <button class="btn-quiet" id="logout">Log out</button>` : this.formHtml(reason)}
        </div>
      </div>`;
    this.sheet.querySelectorAll<HTMLElement>('[data-close]').forEach(el => { el.onclick = () => this.closeSheet(); });
    const allB = this.sheet.querySelector<HTMLButtonElement>('#sheet-badges');
    if (allB) allB.onclick = () => { this.closeSheet(false); void this.showBadges(); };
    const adm = this.sheet.querySelector<HTMLButtonElement>('#sheet-admin');
    if (adm) adm.onclick = () => { this.closeSheet(false); this.onAdmin(); };
    const rn = this.sheet.querySelector<HTMLFormElement>('#rename');
    if (rn) rn.onsubmit = async e => {
      e.preventDefault();
      const note = this.sheet.querySelector<HTMLElement>('#rename-note')!;
      const name = this.sheet.querySelector<HTMLInputElement>('#new-name')!.value.trim();
      if (name === currentUser()?.username) { note.textContent = 'That’s already your username.'; return; }
      const btn = rn.querySelector<HTMLButtonElement>('button')!;
      btn.disabled = true;
      note.textContent = 'Saving…';
      try {
        const done = await changeUsername(name);
        this.renderSheet();
        this.sheet.querySelector<HTMLElement>('#rename-note')!.textContent = `Done! You’re now ${done}.`;
      } catch (ex) {
        note.textContent = (ex as Error).message;
        btn.disabled = false;
      }
    };
    this.sheet.querySelectorAll<HTMLButtonElement>('[data-open-team]').forEach(b => {
      b.onclick = () => { this.closeSheet(false); this.showTeam(b.dataset.openTeam!); };
    });
    const out = this.sheet.querySelector<HTMLButtonElement>('#logout');
    if (out) out.onclick = () => logOut();
    const sInv = this.sheet.querySelector<HTMLButtonElement>('#sheet-invite');
    if (sInv) sInv.onclick = async () => {
      const msg = await shareInvite();
      sInv.textContent = msg;
      setTimeout(() => { sInv.textContent = 'Invite friends'; }, 2500);
    };
    const sFr = this.sheet.querySelector<HTMLButtonElement>('#sheet-friends');
    if (sFr) sFr.onclick = () => { this.closeSheet(false); this.showFriends(); };
    const mine = this.sheet.querySelector<HTMLSelectElement>('#my-country');
    if (mine) mine.onchange = async () => {
      const note = this.sheet.querySelector<HTMLElement>('#country-note')!;
      note.textContent = 'Saving…';
      try {
        await setCountry(mine.value);
        void fetchFlags(true);
      } catch (e) {
        note.textContent = (e as Error).message;
      }
    };
    this.sheet.querySelectorAll<HTMLButtonElement>('[data-trainer]').forEach(b => {
      b.onclick = async () => {
        this.sheet.querySelectorAll('[data-trainer]').forEach(x => x.classList.toggle('on', x === b));
        const note = this.sheet.querySelector<HTMLElement>('#trainer-note')!;
        note.textContent = 'Saving…';
        try { await setMyTrainer(b.dataset.trainer!); void fetchTrainers(true); note.textContent = `${b.title} it is! You’ll see them in your next friend battle.`; }
        catch (e) { note.textContent = (e as Error).message; }
      };
    });
    if (!user) this.bindForm();
    else void this.renderNotif();
  }

  /** Profile panel: turn phone notifications on/off and choose which ones. */
  private async renderNotif() {
    const box = this.sheet.querySelector<HTMLElement>('#notif');
    if (!box) return;
    const kinds: [keyof Prefs, string, string][] = [
      ['challenge', 'Friend challenges', 'When a friend challenges you to a battle'],
      ['daily', 'New island', 'Each morning when the new team is ready'],
      ['streak', 'Streak reminder', 'In the evening, if you haven’t played and have a streak going'],
    ];
    const support = pushSupport();
    if (support === 'ios-install') {
      box.innerHTML = `<h3>Notifications</h3><p class="fine">On iPhone, notifications only work from the home screen app: tap <b>Share</b> → <b>Add to Home Screen</b>, open DailyBattles from there, then turn them on here.</p>`;
      return;
    }
    if (support !== 'ok') {
      box.innerHTML = `<h3>Notifications</h3><p class="fine">${support === 'denied' ? 'Notifications are blocked for this site. Allow them in your phone or browser settings, then come back here.' : 'This browser can’t show notifications.'}</p>`;
      return;
    }
    let st: Awaited<ReturnType<typeof pushStatus>>;
    try { st = await pushStatus(); } catch (e) { box.innerHTML = `<h3>Notifications</h3><p class="fine">${esc((e as Error).message)}</p>`; return; }
    const draw = (on: boolean, prefs: Prefs, note = '') => {
      box.innerHTML = `<div class="notif-head"><h3>Notifications</h3>
          <button class="${on ? 'btn-quiet' : 'btn-main'} notif-main" id="notif-toggle">${on ? 'Turn off' : 'Turn on'}</button></div>
        ${on ? `<div class="notif-list">${kinds.map(([k, t, d]) => `<label class="tog notif-tog"><input type="checkbox" data-pref="${k}" ${prefs[k] ? 'checked' : ''}><span><b>${t}</b><small>${d}</small></span></label>`).join('')}</div>`
          : '<p class="fine">Get a ping when a friend challenges you, when the new island is ready, and before you lose your streak.</p>'}
        <p class="fine" id="notif-note">${note}</p>`;
      const note2 = box.querySelector<HTMLElement>('#notif-note')!;
      box.querySelector<HTMLButtonElement>('#notif-toggle')!.onclick = async () => {
        note2.textContent = on ? 'Turning off…' : 'Turning on…';
        try {
          if (on) { await disablePush(); draw(false, prefs, 'Notifications are off on this device.'); }
          else draw(true, await enablePush(), 'Notifications are on! You can choose which ones below.');
        } catch (e) { note2.textContent = (e as Error).message; }
      };
      box.querySelectorAll<HTMLInputElement>('[data-pref]').forEach(c => {
        c.onchange = async () => {
          try { prefs = await setPushPrefs({[c.dataset.pref!]: c.checked}); note2.textContent = 'Saved.'; }
          catch (e) { note2.textContent = (e as Error).message; c.checked = !c.checked; }
        };
      });
    };
    draw(st.on, st.prefs);
  }

  /** Grid of trainer pictures to choose from (shown in battles, and to friends in friend battles). */
  private trainerPickerHtml() {
    const mine = myTrainer();
    return `<section class="trainer-pick">
      <h3>Your trainer</h3>
      <div class="trainer-grid">${TRAINERS.map(t => `<button class="${t.id === mine ? 'on' : ''}" data-trainer="${t.id}" title="${esc(t.name)}" aria-label="${esc(t.name)}">
        <img src="${trainerUrl(t.id)}" alt="" loading="lazy"><span>${esc(t.name)}</span></button>`).join('')}</div>
      <p class="fine" id="trainer-note">${currentUser() ? 'Shown in friend battles and next to your name on the leaderboard.' : 'Saved in this browser. Create an account to use it in friend battles and on the leaderboard.'}</p>
    </section>`;
  }

  private statsHtml(stats: Record<Level, Stats>) {
    const days = new Set<string>(), wonDays = new Set<string>();
    for (const l of LEVELS) for (const [d, r] of Object.entries(stats[l].history)) {
      days.add(d);
      if (r.won) wonDays.add(d);
    }
    const totalPlayed = LEVELS.reduce((n, l) => n + stats[l].played, 0);
    const totalWins = LEVELS.reduce((n, l) => n + stats[l].wins, 0);
    const best = Math.max(...LEVELS.map(l => stats[l].maxStreak));
    const pct = (w: number, p: number) => (p ? `${Math.round((w / p) * 100)}%` : '–');
    // The last 7 days (UTC), one square per difficulty.
    const today = Date.parse(new Date().toISOString().slice(0, 10));
    const week = Array.from({length: 7}, (_, i) => new Date(today - (6 - i) * 864e5).toISOString().slice(0, 10));
    const cell = (l: Level, d: string) => {
      const r = stats[l].history[d];
      return `<i class="sq ${r ? (r.won ? 'sq-won' : 'sq-lost') : ''}" title="${LEVEL_TEXT[l]} · ${d}: ${r ? (r.won ? 'won' : 'lost') : 'not played'}"></i>`;
    };
    return `
      <div class="overview">
        <div><b>${days.size}</b><span>Days played</span></div>
        <div><b>${wonDays.size}</b><span>Days won</span></div>
        <div><b>${pct(totalWins, totalPlayed)}</b><span>Win rate</span></div>
        <div><b>${best}</b><span>Best streak</span></div>
      </div>
      <h3 class="sheet-sub">By difficulty</h3>
      <div class="table-wrap"><table class="diff">
        <thead><tr><th></th><th>Played</th><th>Won</th><th>Win %</th><th>Streak</th><th>Best</th></tr></thead>
        <tbody>${LEVELS.map(l => {
          const s = stats[l];
          return `<tr><th>${LEVEL_TEXT[l]}</th><td>${s.played}</td><td>${s.wins}</td><td>${pct(s.wins, s.played)}</td><td>${s.streak}</td><td>${s.maxStreak}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
      <h3 class="sheet-sub">Last 7 days</h3>
      <div class="week">
        ${LEVELS.map(l => `<div class="week-row"><span>${LEVEL_TEXT[l]}</span>${week.map(d => cell(l, d)).join('')}</div>`).join('')}
        <div class="week-row week-days"><span></span>${week.map(d => `<em>${['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][new Date(d).getUTCDay()]}</em>`).join('')}</div>
      </div>
      <p class="legend"><i class="sq sq-won"></i> Won <i class="sq sq-lost"></i> Lost <i class="sq"></i> Not played</p>
      <h3 class="sheet-sub sub-elite">Elite Four</h3>
      <div id="elite-stats">${this.eliteStatsHtml(this.eliteHistory())}</div>${(setTimeout(() => void this.fillEliteStats(), 0), '')}`;
  }

  /** Elite Four stats: this device's runs, merged with the account's runs on the leaderboard (by day). */
  private async fillEliteStats() {
    const go = document.getElementById('sheet-elite');
    if (go) go.onclick = () => { this.closeSheet(); this.onElite(); };
    const user = currentUser();
    if (!user) return;
    let rows: {day: string; stage: number; won: boolean; turns: number; items_used: number | null}[] = [];
    try {
      rows = await fetch(`${SUPABASE_URL}/rest/v1/results?level=in.(elite,elite-hard)&name=ilike.${encodeURIComponent(user.username)}&select=day,stage,won,turns,items_used&limit=1000`,
        {headers: {apikey: SUPABASE_KEY}}).then(r => r.json());
    } catch { return; }
    if (!Array.isArray(rows)) return;
    const by = new Map(this.eliteHistory().map(r => [r.day, r]));
    for (const r of rows) by.set(r.day, {day: r.day, stage: r.stage ?? 0, won: r.won, turns: r.turns, items: r.items_used});
    const el = document.getElementById('elite-stats');
    if (el) el.innerHTML = this.eliteStatsHtml([...by.values()]);
  }

  private eliteStatsHtml(runs: EliteRecord[], own = true) {
    if (!runs.length) return own ? '<p class="friends-soon">No Elite Four runs yet. <button class="link" id="sheet-elite">Take them on →</button></p>' : '';
    const cap = (n: string) => n[0] + n.slice(1).toLowerCase();
    const champ = runs.filter(r => r.won).length;
    const best = Math.max(...runs.map(r => r.stage));
    const items = runs.filter(r => r.items != null);
    const avgItems = items.length ? Math.round(items.reduce((n, r) => n + (r.items ?? 0), 0) / items.length) : null;
    const reached = ELITE_NAMES.map((n, i) => {
      const k = runs.filter(r => r.stage >= i + 1).length;
      return `<tr><th>${i === 4 ? 'Beat Blue 👑' : `Beat ${cap(n)}`}</th><td>${k}</td><td>${Math.round((k / runs.length) * 100)}%</td></tr>`;
    }).join('');
    const recent = [...runs].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 7);
    return `
      <div class="overview">
        <div><b>${runs.length}</b><span>Runs</span></div>
        <div><b>${champ}</b><span>Champion</span></div>
        <div><b>${best >= 5 ? '👑' : cap(ELITE_NAMES[best])}</b><span>Best</span></div>
        <div><b>${avgItems ?? '–'}</b><span>Avg items</span></div>
      </div>
      <div class="table-wrap"><table class="diff">
        <thead><tr><th></th><th>Runs</th><th>%</th></tr></thead><tbody>${reached}</tbody>
      </table></div>
      <ul class="elite-recent">${recent.map(r => `<li data-day="${r.day}"><span>${new Date(r.day + 'T00:00:00Z').toLocaleDateString(undefined, {month: 'short', day: 'numeric', timeZone: 'UTC'})}</span>
        <b>${r.won ? 'Champion 👑' : `Reached ${cap(ELITE_NAMES[Math.min(r.stage, 4)])}`}</b><small>${r.turns} turns${r.items != null ? ` · ${r.items} items` : ''}</small></li>`).join('')}</ul>`;
  }

  /** Country dropdown (flag + name), with "Choose your country" when none is set. */
  private countrySelect(id: string, selected: string) {
    return `<label class="country">Country
      <select id="${id}">
        <option value="" ${selected ? '' : 'selected'}>Choose your country</option>
        ${COUNTRIES.map(c => `<option value="${c.code}" ${c.code === selected ? 'selected' : ''}>${flag(c.code)}  ${esc(c.name)}</option>`).join('')}
      </select></label>`;
  }

  private formHtml(reason: string) {
    const signup = this.formMode === 'signup';
    return `
      ${reason ? `<p class="reason">${esc(reason)}</p>` : ''}
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected="${signup}" data-mode="signup">Create account</button>
        <button role="tab" aria-selected="${!signup}" data-mode="login">Log in</button>
      </div>
      <form id="acct-form" novalidate>
        ${signup ? `<label>Username<input id="acct-user" name="username" autocomplete="username" maxlength="10" placeholder="3–10 letters or numbers" required></label>` : ''}
        ${signup ? this.countrySelect('acct-country', guessCountry()) : ''}
        <label>Email<input id="acct-email" name="email" type="email" autocomplete="email" required></label>
        <label>Password<input id="acct-pass" name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" placeholder="${signup ? 'At least 6 characters' : ''}" required></label>
        <label class="keep"><input type="checkbox" id="acct-keep" checked><span>Keep me logged in</span></label>
        <p class="form-error" id="acct-error" role="alert" hidden></p>
        <button class="btn-main" type="submit">${signup ? 'Create account' : 'Log in'}</button>
        ${signup ? '<p class="fine">Your username is shown on the leaderboard. Your email is never shown. By creating an account you agree to the <a href="terms.html" target="_blank">Terms</a> and <a href="privacy.html" target="_blank">Privacy Policy</a>.</p>' : ''}
        ${this.sheet.dataset.guest ? `<button type="button" class="btn-quiet" id="acct-guest">${esc(this.sheet.dataset.guest)}</button>` : ''}
      </form>`;
  }

  private bindForm() {
    const guest = this.sheet.querySelector<HTMLButtonElement>('#acct-guest');
    if (guest) guest.onclick = () => this.closeSheet();
    this.sheet.querySelectorAll<HTMLButtonElement>('.tabs button').forEach(b => {
      b.onclick = () => { this.formMode = b.dataset.mode as 'signup' | 'login'; this.renderSheet(); };
    });
    const form = this.sheet.querySelector<HTMLFormElement>('#acct-form');
    if (!form) return;
    form.onsubmit = async e => {
      e.preventDefault();
      const err = this.sheet.querySelector<HTMLElement>('#acct-error')!;
      const btn = form.querySelector<HTMLButtonElement>('.btn-main')!;
      const val = (id: string) => (this.sheet.querySelector<HTMLInputElement>(id)?.value ?? '').trim();
      const email = val('#acct-email'), password = this.sheet.querySelector<HTMLInputElement>('#acct-pass')!.value;
      err.hidden = true;
      btn.disabled = true;
      btn.textContent = this.formMode === 'signup' ? 'Creating…' : 'Logging in…';
      try {
        const keep = this.sheet.querySelector<HTMLInputElement>('#acct-keep')?.checked ?? true;
        if (this.formMode === 'signup') await signUp(email, password, val('#acct-user'), this.sheet.querySelector<HTMLSelectElement>('#acct-country')?.value ?? '', keep);
        else await logIn(email, password, keep);
        this.sheet.dataset.reason = '';
        this.resolveWaiters(true);
        if (this.visible) this.renderSheet();
        else this.closeSheet(false);
      } catch (ex) {
        err.textContent = (ex as Error).message;
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = this.formMode === 'signup' ? 'Create account' : 'Log in';
      }
    };
  }
}

/** Shares on phones (share sheet), copies on laptops. Returns a short note to show. */
async function shareOrCopy(text: string): Promise<string> {
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({text});
      return 'Shared!';
    }
    await navigator.clipboard.writeText(text);
    return 'Copied! Paste it anywhere.';
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok ? 'Copied! Paste it anywhere.' : 'Could not copy. Try again.';
  }
}

