import './style.css';
import {generateDay, todayUTC, LEVELS, EASY_OPTIONS, isV2, V2_FROM, type Level, type Day} from './engine/daily';
import type {PickedTeam} from './engine/pvp';
import {Battle, type Action} from './engine/battle';
import {Gfx} from './ui/gfx';
import {Input} from './ui/input';
import {BattleScene} from './ui/battleScene';
import {IslandScene, eliteRoom} from './ui/island';
import {ELITE, ELITE_OPTIONS, ELITE_RECOMMENDED, ELITE_LEVEL, eliteDay, eliteStartTeam, eliteHardTeam, carryOver, replayElite, type EliteRun, type EliteMode} from './engine/elite';
import type {Scene} from './ui/scene';
import {recordResult, resultOf, useStatsKey, loadStats, type Stats} from './stats';
import {submit, submittedFor, fetchMine, submitElite} from './leaderboard';
import {listLoadouts, updateLoadout} from './loadouts';
import {currentUser, onSessionChange} from './account';
import {configureProfile, loadProfile, saveProfileStats, captureInvite, acceptInvite, pendingInvite, pushEliteRun, pullEliteRun} from './profile';
import {Home, type LevelState, type EliteRecord} from './home';
import {initErrorReports} from './errors';
import {PvpScreens} from './pvp/screens';
import {PvpBattle} from './pvp/pvpBattle';
import {flag} from './countries';
import {initNetStatus} from './netStatus';
import {initPullRefresh} from './pullRefresh';
import {startActivityTracking} from './activity';
import {showAdmin} from './admin';
import {LOCAL, cancelMatch, listMatches, matchState, forfeit as forfeitMatch, whoAmI, myInvites, declineInvite} from './pvp/api';
import {DEFAULT_OPTIONS, startingMoves} from './engine/pvp';
import {audio} from './audio';
import {maybeShowInstall, registerServiceWorker} from './install';

registerServiceWorker();

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const wrapEl = document.getElementById('screen-wrap')!;

/** Sizes the 160×144 screen as big as it fits: edge to edge on laptops (no frame) and phones
 *  (phones keep room for the see-through buttons). */
function fit() {
  const timer = document.getElementById('timer')!;
  const touch = matchMedia('(pointer: coarse)').matches;
  let scale: number;
  if (touch) {
    const landscape = innerWidth > innerHeight;
    // Portrait: leave room under the screen for the buttons.
    const availH = landscape ? innerHeight : innerHeight - timer.getBoundingClientRect().height - 230;
    scale = Math.min(innerWidth / 160, availH / 144);
    wrapEl.style.padding = '0';
  } else {
    // Laptops: fill the window (the countdown bar sits above; the key help floats at the bottom).
    const timerH = timer.getBoundingClientRect().height + 8;
    scale = Math.max(1, Math.min(innerWidth / 160, (innerHeight - timerH - 8) / 144));
    wrapEl.style.padding = '0';
  }
  canvas.style.width = `${Math.floor(160 * scale)}px`;
  canvas.style.height = `${Math.floor(144 * scale)}px`;
  // Draw at the screen's real sharpness so text is smooth (pixel art still scales cleanly).
  gfxRef?.setResolution(Math.min(8, Math.max(2, Math.round(scale * (window.devicePixelRatio || 1)))));
}
let gfxRef: Gfx | null = null;
addEventListener('resize', fit);

// DEV builds (npm run dev, or the deploy-dev folder) roll a brand-new random island
// on every page load, save nothing, and keep the leaderboard switched off.
// Add ?live to the address to play the real daily game in a dev build.
const params = new URLSearchParams(location.search);
/** The loading screen (menu look) shown while the site starts and while a battle's pictures load. */
const loaderEl = () => document.getElementById('loader');
function showLoader(text = 'Loading…') {
  const el = loaderEl();
  if (!el) return;
  el.querySelector('#loader-text')!.textContent = text;
  el.classList.remove('gone');
}
function hideLoader() { loaderEl()?.classList.add('gone'); }

/** Home-screen icon and name: the test site and the owner's stats page get their own, so they're easy to tell apart. */
function setAppIdentity(kind: 'test' | 'stats') {
  const name = kind === 'test' ? 'DB Test' : 'DB Stats';
  const set = (sel: string, attr: string, val: string) => document.querySelector(sel)?.setAttribute(attr, val);
  set('link[rel="apple-touch-icon"]', 'href', `icons/icon-${kind}-180.png`);
  set('link[rel="icon"]', 'href', `icons/icon-${kind}-32.png`);
  set('link[rel="manifest"]', 'href', `manifest-${kind}.webmanifest`);
  set('meta[name="apple-mobile-web-app-title"]', 'content', name);
  set('meta[name="theme-color"]', 'content', kind === 'test' ? '#6b4fbb' : '#1d2133');
  if (kind === 'stats') document.title = 'DailyBattles stats';
}
const STATS_PAGE = location.pathname.endsWith('stats.html');
// The stats page lives at stats.html (its own home-screen app); the old ?admin address goes there.
if (!STATS_PAGE && new URLSearchParams(location.search).has('admin')) location.replace('stats.html');
if (STATS_PAGE || new URLSearchParams(location.search).has('admin')) setAppIdentity('stats');
else if (import.meta.env.VITE_DEV_BUILD === '1') setAppIdentity('test');

const DEV = (import.meta.env.DEV || import.meta.env.VITE_DEV_BUILD === '1') && !params.has('live');
// ?date=YYYY-MM-DD lets us test other days.
// Test builds always show the newest version of the game (even before it starts on the real site).
const date = params.get('date') ?? (DEV && todayUTC() < V2_FROM ? V2_FROM : todayUTC());
const seed = DEV ? `dev-${Date.now()}-${Math.random()}` : date;
const statsKey = (level: Level) => `${DEV ? 'pokebattles-dev' : 'pokebattles'}:stats:${level}`;

/** The bar above the screen: countdown to the next island (or the DEV notice). */
function startTimer() {
  const el = document.getElementById('timer')!;
  const p = (n: number) => String(n).padStart(2, '0');
  const tick = () => {
    if (document.body.classList.contains('pvp-battle')) return; // the friend battle shows its own turn status
    if (DEV) {
      el.textContent = 'DEV BUILD · NEW TEAM EVERY REFRESH';
      el.classList.add('dev');
      return;
    }
    if (todayUTC() !== date && !params.has('date')) {
      el.textContent = 'NEW ISLAND READY! TAP TO PLAY';
      el.classList.add('ready');
      el.onclick = () => location.reload();
      return;
    }
    const now = new Date();
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const t = Math.max(0, Math.floor((next - now.getTime()) / 1000));
    el.textContent = `NEXT ISLAND IN ${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
  };
  tick();
  setInterval(tick, 1000);
}

const saveKey = (level: Level) => `pokebattles:${date}:${level}`;
// Switch-over day: battles saved earlier today were on the old rules. Clear them once so everyone can play the new system.
if (!DEV && date === V2_FROM) {
  try {
    if (!localStorage.getItem(`pokebattles:v2:${date}`)) {
      for (const l of ['easy', 'medium', 'hard']) {
        localStorage.removeItem(`pokebattles:${date}:${l}`);
        localStorage.removeItem(`pokebattles:submitted:${date}:${l}`);
      }
      localStorage.setItem(`pokebattles:v2:${date}`, '1');
    }
  } catch { /* storage blocked */ }
}
// Easy (from V2_FROM): the team you built today. One try a day, so it's kept with the battle.
const ownTeam = (level: Level) => level === 'easy' && isV2(date);
let devTeam: PickedTeam | null = null;
function loadTeam(): PickedTeam | null {
  if (DEV) return devTeam;
  try { return JSON.parse(localStorage.getItem(`pokebattles:${date}:easy:team`) ?? 'null'); } catch { return null; }
}
function saveTeam(t: PickedTeam) {
  devTeam = t;
  try { if (!DEV) localStorage.setItem(`pokebattles:${date}:easy:team`, JSON.stringify(t)); } catch { /* ignore */ }
}
/** Today's day for a level (Easy uses your own team; null if you haven't built it yet). */
const dayFor = (level: Level): Day | null => {
  if (!ownTeam(level)) return generateDay(date, seed, level);
  const t = loadTeam();
  return t ? generateDay(date, seed, level, t) : null;
};
function loadLog(level: Level): Action[] {
  if (DEV) return [];
  try {
    return JSON.parse(localStorage.getItem(saveKey(level)) ?? '[]');
  } catch {
    return [];
  }
}
function saveLog(level: Level, log: Action[]) {
  if (DEV) return;
  try {
    localStorage.setItem(saveKey(level), JSON.stringify(log));
  } catch { /* private mode: game still works, just no resume */ }
}

/** One level of today's game: its battle, saved progress and screens. */
interface Run { level: Level; day: Day; battle: Battle; scene: BattleScene; sawIsland: boolean }

async function boot() {
  // The battle screens draw text on a canvas, so they wait for the fonts; the menu doesn't need to.
  const fontsReady = Promise.all([document.fonts.load('8px "Press Start 2P"'), document.fonts.load('800 7.5px "Nunito"')]).catch(() => {});
  startTimer();
  fit();
  const gfx = new Gfx(canvas);
  gfxRef = gfx;
  fit();
  const input = new Input();
  input.bindTouch(document.getElementById('app')!, canvas);

  let current: Scene;
  const runs = new Map<Level, Run>();
  // In DEV, the battles live only in memory, so keep them for this page load.
  const getRun = async (level: Level): Promise<Run> => {
    const existing = runs.get(level);
    if (existing) return existing;
    await fontsReady;
    const day = dayFor(level)!;
    const saved = loadLog(level);
    const battle = saved.length ? Battle.replay(day, saved) : new Battle(day);
    const run: Run = {level, day, battle, scene: null as unknown as BattleScene, sawIsland: saved.length > 0};
    run.scene = new BattleScene(battle, gfx, input, action => {
      const events = battle.step(action);
      saveLog(level, battle.log);
      if (battle.winner) {
        useStatsKey(statsKey(level));
        recordResult(date, resultOf(battle)); // saved even if they close the tab now
      }
      run.scene.play(events);
    });
    run.scene.onEnd = () => goResults(run);
    await run.scene.load();
    runs.set(level, run);
    return run;
  };

  const stateOf = (level: Level): LevelState => {
    const run = runs.get(level);
    const d = run ? null : dayFor(level);
    const battle = run?.battle ?? (d && loadLog(level).length ? Battle.replay(d, loadLog(level)) : null);
    if (!battle || !battle.started) return 'new';
    return battle.winner ? (battle.winner === 'player' ? 'won' : 'lost') : 'playing';
  };

  const startLevel = async (level: Level) => {
    // Finished on another device (maybe just now)? Then this shows that result instead of a new battle.
    if (!DEV && currentUser() && !runs.get(level)?.battle.started) await syncMine(); else await mineSync;
    // Guests who've already finished a battle get one gentle reminder a day before playing on.
    if (!DEV && !currentUser() && stateOf(level) === 'new' && LEVELS.some(l => stateOf(l) === 'won' || stateOf(l) === 'lost')) {
      const k = `pokebattles:remind:${date}`;
      let seen = false;
      try { seen = localStorage.getItem(k) === '1'; localStorage.setItem(k, '1'); } catch { /* ignore */ }
      if (!seen) await home.askForAccount('Create a free account to battle your friends live, keep your streak and track your stats.', 'Play as guest');
    }
    // Easy: build your team first (Lv 100, any Pokémon, any moves, 6 items), then face Red.
    if (ownTeam(level) && !loadTeam()) {
      audio.music('island');
      current = idle;
      pvp.showPicker({
        id: 'EASY', side: 'host', stage: 'picking', options: EASY_OPTIONS, seed: `easy-${date}`,
        host: whoAmI() ?? {id: 'me', name: 'YOU', country: ''}, guest: {id: 'red', name: 'RED', country: ''}, created: Date.now(),
        myTeam: null, ready: {host: false, guest: true}, teams: null, rounds: [], roundStarted: 0, duty: null,
        chosen: {me: false, them: false}, winner: null, how: '',
      }, {
        note: 'Pick any 6 Pokémon, their moves and up to 6 items. They’re all Lv 100, like Red’s team. You get one try today, so choose well!',
        onLock: t => { saveTeam(t); void startLevel(level); },
      });
      return;
    }
    const fresh = !runs.has(level);
    if (fresh) showLoader('Getting the island ready…');
    home.hide();
    fit();
    const run = await getRun(level);
    hideLoader();
    if (run.battle.winner) goResults(run);
    else if (run.battle.started || run.sawIsland) goBattle(run);
    else {
      run.sawIsland = true;
      audio.music('island');
      current = new IslandScene(gfx, input, run.battle.sides.player.team, run.battle.sides.player.bag, () => goBattle(run),
        (i, j) => {
          const order = run.battle.order;
          [order[i], order[j]] = [order[j], order[i]];
          run.battle.reorder(order);
        });
      (current as IslandScene).onItem = (item, t) => run.battle.preItem(item, t);
    }
  };
  const home = new Home(level => void startLevel(level));
  hideLoader(); // the start-up loading screen (in index.html) goes once the menu exists

  const homeInfo = () => ({
    dayNumber: generateDay(date).number, date, dev: DEV,
    states: Object.fromEntries(LEVELS.map(l => [l, stateOf(l)])) as Record<Level, LevelState>,
    stats: Object.fromEntries(LEVELS.map(l => {
      useStatsKey(statsKey(l));
      return [l, loadStats()];
    })) as Record<Level, Stats>,
  });
  const idle: Scene = {update() {}, draw() { gfx.clear(); }, menuSounds: false};

  /** The menu: a modern web page over the game (the canvas just shows a blank screen meanwhile). */
  const goTitle = () => {
    audio.music('island');
    current = idle;
    home.show(homeInfo());
  };
  home.onMenu = goTitle;

  // ---------- friend battles ----------
  const pvp = new PvpScreens(home);
  let pvpBattle: PvpBattle | null = null;
  const leaveBattle = () => {
    pvpBattle?.stop();
    pvpBattle = null;
  };
  /** Friend battles need an account (or the dev-only local mode). */
  const needAccount = async (why: string) => !!whoAmI() || await home.askForAccount(why);
  home.onPlayFriend = async friend => {
    if (!await needAccount('Create a free account (or log in) to battle your friends.')) return;
    // They've already challenged me: accept that instead of sending a second challenge back.
    if (friend) {
      try {
        const waiting = (await myInvites()).invites.find(x => x.from.name.toLowerCase() === friend.toLowerCase());
        if (waiting) return void pvp.open(waiting.id);
      } catch { /* offline: fall through to a new challenge */ }
    }
    pvp.showSetup(friend ?? '');
  };
  home.onOpenMatch = id => void pvp.open(id);

  // ---------- Elite Four: one run a day (own team; HP, PP and status carry over; one loss ends it) ----------
  type EliteSave = {team: PickedTeam; logs: Action[][]; submitted?: boolean; posted?: boolean; exited?: number}; // exited = rooms walked out of
  // Two modes, one run a day each: Easy (your own team) and Hard (the day's random team). `mode` = the one being played.
  let mode: EliteMode = 'easy';
  const eliteKeyFor = (m: EliteMode) => `pokebattles:${date}:${m === 'hard' ? 'elite-hard' : 'elite'}`;
  const devElite: Record<EliteMode, EliteSave | null> = {easy: null, hard: null};
  const loadElite = (m: EliteMode = mode): EliteSave | null => {
    if (DEV) return devElite[m];
    try { return JSON.parse(localStorage.getItem(eliteKeyFor(m)) ?? 'null'); } catch { return null; }
  };
  let elitePush = 0;
  const saveElite = (e: EliteSave) => {
    const m = mode;
    devElite[m] = e;
    try { if (!DEV) localStorage.setItem(eliteKeyFor(m), JSON.stringify(e)); } catch { /* storage blocked */ }
    // Logged in: the run also goes to the account (a moment later, so a burst of turns is one upload).
    if (!DEV && currentUser()) {
      clearTimeout(elitePush);
      elitePush = window.setTimeout(() => void pushEliteRun(date, e, m).catch(() => {}), 1500);
    }
  };
  /** How far a saved run got (to pick the newer copy between this device and the account). */
  const eliteProgress = (e: EliteSave | null) => (e ? 1 + e.logs.reduce((n, l) => n + l.length, 0) + (e.exited ?? 0) : 0);
  /** Logged in: if the account has a run that got further (played on another device), continue from it. */
  const syncElite = async (m: EliteMode) => {
    if (DEV || !currentUser()) return;
    try {
      const remote = await Promise.race([pullEliteRun<EliteSave>(date, m), new Promise<null>(r => setTimeout(() => r(null), 4000))]);
      const local = loadElite(m);
      if (remote && Array.isArray(remote.logs) && eliteProgress(remote) > eliteProgress(local)) {
        try { localStorage.setItem(eliteKeyFor(m), JSON.stringify({...remote, posted: local?.posted || remote.posted})); } catch { /* ignore */ }
      } else if (local && eliteProgress(local) > eliteProgress(remote)) void pushEliteRun(date, local, m).catch(() => {});
    } catch { /* offline: keep this device's copy */ }
  };
  const eliteRunNow = (m: EliteMode = mode): {save: EliteSave; run: EliteRun} | null => {
    const save = loadElite(m);
    if (!save) return null;
    try { return {save, run: replayElite(date, save.team, save.logs, m)}; } catch { return null; }
  };
  // Profile stats: every finished Elite Four run saved on this device.
  home.eliteHistory = () => {
    const out: EliteRecord[] = [];
    try {
      for (let k = 0; k < localStorage.length; k++) {
        const key = localStorage.key(k) ?? '';
        const m = /^pokebattles:(\d{4}-\d{2}-\d{2}):elite(-hard)?$/.exec(key);
        if (!m) continue;
        try {
          const sv = JSON.parse(localStorage.getItem(key) ?? 'null') as EliteSave | null;
          if (!sv) continue;
          const r = replayElite(m[1], sv.team, sv.logs, m[2] ? 'hard' : 'easy');
          if (r.over) out.push({day: m[1], stage: r.cleared, won: r.won, turns: r.turns, items: r.itemsUsed});
        } catch { /* skip a broken save */ }
      }
    } catch { /* storage blocked */ }
    return out;
  };
  /** Splits a line of dialogue into 2-line pages that fit the text box. */
  const pages = (text: string): string[][] => {
    const words = text.split(' '), lines: string[] = [];
    let line = '';
    for (const w of words) { if ((line + ' ' + w).trim().length > 18) { lines.push(line.trim()); line = w; } else line += ' ' + w; }
    if (line.trim()) lines.push(line.trim());
    const out: string[][] = [];
    for (let k = 0; k < lines.length; k += 2) out.push(lines.slice(k, k + 2));
    return out;
  };
  const eliteSprite = (key: string) => `${import.meta.env.BASE_URL}sprites/trainers/e4-${key}.png`;
  home.eliteState = (m: EliteMode = 'easy') => {
    const r = eliteRunNow(m);
    if (!r) return {state: 'new' as const};
    if (r.run.over) return {state: 'done' as const, cleared: r.run.cleared, won: r.run.won};
    return {state: 'playing' as const, cleared: r.run.cleared};
  };
  /** Posts a finished run (logged in, real site). Marked done only once the server has it, so failures retry later. */
  const postElite = async (save: EliteSave) => {
    if (DEV || !currentUser() || save.posted) return;
    try { await submitElite(date, save.team, save.logs, ELITE_LEVEL[mode]); save.posted = true; }
    catch (e) { if (/already/i.test(String((e as Error).message))) save.posted = true; }
    saveElite(save);
  };
  const finishElite = async (save: EliteSave, run: EliteRun) => {
    // Logged in: the run goes on the Elite Four leaderboard.
    await postElite(save);
    current = idle;
    audio.music('island');
    const last = run.battles[run.battles.length - 1];
    home.showEliteResult({date, mode, cleared: run.cleared, won: run.won, turns: run.turns, items: run.itemsUsed,
      reached: ELITE[Math.min(run.cleared, ELITE.length - 1)].name,
      team: last ? last.sides.player.team.map(m => ({species: m.species, hp: m.hp === 0 ? 0 : Math.max(1, Math.round((m.hp / m.maxHp) * 100))})) : []});
  };
  const eliteSynced = new Set<EliteMode>();
  const startElite = async () => {
    if (!eliteSynced.has(mode)) { eliteSynced.add(mode); await syncElite(mode); } // once per visit (not between rooms)
    const r = eliteRunNow();
    if (!r && mode === 'hard') {
      // Hard: today's random team and the recommended items, locked. Show it, then enter.
      const team = eliteHardTeam(date);
      audio.music('island');
      current = idle;
      home.showEliteHardTeam(team, () => { saveElite({team, logs: [], exited: 0}); void startElite(); });
      return;
    }
    if (!r) {
      // Build your team first (same team builder as Easy).
      audio.music('island');
      current = idle;
      pvp.showPicker({
        id: 'ELITE', side: 'host', stage: 'picking', options: ELITE_OPTIONS, seed: `elite-${date}`,
        host: whoAmI() ?? {id: 'me', name: 'YOU', country: ''}, guest: {id: 'e4', name: 'ELITE FOUR', country: ''}, created: Date.now(),
        myTeam: null, ready: {host: false, guest: true}, teams: null, rounds: [], roundStarted: 0, duty: null,
        chosen: {me: false, them: false}, winner: null, how: '',
      }, {
        title: 'Elite Four · Build your team',
        note: 'Five battles in a row: Lorelei, Bruno, Agatha, Lance and Champion Blue. HP, PP and status carry over, so only your items heal you (take as many as you like). Lose once and the run ends. One run a day!',
        lockLabel: 'Lock in &amp; enter the League',
        // Enough to heal and revive through five battles: full HP, revives, PP and status cures.
        recommend: {...ELITE_RECOMMENDED},
        onLock: t => { saveElite({team: t, logs: [], exited: 0}); void startElite(); },
      });
      return;
    }
    const {save, run} = r;
    if (run.over) return void finishElite(save, run);
    // Just beat a trainer: stay in their room until you walk through the open door.
    if (run.cleared > (save.exited ?? run.cleared)) {
      const k = run.cleared - 1, e = ELITE[k], done = run.battles[k];
      const title = e.key === 'blue' ? 'CHAMPION · BLUE' : `ELITE FOUR · ${e.name}`;
      const lose = pages(`${e.name}: ${e.lose}`);
      home.hide();
      fit();
      hideLoader();
      audio.music('island');
      current = new IslandScene(gfx, input, done.sides.player.team, done.sides.player.bag, () => {}, () => {}, {
        ...eliteRoom(e.key, eliteSprite(e.key), e.name, title, [...lose, ['The door is open.', 'Walk through it!']], lose),
        cleared: () => { save.exited = run.cleared; saveElite(save); void startElite(); },
      });
      return;
    }
    const lastB = run.battles[run.battles.length - 1];
    const i = lastB && !lastB.winner ? save.logs.length - 1 : run.cleared;
    const you = i === 0 ? eliteStartTeam(save.team) : carryOver(run.battles[i - 1]);
    const day = eliteDay(date, i, you, mode);
    const battle = save.logs[i] ? Battle.replay(day, save.logs[i]) : new Battle(day);
    const e = ELITE[i];
    showLoader(i === 0 ? 'Entering the Pokémon League…' : `On to ${e.name[0] + e.name.slice(1).toLowerCase()}…`);
    home.hide();
    fit();
    await fontsReady;
    const scene = new BattleScene(battle, gfx, input, action => {
      const events = battle.step(action);
      save.logs[i] = battle.log;
      saveElite(save);
      scene.play(events);
    });
    scene.trainerUrls = {...scene.trainerUrls, foe: eliteSprite(e.key)};
    scene.arena = e.key;
    scene.onEnd = () => void startElite(); // next room, or the result
    await scene.load();
    hideLoader();
    if (battle.started) {
      scene.resume();
      current = scene;
      return;
    }
    audio.music('island');
    const left = you.team.filter(m => (m.start?.hp ?? 1) > 0).length;
    const intro = i === 0
      ? [['Welcome to the', 'POKÉMON LEAGUE!'], ['HP and PP carry', 'over all the way.'], ['Heal with items', 'from START.'], ['LORELEI is', 'waiting...']]
      : [[`${left} of 6 POKÉMON`, 'still standing.'], [`${e.name} is`, 'waiting...']];
    const title = e.key === 'blue' ? 'CHAMPION · BLUE' : `ELITE FOUR · ${e.name}`;
    current = new IslandScene(gfx, input, battle.sides.player.team, battle.sides.player.bag, () => {
      scene.begin(battle.start());
      current = scene;
    }, (a, b) => {
      const order = battle.order;
      [order[a], order[b]] = [order[b], order[a]];
      battle.reorder(order);
    }, eliteRoom(e.key, eliteSprite(e.key), e.name, title, intro, [...pages(`${e.name}: ${e.intro}`), ['Check your team', 'before you fight?']]));
    (current as IslandScene).onItem = (item, t) => {
      const err = battle.preItem(item, t);
      if (!err) { save.logs[i] = battle.log; saveElite(save); }
      return err;
    };
  };
  home.onElite = (m: EliteMode = 'easy') => { mode = m; void startElite(); };

  // Editing a saved team (from its page in the profile): the team builder with the team loaded.
  home.onEditTeam = id => {
    const l = listLoadouts().find(x => x.id === id);
    if (!l) return;
    pvp.showPicker({
      id: 'EDIT', side: 'host', stage: 'picking', options: EASY_OPTIONS, seed: `edit-${id}`,
      host: whoAmI() ?? {id: 'me', name: 'YOU', country: ''}, guest: {id: 'x', name: 'TEAM', country: ''}, created: Date.now(),
      myTeam: null, ready: {host: false, guest: true}, teams: null, rounds: [], roundStarted: 0, duty: null,
      chosen: {me: false, them: false}, winner: null, how: '',
    }, {
      title: `Saved team · ${l.name}`,
      note: 'Change any Pokémon, their moves and the items, then save. Teams are saved at Lv 100 and fitted to each match’s rules when you load them.',
      lockLabel: 'Save changes', initial: l.team, hideSaved: true,
      back: () => home.showTeam(id),
      onLock: t => { updateLoadout(id, t); home.showTeam(id); },
    });
  };
  home.onCancelMatch = async id => { await cancelMatch(id); };
  home.listInvites = async () => (await myInvites()).invites;
  home.onDeclineInvite = async id => { await declineInvite(id); };
  home.listMatches = async (opp?: string) => (await listMatches(opp)).matches;
  pvp.onBattle = async v => {
    await fontsReady;
    leaveBattle();
    home.hide();
    fit();
    const b = new PvpBattle(gfx, input, v, async done => {
      leaveBattle();
      current = idle;
      audio.music('island');
      try { pvp.showResult(await matchState(done.id)); } catch { pvp.showResult(done); }
    });
    pvpBattle = b;
    showLoader('Loading the battle…');
    await b.load();
    hideLoader();
    b.begin();
    current = b.scene;
    // FORFEIT (in place of RUN) gives up through the server.
    b.scene.onForfeit = () => { void forfeitMatch(v.id).catch(() => { /* the battle screen will catch up */ }); };
  };
  if (import.meta.env.DEV) {
    (window as unknown as {__pb: object}).__pb = {home, homeInfo}; // for checking pages in dev
    // ?preview=results|board opens a page with sample data (dev server only).
    const preview = params.get('preview');
    if (preview) setTimeout(() => {
      const info = homeInfo();
      home.setInfo(info);
      if (preview === 'island') void startLevel('medium');
      else if (preview === 'battle') void getRun('medium').then(run => {
        home.hide(); fit(); run.sawIsland = true;
        if (params.get('arena')) run.scene.arena = params.get('arena') as never; // dev: battle inside an Elite Four room
        goBattle(run);
      });
      else if (preview === 'room') void getRun('medium').then(run => { // dev: an Elite Four room (?room=bruno)
        const e = ELITE.find(x => x.key === params.get('room')) ?? ELITE[0];
        home.hide(); fit();
        current = new IslandScene(gfx, input, run.battle.sides.player.team, run.battle.sides.player.bag, () => {}, () => {},
          {...eliteRoom(e.key, eliteSprite(e.key), e.name, e.key === 'blue' ? 'CHAMPION · BLUE' : `ELITE FOUR · ${e.name}`, [], [['...']]),
            cleared: params.has('cleared') ? () => { document.title = 'EXITED'; } : undefined});
      });
      else if (preview === 'card') void import('./shareCard').then(async ({resultCard}) => {
        const elite = params.get('kind') === 'elite';
        const team = [{species: 'mewtwo', hp: 0}, {species: 'snorlax', hp: 86}, {species: 'articuno', hp: 0}, {species: 'dragonite', hp: 34}, {species: 'gengar', hp: 0}, {species: 'chansey', hp: 100}];
        const blob = await resultCard(elite
          ? {theme: 'elite', eyebrow: 'Elite Four · Day #6', title: 'Champion!', sub: 'Beat all four and Champion Blue', user: 'AryanV', rooms: [true, true, true, true, true], facts: [['3/6', 'Pokémon left'], ['139', 'Turns'], ['35', 'Items used']], team}
          : {theme: 'red', eyebrow: 'Day #6 · Hard', title: 'Victory!', sub: 'Beat Red with 3 of 6 left', user: 'AryanV', facts: [['3/6', 'Pokémon left'], ['48', 'Turns'], ['4', 'Win streak']], team});
        document.body.innerHTML = `<img src="${URL.createObjectURL(blob!)}" style="width:540px;display:block">`;
        document.body.style.cssText = 'margin:0;background:#fff';
      });
      else if (preview === 'tutorial') { document.head.insertAdjacentHTML('beforeend', '<style>#tut-pop, #tut-pop * { animation: none !important; } #loader { display: none !important; }</style>'); home.showTutorial(Number(params.get('step') ?? 0)); }
      else if (preview === 'badges-pop') { document.head.insertAdjacentHTML('beforeend', '<style>#badge-pop, #badge-pop * { animation: none !important; } #loader { display: none !important; }</style>'); home.showBadgePopup(['red-1', 'comeback-1', 'e4-lorelei', 'e4-agatha', 'champ-1', 'days-7']); }
      else if (preview === 'elite-result') home.showEliteResult({date, cleared: 3, won: false, turns: 87, reached: 'LANCE',
        team: [{species: 'mewtwo', hp: 0}, {species: 'snorlax', hp: 34}, {species: 'tauros', hp: 0}, {species: 'starmie', hp: 72}, {species: 'zapdos', hp: 0}, {species: 'exeggutor', hp: 0}]});
      else if (preview === 'friends') home.showFriends();
      else if (preview === 'friend') {
        const d = (n: number) => Date.now() - n * 864e5, opp = {name: 'MISTY', country: 'GB'};
        home.listMatches = async () => [
          {id: 'A1', side: 'host', opp, at: d(0), stage: 'battle', won: null},
          {id: 'A2', side: 'host', opp, at: d(1), stage: 'done', won: true, how: 'battle', left: {me: 2, opp: 0}},
          {id: 'A3', side: 'guest', opp, at: d(2), stage: 'done', won: false, how: 'battle', left: {me: 0, opp: 1}},
          {id: 'A4', side: 'host', opp, at: d(4), stage: 'done', won: true, how: 'forfeit', left: {me: 4, opp: 3}},
          {id: 'A5', side: 'guest', opp, at: d(6), stage: 'done', won: true, how: 'battle', left: {me: 1, opp: 0}},
        ];
        void home.showFriendProfile({id: 'b', username: params.get('name') ?? 'MISTY', country: 'GB'} as never);
      }
      else if (preview.startsWith('pvp-')) {
        // Sample friend-battle screens for screenshots (dev only).
        const o = {...DEFAULT_OPTIONS};
        const mk = (sp: string[]) => ({mons: sp.map(x => ({species: x, level: 50, moves: startingMoves(x, 50, o.clauses)})), bag: {}});
        const host = {id: 'a', name: 'AryanV', country: 'IN'}, guest = {id: 'b', name: 'MISTY', country: 'GB'};
        const teams = {host: mk(['charizard', 'pikachu', 'snorlax', 'gengar', 'dragonite', 'alakazam']), guest: mk(['lapras', 'jolteon', 'starmie', 'machamp', 'exeggutor', 'tauros'])};
        const v = {id: 'DEMO42', side: 'host' as const, stage: 'picking' as const, options: o, seed: 'demo', host, guest, created: Date.now(),
          myTeam: null, ready: {host: false, guest: true}, teams: null, rounds: [], roundStarted: Date.now(), duty: null,
          chosen: {me: false, them: false}, winner: null, how: ''};
        if (preview === 'pvp-setup') pvp.showSetup('MISTY');
        else if (preview === 'pvp-picker') pvp.showPicker(v);
        else if (preview === 'pvp-ready') pvp.showReady({...v, myTeam: teams.host});
        else if (preview === 'pvp-vs') pvp.showVs({...v, stage: 'battle', teams});
        else if (preview === 'pvp-result') pvp.showResult({...v, stage: 'done', teams, winner: 'host', how: 'forfeit'});
      }
      else if (preview === 'board') home.showBoard('medium', date);
      else if (preview === 'alltime') home.showBoard('easy', 'all');
      else if (preview.startsWith('entry')) void home.showEntry(Number(preview.slice(5)) || 113);
      else home.showResults({level: 'medium', dayNumber: info.dayNumber, date, dev: true,
        result: {won: preview !== 'defeat', left: preview === 'defeat' ? 0 : 3, turns: 24, hp: preview === 'defeat' ? [0, 0, 0, 0, 0, 0] : [100, 64, 0, 18, 0, 0]},
        stats: {played: 5, wins: 3, streak: 2, maxStreak: 3, lastDate: date, history: {}},
        team: ['charizard', 'pikachu', 'gengar', 'snorlax', 'lapras', 'alakazam'], next: 'hard'});
    }, 300);
  }
  // "Add my result": an account is needed (its username is what's shown), then the battle is sent.
  /** Sends every finished battle of today that isn't on the leaderboard yet (logged-in players only). */
  const submitPending = async () => {
    if (DEV || !currentUser()) return;
    for (const level of LEVELS) {
      if (submittedFor(date, level)) continue;
      const run = runs.get(level);
      const d = run ? null : dayFor(level);
    const battle = run?.battle ?? (d && loadLog(level).length ? Battle.replay(d, loadLog(level)) : null);
      if (!battle?.winner) continue;
      try { await submit(date, level, battle.log, ownTeam(level) ? loadTeam() : null); } catch { /* already there, or offline: try again next time */ }
    }
    for (const m of ['easy', 'hard'] as EliteMode[]) {
      const e = eliteRunNow(m);
      if (e?.run.over) { mode = m; await postElite(e.save); }
    }
  };
  /** After logging in (or on load): pull the account's stats + friends, accept an invite, catch up on results. */
  // One try per day per ACCOUNT: battles this account already finished on another device are copied here.
  let mineSync: Promise<void> = Promise.resolve();
  const syncMine = () => (mineSync = (async () => {
    if (DEV || !currentUser()) return;
    try {
      for (const b of await fetchMine(date)) {
        if (!LEVELS.includes(b.level) || !Array.isArray(b.log)) continue;
        const local = runs.get(b.level)?.battle;
        if (local?.winner) continue; // already finished here
        if (b.level === 'easy' && b.team) saveTeam(b.team as PickedTeam);
        saveLog(b.level, b.log);
        runs.delete(b.level);
        const d = dayFor(b.level);
        if (d) {
          const done = Battle.replay(d, b.log);
          useStatsKey(statsKey(b.level));
          if (done.winner) recordResult(date, resultOf(done));
        }
      }
    } catch { /* offline: try again next time */ }
    home.refreshMenu(homeInfo());
  })());
  const syncAccount = async () => {
    if (!currentUser()) return;
    try { await loadProfile(); } catch { /* offline: keep local */ }
    await syncMine();
    const friend = await acceptInvite();
    await submitPending();
    if (friend) home.toast(`You and ${friend} are now friends!`);
    home.refreshMenu(homeInfo());
    await syncElite('easy');
    await syncElite('hard');
    home.refreshMenu(homeInfo());
  };
  configureProfile(statsKey, !DEV);
  captureInvite();
  onSessionChange(s => { if (s) void syncAccount(); });
  home.onSubmit = async (level: Level) => {
    if (DEV) return 'The leaderboard is off in test builds.';
    const run = runs.get(level) ?? await getRun(level);
    if (!run.battle.winner) return 'Finish the battle first.';
    if (!await home.askForAccount('Create an account (or log in) to put your result on the leaderboard.')) return null;
    try {
      await submit(date, level, run.battle.log, ownTeam(level) ? loadTeam() : null);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };
  // Laptops: true full screen (hides the browser bars too). Button or the F key.
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const fsBtn = document.getElementById('fullscreen')!;
  fsBtn.addEventListener('click', () => { fsBtn.blur(); toggleFull(); });
  addEventListener('keydown', e => {
    if (e.key?.toLowerCase() === 'f' && !document.body.classList.contains('on-home') && !(e.target as HTMLElement)?.closest?.('input, select, textarea')) toggleFull();
  });
  document.addEventListener('fullscreenchange', () => setTimeout(fit, 50));
  initPullRefresh();
  initNetStatus();
  initErrorReports();
  // The test site (pokebattles-dev): point visitors to the real game, at most once a day.
  if (import.meta.env.VITE_DEV_BUILD === '1') {
    let seen = false;
    try { seen = Date.now() - Number(localStorage.getItem('pokebattles-dev:prompt') ?? 0) < 864e5; } catch { /* ignore */ }
    if (!seen) {
      const pop = document.createElement('div');
      pop.id = 'dev-pop';
      pop.setAttribute('role', 'dialog');
      pop.innerHTML = `<div class="ip-card">
        <div class="ip-ball" aria-hidden="true"></div>
        <p class="ip-eyebrow">Test version</p>
        <h2>You’re on the DailyBattles test site</h2>
        <p>Things here change all the time and nothing is saved: no streaks, no leaderboard. The real game has a new team every day, rankings and friend battles.</p>
        <div class="ip-btns"><a class="ip-yes" href="https://dailybattles.netlify.app/">Play the real game</a><button class="ip-no">Stay on the test site</button></div></div>`;
      document.body.appendChild(pop);
      pop.querySelector<HTMLButtonElement>('.ip-no')!.onclick = () => {
        try { localStorage.setItem('pokebattles-dev:prompt', String(Date.now())); } catch { /* ignore */ }
        pop.remove();
      };
    }
  }
  startActivityTracking();
  home.onAdmin = () => void showAdmin(home);
  // The owner's stats page: open the site with ?admin (only works when logged in as AryanV).
  if (STATS_PAGE || params.has('admin')) setTimeout(() => void showAdmin(home), 400);
  // On the stats app, logging in (or out) reloads the stats.
  if (STATS_PAGE) onSessionChange(() => setTimeout(() => void showAdmin(home), 300));
  if (DEV && params.get('preview') === 'admin') setTimeout(async () => void showAdmin(home, await (await fetch('/admin-sample.json')).json()), 500);

  // ---------- pop-up challenges from friends (while logged in and on the site) ----------
  const seenInvites = new Set<string>();
  const showInvite = (inv: {id: string; from: {name: string; country: string}}) => {
    if (document.getElementById('invite-pop')) return;
    seenInvites.add(inv.id);
    const pop = document.createElement('div');
    pop.id = 'invite-pop';
    pop.setAttribute('role', 'dialog');
    const esc = (t: string) => t.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
    pop.innerHTML = `<div class="ip-card">
      <div class="ip-ball" aria-hidden="true"></div>
      <p class="ip-eyebrow">Friend battle</p>
      <h2><b>${esc(inv.from.name)}</b>${inv.from.country ? ' ' + flag(inv.from.country) : ''} challenged you!</h2>
      <p>Pick your teams at the same time, then battle live.</p>
      <div class="ip-btns"><button class="ip-yes">Accept</button><button class="ip-no">Later</button></div>
      <p class="ip-hint">It stays under Challenges on your Friends page.</p></div>`;
    document.body.appendChild(pop);
    const close = () => pop.remove();
    pop.querySelector<HTMLButtonElement>('.ip-yes')!.onclick = () => {
      close();
      leaveBattle();
      current = idle;
      audio.music('island');
      void pvp.open(inv.id);
    };
    pop.querySelector<HTMLButtonElement>('.ip-no')!.onclick = () => { close(); void home.loadInvites(); };
  };
  // A friend battle I left by accident (closed the app, went back to the menu): offer to jump back in.
  const offeredRejoin = new Set<string>();
  const showRejoin = (m: {id: string; opp: {name: string; country: string} | null; stage: string; oppOnline?: boolean}) => {
    offeredRejoin.add(m.id);
    const pop = document.createElement('div');
    pop.id = 'invite-pop';
    pop.setAttribute('role', 'dialog');
    const esc = (t: string) => t.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
    const what = m.stage === 'battle' ? 'Your battle' : 'Your match';
    pop.innerHTML = `<div class="ip-card">
      <div class="ip-ball" aria-hidden="true"></div>
      <p class="ip-eyebrow">Friend battle</p>
      <h2>${what} with <b>${esc(m.opp?.name ?? 'your friend')}</b> is still on</h2>
      <p>${esc(m.opp?.name ?? 'Your friend')} is in it right now, waiting for you. ${m.stage === 'battle' ? 'Jump back in where you left off.' : ''}</p>
      <div class="ip-btns"><button class="ip-yes">Rejoin</button><button class="ip-no">Later</button></div>
      <p class="ip-hint">You can also rejoin from your Friends page.</p></div>`;
    document.body.appendChild(pop);
    pop.querySelector<HTMLButtonElement>('.ip-yes')!.onclick = () => { pop.remove(); void openMatchLink(m.id, null); };
    pop.querySelector<HTMLButtonElement>('.ip-no')!.onclick = () => pop.remove();
  };
  let lastRejoinCheck = 0;
  const checkRejoin = async () => {
    if (Date.now() - lastRejoinCheck < 20_000 || !document.body.classList.contains('on-home') || home.pageName === 'pvp') return;
    lastRejoinCheck = Date.now();
    try {
      const {matches} = await listMatches();
      const live = matches.find(m => !offeredRejoin.has(m.id) && m.opp && m.oppOnline && ['room', 'picking', 'battle'].includes(m.stage));
      if (live && !document.getElementById('invite-pop') && !pvpBattle) showRejoin(live);
    } catch { /* offline */ }
  };
  const checkInvites = async () => {
    if (!whoAmI() || pvpBattle || document.hidden || document.getElementById('invite-pop')) return;
    void checkRejoin();
    try {
      const {invites} = await myInvites();
      const fresh = invites.find(x => !seenInvites.has(x.id) && Date.now() - x.at < 15 * 60 * 1000);
      void home.loadInvites(); // keeps the Friends page list up to date
      if (fresh) showInvite(fresh);
    } catch { /* offline: try later */ }
  };
  // Real accounts on both sites (the test site too); on the local dev server only in ?local mode.
  if (!import.meta.env.DEV || LOCAL) {
    setInterval(() => void checkInvites(), 8000);
    setTimeout(() => void checkInvites(), 1500);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void checkInvites(); });
  }

  document.getElementById('game-home')!.addEventListener('click', e => {
    (e.currentTarget as HTMLElement).blur();
    leaveBattle();
    goTitle();
  });

  const goBattle = (run: Run) => {
    if (run.battle.started) run.scene.resume();
    else run.scene.begin(run.battle.start());
    current = run.scene;
  };

  const goResults = (run: Run) => {
    if (current === run.scene) setTimeout(() => audio.music('island'), 3500); // after the jingle
    useStatsKey(statsKey(run.level));
    const stats = recordResult(date, resultOf(run.battle));
    // Logged in: results go on the leaderboard and stats into the account automatically.
    if (currentUser()) void submitPending().then(() => saveProfileStats()).catch(() => {});
    maybeShowInstall(2500);
    current = idle;
    const info = homeInfo();
    home.setInfo(info);
    const order = run.battle.order;
    home.showResults({
      level: run.level, dayNumber: run.day.number, date, dev: DEV,
      result: stats.history[date], stats,
      team: order.map(i => run.day.player.team[i].species),
      next: LEVELS.find(l => info.states[l] === 'new' || info.states[l] === 'playing') ?? null,
    });
  };

  // Mute button (top right).
  const muteBtn = document.getElementById('mute')!;
  // Don't let the button keep keyboard focus: otherwise Enter/Space (the A button) would "click" it again.
  muteBtn.addEventListener('pointerdown', e => e.preventDefault());
  muteBtn.addEventListener('keydown', e => e.preventDefault());
  muteBtn.addEventListener('click', e => {
    e.stopPropagation();
    audio.unlock();
    audio.toggleMute();
    muteBtn.blur();
  });
  audio.onMuteChange(m => {
    muteBtn.textContent = m ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', m ? 'Sound off' : 'Sound on');
  });

  goTitle();
  void syncAccount();
  // Opened someone's invite link while logged out: show who invited them.
  const inviter = pendingInvite();
  // A friend-battle link or a tapped challenge notification: log in if needed, then go straight into the match.
  const openMatchLink = async (id: string, from: string | null) => {
    if (pvpBattle) return;
    seenInvites.add(id);
    document.getElementById('invite-pop')?.remove();
    if (!await needAccount(`${from ?? 'A friend'} challenged you to a battle! Create a free account (or log in) to accept.`)) return;
    leaveBattle();
    current = idle;
    audio.music('island');
    void pvp.open(id);
  };
  const matchId = params.get('match');
  if (matchId) {
    const url = new URL(location.href);
    url.searchParams.delete('match');
    history.replaceState(null, '', url.pathname + url.search);
    void openMatchLink(matchId, inviter);
  } else if (inviter && !currentUser()) home.showInvite(inviter);
  // The phone app was already open in the background: the service worker tells us which match was tapped.
  const fromNotif = (raw: string) => {
    const u = new URL(raw, location.origin);
    const id = u.searchParams.get('match');
    if (id) void openMatchLink(id, u.searchParams.get('invite'));
  };
  navigator.serviceWorker?.addEventListener('message', e => { if (e.data?.type === 'open' && e.data.url) fromNotif(e.data.url); });
  // Opened fresh from a notification (some iPhones open the home page instead of the link): pick it up here.
  void (async () => {
    try {
      const c = await caches.open('pb-notif');
      const r = await c.match('/tapped');
      if (!r) return;
      await c.delete('/tapped');
      const {url, at} = await r.json();
      if (Date.now() - at < 60_000 && !matchId) fromNotif(url);
    } catch { /* no cache storage */ }
  })();
  if (LOCAL) document.title = `${whoAmI()!.name} · local test`;
  // Returning players (2nd visit onwards) get the offer on the title screen too.
  try {
    const visits = Number(localStorage.getItem('pokebattles:visits') ?? 0) + 1;
    localStorage.setItem('pokebattles:visits', String(visits));
    if (visits >= 2) maybeShowInstall(4000);
    // First visit: the short how-to-play guide (not when arriving to join a friend's match).
    // Never for returning players (anyone with a saved battle or an account), even on a new browser.
    const played = visits > 1 || !!currentUser() || Object.keys(localStorage).some(k => /^pokebattles:\d{4}-\d{2}-\d{2}:/.test(k) || k.startsWith('pokebattles:stats:'));
    if (played) localStorage.setItem('pokebattles:tutorial', '1');
    if (!localStorage.getItem('pokebattles:tutorial') && !matchId && !params.has('preview')) setTimeout(() => home.showTutorial(), 600);
  } catch { /* ignore */ }

  // Fixed 60 updates per second, like the Game Boy.
  let last = performance.now(), acc = 0;
  const loop = (now: number) => {
    acc += Math.min(100, now - last);
    last = now;
    while (acc >= 1000 / 60) {
      if (current.menuSounds !== false) {
        if (['up', 'down', 'left', 'right'].some(b => input.pressed(b as never))) audio.sfx('blip');
        if (input.pressed('a') || input.taps.length) audio.sfx('select');
        else if (input.pressed('b')) audio.sfx('back');
      }
      if (input.pressed('select')) audio.toggleMute();
      current.update();
      input.endFrame();
      acc -= 1000 / 60;
    }
    current.draw();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
// Arriving from the old address with saved data: index.html unpacks it and reloads; don't start the game twice.
if (!(window as unknown as {__moving?: boolean}).__moving) boot();
