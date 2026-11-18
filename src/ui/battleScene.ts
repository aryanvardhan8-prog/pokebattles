// The battle screen: Gen 1 layout, menus, and playback of engine events as animations.

import {moveDesc} from './moveDesc';
import {drawArenaBackground, type RoomKey} from './eliteArt';
import {Battle, isSpecial, type Action, type BattleEvent, type SideId, type Status} from '../engine/battle';
import {SPECIES, MOVES} from '../engine/data';
import {Gfx, C, W, wrap, loadSprite, frontUrl, backUrl, redUrl, playerUrl, sizedSprite, textWidth} from './gfx';
import type {Input} from './input';
import {audio} from '../audio';
import {loadAni, getAni, aniFrame, aniUrl, pinAnis} from './ani';
import {drawFx, fxOverlay, fxShake, fxFrames, type Fx} from './moveFx';
import {STATUS_LABEL, powerLabel, drawPartyRows, drawStatsPage, drawBagList, BAG_ROWS, STATS_PAGES, TYPE_COLORS, typePill, typeIcon} from './teamViews';

interface Shown {
  species: string;
  level: number;
  hp: number;
  maxHp: number;
  status: Status;
  dx: number;
  dy: number;
  scale: number;
  hidden: boolean;
  snapHp: boolean;
  white: number; // 0..1 glow while coming out of the Pokéball
  sub: boolean; // a Substitute doll stands in for it
}

type Mode = 'anim' | 'main' | 'forfeit' | 'fight' | 'party' | 'partyMenu' | 'bag' | 'etherMove' | 'mimicPick' | 'stats' | 'end' | 'wait';
type PartyPurpose = 'switch' | 'forced' | 'item' | 'ether';

/** One running animation. tick() returns true when finished. */
interface Step { tick(): boolean }

interface Hotspot { x: number; y: number; w: number; h: number; fn: () => void }

const STATUS_COLORS: Record<string, string> = {slp: '#8a8fa3', psn: '#a050c8', brn: '#e8663a', frz: '#4fb3e8', par: '#d8a800'};
const TARGETED_ITEMS = new Set([
  'POTION', 'SUPER POTION', 'HYPER POTION', 'MAX POTION', 'FULL RESTORE', 'REVIVE', 'FULL HEAL',
  'ANTIDOTE', 'PARLYZ HEAL', 'AWAKENING', 'BURN HEAL', 'ICE HEAL', 'ELIXER',
]);

export class BattleScene {
  private mode: Mode = 'anim';
  private queue: BattleEvent[] = [];
  private step: Step | null = null;
  private shown: Record<SideId, Shown | null> = {player: null, red: null};
  /** A Pokémon that dug underground / flew up (hidden until it strikes). */
  private away: Record<SideId, boolean> = {player: false, red: false};
  private trainer = {x: -40, visible: true}; // Red (x = centre)
  private me = {x: 200, visible: true}; // you
  private ball: {x: number; y: number; rot: number} | null = null;
  private fx: Fx | null = null;
  private burst: {x: number; y: number; t: number} | null = null;
  private tint = document.createElement('canvas');
  private playerSprite: HTMLCanvasElement | null = null;
  private lines: string[] = [];
  private hot: Hotspot[] = [];
  private flash = false;
  private frame = 0;
  private sprites = new Map<string, HTMLCanvasElement>();
  private redSprite: HTMLCanvasElement | null = null;

  // menu state
  private mainCursor = 0;
  private moveCursor = 0;
  /** Mimic: which of the foe's moves is highlighted, and the slot Mimic is in. */
  private mimicCursor = 0;
  private mimicSlot = 0;
  private partyCursor = 0;
  private partyMenuCursor = 0;
  private partyPurpose: PartyPurpose = 'switch';
  private bagCursor = 0;
  private bagScroll = 0;
  private pendingItem: string | null = null;
  private pendingTarget = 0;
  private statsPage = 0;
  private prompt = '';
  private returnMode: Mode | null = null;

  onEnd: () => void = () => {};
  /** Friend battles: the text shown when the battle is over (default: the daily "YOU BEAT RED!"). */
  endLines: ((won: boolean) => string[]) | null = null;
  /** Friend battles: asked when it's time to choose; returns a "Waiting for…" text if it's not our turn. */
  waitText: (() => string | null) | null = null;

  /** Friend battles: show "Waiting for…" (blocks input) until new events arrive. */
  setWaiting(text: string) {
    this.mode = 'wait';
    this.lines = wrap(text).slice(0, 2);
  }

  get menuSounds() {
    return this.mode !== 'anim' && this.mode !== 'end';
  }

  /** Friend battles forfeit through the server; daily battles send a forfeit action (a loss). */
  onForfeit: (() => void) | null = null;
  private ffCursor = 1; // 0 = YES, 1 = NO

  /** Trainer pictures: yours (bottom) and the opponent's. Daily battles keep Hilbert vs Red;
   *  friend battles use both players' chosen trainers. */
  trainerUrls = {me: playerUrl, foe: redUrl};
  /** Elite Four: battle inside that trainer's room instead of on the beach. */
  arena: RoomKey | null = null;

  constructor(private b: Battle, private gfx: Gfx, private input: Input, private onAction: (a: Action) => void) {}

  async load() {
    const nums = new Set<number>();
    for (const s of Object.values(this.b.sides)) for (const m of s.team) nums.add(SPECIES[m.species].num);
    // Transform / Mimic can show any Pokémon, but those load lazily.
    await Promise.all([...nums].flatMap(n => [this.sprite(frontUrl(n)), this.sprite(backUrl(n))]));
    // 3D animated models: Red's from the front, yours from behind (and front for menus). Kept loaded all battle.
    pinAnis([...this.b.sides.red.team.map(m => aniUrl(m.species)), ...this.b.sides.player.team.flatMap(m => [aniUrl(m.species, true), aniUrl(m.species)])]);
    await Promise.all([
      ...this.b.sides.red.team.map(m => loadAni(aniUrl(m.species))),
      ...this.b.sides.player.team.flatMap(m => [loadAni(aniUrl(m.species, true)), loadAni(aniUrl(m.species))]),
    ]);
    [this.redSprite, this.playerSprite] = await Promise.all([loadSprite(this.trainerUrls.foe, true), loadSprite(this.trainerUrls.me, true)]);
  }

  private async sprite(url: string) {
    const s = await loadSprite(url);
    this.sprites.set(url, s);
    return s;
  }

  private getSprite(url: string): HTMLCanvasElement | null {
    const s = this.sprites.get(url);
    if (!s) void this.sprite(url);
    return s ?? null;
  }

  /** Fresh battle: play the intro. */
  begin(events: BattleEvent[]) {
    audio.music('battle');
    this.trainer = {x: -40, visible: true};
    this.me = {x: 200, visible: true};
    this.step = this.slideTrainerIn();
    this.queue = [...events];
    this.mode = 'anim';
  }

  /** Restored battle (after a refresh): jump straight to the current state. */
  resume() {
    if (!this.b.winner) audio.music('battle');
    this.trainer.visible = false;
    this.me.visible = false;
    for (const side of ['player', 'red'] as SideId[]) {
      const m = this.b.mon(side);
      this.shown[side] = m.hp > 0 || (side === 'player' && this.b.needSwitch)
        ? this.makeShown(side, this.b.sides[side].active, true) : null;
      if (this.shown[side]) {
        this.shown[side]!.species = this.b.sides[side].v.transformed ?? m.species;
        this.shown[side]!.sub = this.b.sides[side].v.substitute > 0;
      }
    }
    if (this.b.needSwitch) this.shown.player = null;
    this.mode = 'anim';
    this.lines = [];
  }

  play(events: BattleEvent[]) {
    this.queue.push(...events);
    this.mode = 'anim';
  }

  // ---------- update ----------

  update() {
    this.frame++;
    const tapped = this.input.taps.length > 0;
    if (tapped) {
      const t = this.input.taps[0];
      const h = this.hot.find(h => t.x >= h.x && t.x < h.x + h.w && t.y >= h.y && t.y < h.y + h.h);
      if (h) {
        h.fn();
        return;
      }
    }
    const a = this.input.pressed('a') || (tapped && (this.mode === 'anim' || this.mode === 'end'));
    const bb = this.input.pressed('b');

    switch (this.mode) {
      case 'anim': return this.updateAnim(a);
      case 'main': return this.updateMain(a);
      case 'forfeit': {
        const i = this.input;
        if (i.pressed('left') || i.pressed('right') || i.pressed('up') || i.pressed('down')) this.ffCursor ^= 1;
        if (bb) this.mode = 'main';
        else if (a) this.chooseForfeit(this.ffCursor === 0);
        return;
      }
      case 'fight': return this.updateFight(a, bb);
      case 'party': return this.updateParty(a, bb);
      case 'partyMenu': return this.updatePartyMenu(a, bb);
      case 'bag': return this.updateBag(a, bb);
      case 'etherMove': return this.updateEtherMove(a, bb);
      case 'mimicPick': {
        const n = this.b.sides.red.v.moves.length;
        if (this.input.pressed('up')) this.mimicCursor = (this.mimicCursor + n - 1) % n;
        if (this.input.pressed('down')) this.mimicCursor = (this.mimicCursor + 1) % n;
        if (bb) this.mode = 'fight';
        else if (a) this.submit({type: 'move', slot: this.mimicSlot, mimic: this.mimicCursor});
        return;
      }
      case 'stats': return this.updateStats(a, bb);
      case 'end':
        if (a) this.onEnd();
        return;
      case 'wait':
        return;
    }
  }

  private skip = false;
  private textWaiting = false;

  private updateAnim(a: boolean) {
    this.skip = a;
    while (true) {
      if (this.step) {
        if (!this.step.tick()) return;
        this.step = null;
      }
      const ev = this.queue.shift();
      if (!ev) break;
      this.step = this.stepFor(ev);
      if (!this.step) continue;
      this.skip = false;
    }
    this.afterAnim();
  }

  /** Decides what the player does next once animations finish. */
  private afterAnim() {
    if (this.b.winner) {
      this.mode = 'end';
      this.lines = this.endLines ? this.endLines(this.b.winner === 'player')
        : this.b.winner === 'player' ? [`YOU BEAT ${this.b.trainers.red}!`, this.b.trainers.red === 'RED' ? 'A: see results' : 'A: continue'] : [`${this.b.trainers.red} wins today.`, 'A: see results'];
      return;
    }
    const wait = this.returnMode ? null : this.waitText?.();
    if (wait) {
      this.setWaiting(wait);
      return;
    }
    if (this.returnMode) {
      this.mode = this.returnMode;
      this.returnMode = null;
      return;
    }
    if (this.b.needSwitch) {
      this.openParty('forced');
      return;
    }
    if (this.b.lockedMove('player')) {
      this.submit({type: 'move', slot: 0});
      return;
    }
    this.lines = [];
    this.mode = 'main';
  }

  private submit(a: Action) {
    const err = this.b.validate(a);
    if (err) {
      this.returnMode = this.mode === 'anim' ? null : this.mode;
      this.queue = [{t: 'text', s: err}];
      this.mode = 'anim';
      return;
    }
    this.onAction(a);
  }

  private moveSelect(dir: 'up' | 'down', count: number, cur: number): number {
    if (count === 0) return 0;
    return dir === 'up' ? (cur + count - 1) % count : (cur + 1) % count;
  }

  private updateMain(a: boolean) {
    const i = this.input;
    if (i.pressed('left') || i.pressed('right')) this.mainCursor ^= 1;
    if (i.pressed('up') || i.pressed('down')) this.mainCursor ^= 2;
    if (a) this.chooseMain(this.mainCursor);
  }

  private chooseMain(n: number) {
    this.mainCursor = n;
    if (n === 0) {
      this.mode = 'fight';
      const v = this.b.sides.player.v;
      if (this.moveCursor >= v.moves.length) this.moveCursor = 0;
    } else if (n === 1) {
      this.openParty('switch');
    } else if (n === 2) {
      this.mode = 'bag';
    } else {
      this.ffCursor = 1;
      this.mode = 'forfeit';
    }
  }

  private chooseForfeit(yes: boolean) {
    if (!yes) { this.mode = 'main'; return; }
    if (this.onForfeit) { this.mode = 'wait'; this.onForfeit(); return; }
    this.submit({type: 'forfeit'});
  }

  private drawForfeitMenu() {
    const g = this.gfx;
    g.tileBox(7, 12, 13, 6);
    g.text('Forfeit?', 64, 112);
    (['YES', 'NO'] as const).forEach((label, i) => {
      const x = i === 0 ? 72 : 120, y = 128;
      g.text(label, x, y);
      if (this.ffCursor === i) g.cursor(x - 8, y);
      this.hot.push({x: x - 8, y: y - 4, w: 40, h: 14, fn: () => { this.ffCursor = i; this.chooseForfeit(i === 0); }});
    });
  }

  private updateFight(a: boolean, b: boolean) {
    const n = this.b.sides.player.v.moves.length;
    if (this.input.pressed('up')) this.moveCursor = this.moveSelect('up', n, this.moveCursor);
    if (this.input.pressed('down')) this.moveCursor = this.moveSelect('down', n, this.moveCursor);
    if (b) this.mode = 'main';
    if (a) this.chooseMove(this.moveCursor);
  }

  private chooseMove(slot: number) {
    this.moveCursor = slot;
    if (this.b.usableSlots('player').length === 0) {
      this.submit({type: 'move', slot: -1}); // Struggle
      return;
    }
    const v = this.b.sides.player.v;
    if (v.disabled?.slot === slot) {
      this.returnMode = 'fight';
      this.queue = [{t: 'text', s: `${MOVES[v.moves[slot]].name} is disabled!`}];
      this.mode = 'anim';
      return;
    }
    if (v.moves[slot] === 'mimic' && this.b.sides.red.v.moves.length) { // Gen 1: you choose which move to copy
      this.mimicSlot = slot;
      this.mimicCursor = 0;
      this.mode = 'mimicPick';
      return;
    }
    this.submit({type: 'move', slot});
  }

  /** Mimic: the foe's moves, to pick the one to copy. */
  private drawMimicMenu() {
    const g = this.gfx;
    const moves = this.b.sides.red.v.moves;
    g.tileBox(4, 12, 16, 6);
    moves.forEach((id, i) => {
      const y = 102 + i * 10;
      const mv = MOVES[id];
      typeIcon(g, 47, y - 0.5, 9, mv.type);
      g.text(mv.name, 59, y);
      this.hot.push({x: 32, y: y - 1, w: 128, h: 10, fn: () => {
        this.mimicCursor = i;
        this.submit({type: 'move', slot: this.mimicSlot, mimic: i});
      }});
    });
    g.cursor(39, 102 + this.mimicCursor * 10);
    g.panel(2, 62, 78, 32, {accent: TYPE_COLORS.Normal, radius: 4});
    g.text('MIMIC', 9, 66);
    g.smallText('Copy which move?', 9, 79, C.light, 6);
  }

  private openParty(purpose: PartyPurpose) {
    this.partyPurpose = purpose;
    this.mode = 'party';
    this.partyCursor = purpose === 'forced'
      ? Math.max(0, this.b.sides.player.team.findIndex(m => m.hp > 0))
      : this.b.sides.player.active;
    this.prompt = purpose === 'forced' ? 'Bring out which POKÉMON?'
      : purpose === 'switch' ? 'Choose a POKÉMON.' : 'Use item on which POKÉMON?';
  }

  private updateParty(a: boolean, b: boolean) {
    const n = this.b.sides.player.team.length;
    if (this.input.pressed('up')) this.partyCursor = this.moveSelect('up', n, this.partyCursor);
    if (this.input.pressed('down')) this.partyCursor = this.moveSelect('down', n, this.partyCursor);
    if (b && this.partyPurpose !== 'forced') this.mode = this.partyPurpose === 'switch' ? 'main' : 'bag';
    if (a) this.choosePartyMon(this.partyCursor);
  }

  private choosePartyMon(i: number) {
    this.partyCursor = i;
    if (this.partyPurpose === 'item') {
      this.submit({type: 'item', item: this.pendingItem!, target: i});
    } else if (this.partyPurpose === 'ether') {
      this.pendingTarget = i;
      this.moveCursor = 0;
      this.mode = 'etherMove';
    } else {
      this.partyMenuCursor = 0;
      this.mode = 'partyMenu';
    }
  }

  private updatePartyMenu(a: boolean, b: boolean) {
    if (this.input.pressed('up')) this.partyMenuCursor = this.moveSelect('up', 3, this.partyMenuCursor);
    if (this.input.pressed('down')) this.partyMenuCursor = this.moveSelect('down', 3, this.partyMenuCursor);
    if (b) this.mode = 'party';
    if (a) this.choosePartyMenu(this.partyMenuCursor);
  }

  private choosePartyMenu(n: number) {
    if (n === 0) {
      this.mode = 'party';
      this.submit({type: 'switch', index: this.partyCursor});
    } else if (n === 1) {
      this.statsPage = 0;
      this.mode = 'stats';
    } else {
      this.mode = 'party';
    }
  }

  private updateStats(a: boolean, b: boolean) {
    if (a) {
      if (this.statsPage < STATS_PAGES - 1) this.statsPage++;
      else this.mode = 'party';
    }
    if (b) this.mode = 'party';
  }

  private bagItems() {
    return Object.keys(this.b.sides.player.bag);
  }

  private updateBag(a: boolean, b: boolean) {
    const n = this.bagItems().length + 1; // + CANCEL
    if (this.input.pressed('up')) this.bagCursor = Math.max(0, this.bagCursor - 1);
    if (this.input.pressed('down')) this.bagCursor = Math.min(n - 1, this.bagCursor + 1);
    if (this.bagCursor < this.bagScroll) this.bagScroll = this.bagCursor;
    if (this.bagCursor > this.bagScroll + BAG_ROWS - 1) this.bagScroll = this.bagCursor - BAG_ROWS + 1;
    if (b) this.mode = 'main';
    if (a) this.chooseBag(this.bagCursor);
  }

  private chooseBag(i: number) {
    const items = this.bagItems();
    this.bagCursor = i;
    if (i >= items.length) {
      this.mode = 'main';
      return;
    }
    const item = items[i];
    this.pendingItem = item;
    if (item === 'ETHER') this.openParty('ether');
    else if (TARGETED_ITEMS.has(item)) this.openParty('item');
    else this.submit({type: 'item', item});
  }

  private updateEtherMove(a: boolean, b: boolean) {
    const n = this.b.sides.player.team[this.pendingTarget].moves.length;
    if (this.input.pressed('up')) this.moveCursor = this.moveSelect('up', n, this.moveCursor);
    if (this.input.pressed('down')) this.moveCursor = this.moveSelect('down', n, this.moveCursor);
    if (b) this.mode = 'party';
    if (a) this.submit({type: 'item', item: 'ETHER', target: this.pendingTarget, moveSlot: this.moveCursor});
  }

  // ---------- animation steps ----------

  private makeShown(side: SideId, index: number, snap = false): Shown {
    const m = this.b.sides[side].team[index];
    return {species: m.species, level: m.level, hp: snap ? m.hp : m.maxHp, maxHp: m.maxHp,
      status: snap ? m.status : m.status, dx: 0, dy: 0, scale: 1, hidden: false, snapHp: true, white: 0, sub: false};
  }

  private frames(n: number, each: (f: number) => void, done?: () => void): Step {
    let f = 0;
    return {tick: () => {
      each(f);
      f++;
      if (f >= n) {
        done?.();
        return true;
      }
      return false;
    }};
  }

  private slideTrainerIn(): Step {
    return this.frames(40, f => {
      const t = (f + 1) / 40;
      this.trainer.x = -40 + 162 * t; // Red slides in from the left onto his platform
      this.me.x = 200 - 160 * t; // you slide in from the right onto yours
    });
  }

  /** Types out a message. Waits for A, except "X used MOVE!" lines, which flow into the attack animation. */
  private textStep(s: string, flowsIntoAnimation = false): Step {
    this.textWaiting = false;
    let held = 0;
    const pages: string[][] = [];
    const ls = wrap(s);
    for (let i = 0; i < ls.length; i += 2) pages.push(ls.slice(i, i + 2));
    let page = 0, chars = 0;
    return {tick: () => {
      const p = pages[page];
      const total = p.join('').length;
      if (chars < total) {
        chars = this.skip ? total : chars + 1;
        this.skip = false;
      } else {
        // Wait for the player to press A (or tap) before the next message, like Gen 1.
        const last = page === pages.length - 1;
        if (flowsIntoAnimation && last) held++;
        else this.textWaiting = true;
        if (this.skip || held > 30) {
          this.textWaiting = false;
          this.skip = false;
          page++;
          chars = 0;
          if (page >= pages.length) return true;
        }
      }
      // reveal `chars` characters across the lines on this page
      let left = chars;
      this.lines = pages[Math.min(page, pages.length - 1)].map(l => {
        const shown = l.slice(0, Math.max(0, left));
        left -= l.length;
        return shown;
      });
      return false;
    }};
  }

  private stepFor(ev: BattleEvent): Step | null {
    switch (ev.t) {
      case 'text':
        if (ev.s.includes('super effective')) audio.sfx('super');
        else if (ev.s.includes('not very effective')) audio.sfx('weak');
        return this.textStep(ev.s, this.queue[0]?.t === 'move' || this.queue[0]?.t === 'send');
      case 'hp': {
        const s = this.shown[ev.side];
        if (!s) return null;
        s.maxHp = ev.max;
        if (s.snapHp) {
          s.hp = ev.hp;
          s.snapHp = false;
          return null;
        }
        const speed = Math.max(1, Math.round(ev.max / 48));
        if (ev.hp > s.hp) audio.sfx('heal');
        return {tick: () => {
          if (s.hp === ev.hp) return true;
          s.hp = s.hp < ev.hp ? Math.min(ev.hp, s.hp + speed) : Math.max(ev.hp, s.hp - speed);
          return false;
        }};
      }
      case 'status': {
        const s = this.shown[ev.side];
        if (s) s.status = ev.status;
        return null;
      }
      case 'move': {
        // The attacker lunges, then the move's type animation plays (see moveFx.ts).
        const s = this.shown[ev.side];
        if (this.away[ev.side] && s) { this.away[ev.side] = false; s.hidden = false; s.dy = 0; } // back from Dig / Fly
        if (ev.charge) {
          // Turn 1 of a two-turn move: only the build-up (Solar Beam gathers light, Dig burrows, Fly takes off...).
          const me = ev.side === 'player' ? {x: 40, y: 74} : {x: 122, y: 38};
          const fx: Fx = {type: MOVES[ev.move]?.type ?? 'Normal', kind: 'charge', move: ev.move, from: me, to: me, t: 0};
          const n = 54;
          return this.frames(n, f => {
            fx.t = (f + 1) / n;
            this.fx = fx;
            if (!s) return;
            const p = (f + 1) / n;
            if (ev.move === 'dig') s.dy = Math.max(0, p - 0.35) / 0.65 * 40;
            else if (ev.move === 'fly') s.dy = -Math.max(0, p - 0.35) / 0.65 * 70;
            else if (ev.move === 'skullbash') s.dy = Math.sin(Math.PI * p) * 3;
          }, () => {
            this.fx = null;
            if (s && (ev.move === 'dig' || ev.move === 'fly')) { this.away[ev.side] = true; s.hidden = true; }
            else if (s) s.dy = 0;
          });
        }
        const dir = ev.side === 'player' ? 1 : -1;
        const mv = MOVES[ev.move];
        const FIXED = ['seismictoss', 'nightshade', 'sonicboom', 'dragonrage', 'superfang', 'psywave', 'counter', 'bide'];
        const attack = !!mv && (mv.power > 1 || !!mv.ohko || FIXED.includes(ev.move));
        const selfMove = !!mv && mv.target === 'self';
        const kind: Fx['kind'] = attack ? 'attack' : selfMove ? 'boost' : 'status';
        const me = ev.side === 'player' ? {x: 40, y: 74} : {x: 122, y: 38};
        const them = ev.side === 'player' ? {x: 122, y: 38} : {x: 40, y: 74};
        const lunge = this.frames(8, f => {
          if (s && kind === 'attack') s.dx = f < 4 ? dir * f * 2 : dir * (8 - f) * 2;
        }, () => { if (s) s.dx = 0; });
        const fx: Fx = {type: mv?.type ?? 'Normal', kind, move: ev.move, from: me, to: kind === 'boost' ? me : them, t: 0};
        const n = fxFrames(ev.move);
        const play = this.frames(n, f => {
          fx.t = (f + 1) / n;
          this.fx = fx;
          this.gfx.offsetX = fxShake(fx);
        }, () => {
          this.fx = null;
          this.gfx.offsetX = 0;
        });
        return this.chain([lunge, play]);
      }
      case 'hit': {
        audio.sfx('hit');
        const s = this.shown[ev.side];
        return this.frames(24, f => {
          if (s) s.hidden = Math.floor(f / 4) % 2 === 1;
          this.gfx.offsetX = f < 8 ? (f % 2 ? 2 : -2) : 0;
        }, () => { if (s) s.hidden = false; this.gfx.offsetX = 0; });
      }
      case 'faint': {
        this.away[ev.side] = false;
        audio.sfx('faint');
        const s = this.shown[ev.side];
        return this.frames(20, f => { if (s) s.dy = (f + 1) * 3; }, () => { this.shown[ev.side] = null; });
      }
      case 'withdraw': {
        this.away[ev.side] = false;
        const s = this.shown[ev.side];
        return this.frames(12, f => { if (s) s.scale = 1 - (f + 1) / 12; }, () => { this.shown[ev.side] = null; });
      }
      case 'send': {
        // 1) The trainer throws a spinning Pokéball in an arc onto the platform,
        // 2) it bursts open in a flash, 3) the Pokémon grows out of the light (glowing white, then fading in),
        // while the trainer steps away.
        const front = ev.side === 'red';
        const trainer = front ? this.trainer : this.me;
        // The trainer steps aside first, then the ball arcs in from that side.
        const stepAside = trainer.visible
          ? this.frames(16, () => {
            if (front) this.trainer.x += 3.5;
            else this.me.x -= 3.5;
          })
          : null;
        const from = front ? {x: 166, y: 30} : {x: -8, y: 70};
        const to = front ? {x: 122, y: 52} : {x: 40, y: 86};
        const s = this.makeShown(ev.side, ev.index);
        s.scale = 0;
        s.white = 1;
        const throwBall = this.frames(26, f => {
          if (f === 0) audio.sfx('blip');
          const t = (f + 1) / 26;
          this.ball = {
            x: from.x + (to.x - from.x) * t,
            y: from.y + (to.y - from.y) * t - Math.sin(Math.PI * t) * (front ? 22 : 30),
            rot: t * Math.PI * 4 * (front ? -1 : 1),
          };
        });
        const openUp = this.frames(20, f => {
          if (f === 0) {
            audio.sfx('ball');
            this.ball = null;
            this.burst = {x: to.x, y: to.y, t: 0};
            this.shown[ev.side] = s;
          }
          if (this.burst) this.burst.t = (f + 1) / 20;
          s.scale = Math.min(1, (f + 1) / 14);
          s.white = Math.max(0, 1 - (f + 1) / 18);
          if (trainer.visible) {
            if (front) this.trainer.x += 5;
            else this.me.x -= 5;
          }
        }, () => {
          this.burst = null;
          s.white = 0;
          s.scale = 1;
          trainer.visible = false;
        });
        return this.chain(stepAside ? [stepAside, throwBall, openUp] : [throwBall, openUp]);
      }
      case 'transform': {
        const s = this.shown[ev.side];
        return this.frames(20, f => {
          if (s) s.hidden = f % 4 < 2;
          if (s && f === 10) s.species = ev.species;
        }, () => { if (s) s.hidden = false; });
      }
      case 'sub': {
        const s = this.shown[ev.side];
        if (!s) return null;
        // A puff of smoke, and the doll appears (or the Pokémon comes back when it breaks).
        return this.frames(18, f => {
          if (f === 9) s.sub = ev.up;
          s.white = f < 9 ? f / 9 : (18 - f) / 9;
        }, () => { s.white = 0; s.sub = ev.up; });
      }
      case 'end':
        audio.music(ev.winner === 'player' ? 'victory' : 'defeat');
        return null;
    }
  }

  private chain(steps: Step[]): Step {
    let i = 0;
    return {tick: () => {
      while (i < steps.length && steps[i].tick()) i++;
      return i >= steps.length;
    }};
  }

  // ---------- drawing ----------

  draw() {
    const g = this.gfx;
    this.hot = [];
    g.clear();
    switch (this.mode) {
      case 'party': case 'partyMenu': this.drawParty(); break;
      case 'stats': this.drawStats(); break;
      default: this.drawBattle();
    }
    if (this.flash) g.invert();
  }

  private monSprite(side: SideId, s: Shown) {
    if (s.hidden || s.scale <= 0) return;
    const g = this.gfx;
    if (s.sub) return this.subDoll(side, s);
    const ani = getAni(aniUrl(s.species, side === 'player'));
    if (ani) {
      // Animated 3D model. These already come at their real relative sizes.
      const front = side === 'red';
      // Your side is closer to the camera, so it's drawn bigger (like the modern games).
      const k = Math.min(front ? 0.46 : 0.62, (front ? 56 : 68) / ani.height, (front ? 80 : 84) / ani.width) * s.scale;
      const w = ani.width * k, h = ani.height * k;
      const cx = front ? 122 : 40, ground = front ? 60 : 97;
      g.ctx.save();
      g.ctx.beginPath();
      g.ctx.rect(front ? 72 : 0, front ? 0 : 16, front ? 88 : 108, front ? 63 : 80);
      g.ctx.clip();
      // Soft shadow on the ground.
      g.ctx.fillStyle = 'rgba(0, 0, 0, 0.13)';
      g.ctx.beginPath();
      g.ctx.ellipse(cx + s.dx, ground - 1.5, Math.max(6, w * 0.38), front ? 3 : 4, 0, 0, Math.PI * 2);
      g.ctx.fill();
      g.ctx.imageSmoothingEnabled = true;
      g.ctx.imageSmoothingQuality = 'high';
      let pic: CanvasImageSource = aniFrame(ani, performance.now());
      if (s.white > 0) {
        // Glow white while coming out of the Pokéball.
        const f = pic as HTMLCanvasElement;
        this.tint.width = f.width;
        this.tint.height = f.height;
        const tc = this.tint.getContext('2d')!;
        tc.drawImage(f, 0, 0);
        tc.globalCompositeOperation = 'source-atop';
        tc.fillStyle = `rgba(255, 255, 255, ${s.white})`;
        tc.fillRect(0, 0, f.width, f.height);
        pic = this.tint;
      }
      g.image(pic, cx - ani.cx * k + s.dx, ground - h + s.dy, w, h);
      g.ctx.restore();
      return;
    }
    // Still loading: the Game Boy sprite, sized by real height.
    const sp = SPECIES[s.species];
    const raw = this.getSprite(side === 'red' ? frontUrl(sp.num) : backUrl(sp.num));
    if (!raw) return;
    const img = sizedSprite(raw, sp.height, side === 'red' ? 56 : 32, `${side}:${s.species}`);
    if (side === 'red') {
      const w = 56 * s.scale, h = 56 * s.scale;
      g.ctx.save();
      g.ctx.beginPath();
      g.ctx.rect(96, 0, 64, 56);
      g.ctx.clip();
      g.image(img, 96 + s.dx + (56 - w) / 2, s.dy + (56 - h), w, h);
      g.ctx.restore();
    } else {
      const w = 64 * s.scale, h = 64 * s.scale;
      g.ctx.save();
      g.ctx.beginPath();
      g.ctx.rect(0, 32, 80, 64);
      g.ctx.clip();
      g.image(img, 8 + s.dx + (64 - w) / 2, 32 + s.dy + (64 - h), w, h);
      g.ctx.restore();
    }
  }

  /** The Substitute doll: a little cream plush figure (seen from the front for Red, from behind for you). */
  private subDoll(side: SideId, s: Shown) {
    const c = this.gfx.ctx;
    const front = side === 'red';
    const size = front ? 22 : 30;
    const cx = (front ? 122 : 40) + s.dx + this.gfx.offsetX, ground = front ? 60 : 97;
    const k = size / 24;
    c.save();
    c.fillStyle = 'rgba(0, 0, 0, 0.13)';
    c.beginPath();
    c.ellipse(cx, ground - 1.5, 9 * k, 3 * k, 0, 0, Math.PI * 2);
    c.fill();
    c.translate(cx, ground - 24 * k + Math.sin(performance.now() / 300) * 0.4);
    c.scale(k, k);
    c.fillStyle = '#f4ead2';
    c.strokeStyle = '#3a3346';
    c.lineWidth = 1.1;
    c.lineJoin = 'round';
    for (const dir of [-1, 1]) { // ears
      c.beginPath();
      c.moveTo(dir * 3, -1);
      c.quadraticCurveTo(dir * 9, -9, dir * 8, 1);
      c.closePath();
      c.fill();
      c.stroke();
    }
    c.beginPath(); // head
    c.ellipse(0, 4, 7, 6, 0, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.beginPath(); // body
    c.moveTo(-6, 9);
    c.quadraticCurveTo(-9, 22, -5, 23.5);
    c.lineTo(5, 23.5);
    c.quadraticCurveTo(9, 22, 6, 9);
    c.closePath();
    c.fill();
    c.stroke();
    for (const dir of [-1, 1]) { // arms
      c.beginPath();
      c.ellipse(dir * 7.5, 14, 2.2, 3.4, dir * 0.5, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    if (front) { // face
      c.fillStyle = '#3a3346';
      c.beginPath();
      c.arc(-2.6, 4, 1, 0, Math.PI * 2);
      c.arc(2.6, 4, 1, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.moveTo(-1.5, 6.6);
      c.quadraticCurveTo(0, 7.8, 1.5, 6.6);
      c.stroke();
    } else { // a stitched seam down its back
      c.strokeStyle = '#b9a98a';
      c.setLineDash([1.2, 1.2]);
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(0, 22);
      c.stroke();
    }
    if (s.white > 0) {
      c.globalAlpha = s.white;
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.ellipse(0, 11, 13, 14, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  /** Name, level/status and HP bar in a rounded panel (with HP numbers for both sides). */
  /** Info panel: name + level, HP bar, status badge + HP numbers, and the team's Pokéballs along the bottom. */
  private hudPanel(side: SideId, s: Shown, x: number, y: number, w: number, h: number, accent: string) {
    const g = this.gfx;
    g.panel(x, y, w, h, {accent, radius: 4});
    const tag = `Lv${s.level}`;
    const name = SPECIES[s.species].name;
    // Long names (CHARMELEON, BUTTERFREE…) shrink a little so they never touch the level.
    const room = w - 12 - textWidth(tag) - 3;
    const full = textWidth(name);
    if (full <= room) g.text(name, x + 6, y + 3);
    else g.smallText(name, x + 6, y + 3.6, C.ink, Math.max(5, 7.5 * (room / full)));
    g.textRight(tag, x + w - 4, y + 3);
    g.hpBar(x + 20, y + 14, s.hp, s.maxHp, w - 25);
    if (s.status) {
      const label = STATUS_LABEL[s.status];
      const tw = textWidth(label) + 4;
      g.ctx.save();
      g.ctx.fillStyle = STATUS_COLORS[s.status] ?? C.light;
      g.ctx.beginPath();
      g.ctx.roundRect?.(x + 6, y + 21, tw, 8, 2);
      g.ctx.fill();
      g.ctx.restore();
      g.text(label, x + 8, y + 21, '#ffffff');
    }
    g.textRight(`${s.hp}/${s.maxHp}`, x + w - 4, y + 21);
    // How many are left: one ball per team member (grey = fainted, purple = has a status).
    this.ballRow(side, x + 9, y + h - 5.5, 2.4, 6.6);
  }

  private ballRow(side: SideId, x0: number, cy: number, r: number, gap: number) {
    const c = this.gfx.ctx;
    this.b.sides[side].team.forEach((m, i) => {
      const cx = x0 + i * gap, state = m.hp === 0 ? 'fainted' : m.status ? 'bad' : 'ok';
      c.save();
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fillStyle = '#ffffff'; c.fill();
      c.beginPath(); c.arc(cx, cy, r, Math.PI, 0);
      c.fillStyle = state === 'fainted' ? '#a7adb8' : state === 'bad' ? '#a050c8' : C.accentRed; c.fill();
      c.lineWidth = 0.6; c.strokeStyle = C.border;
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.moveTo(cx - r, cy); c.lineTo(cx + r, cy); c.stroke();
      c.beginPath(); c.arc(cx, cy, r * 0.32, 0, Math.PI * 2); c.fillStyle = '#ffffff'; c.fill(); c.stroke();
      c.restore();
    });
  }

  private drawBattle() {
    const g = this.gfx;
    if (this.arena) drawArenaBackground(g, this.arena, performance.now());
    else g.battleBackground(performance.now());
    const red = this.shown.red, me = this.shown.player;

    // The trainers during the intro, standing on their platforms.
    const trainerPic = (img: HTMLCanvasElement, cx: number, ground: number, height: number, mirror: boolean) => {
      const k = height / img.height, w = img.width * k;
      g.ctx.save();
      g.ctx.imageSmoothingEnabled = false;
      if (mirror) {
        g.ctx.translate(cx * 2, 0);
        g.ctx.scale(-1, 1);
      }
      g.image(img, cx - w / 2, ground - height, w, height);
      g.ctx.restore();
    };
    if (this.me.visible && this.playerSprite) trainerPic(this.playerSprite, this.me.x, 99, 44, true);
    if (this.trainer.visible && this.redSprite) {
      trainerPic(this.redSprite, this.trainer.x, 61, 36, false);
    }

    // Pokémon first, then their info panels on top, tucked into opposite corners.
    if (red) this.monSprite('red', red);
    if (me) this.monSprite('player', me);
    this.drawThrow();
    fxOverlay(g, this.fx);
    drawFx(g, this.fx);
    this.drawPartyBalls();
    if (red) this.hudPanel('red', red, 2, 2, 76, 38, C.accentRed);
    if (me) this.hudPanel('player', me, 82, 56, 76, 38, C.accentBlue);

    // Text box.
    g.tileBox(0, 12, 20, 6);
    if (this.mode === 'main') this.drawMainMenu();
    else if (this.mode === 'forfeit') this.drawForfeitMenu();
    else if (this.mode === 'fight' || this.mode === 'etherMove') this.drawFightMenu();
    else if (this.mode === 'mimicPick') this.drawMimicMenu();
    else if (this.mode === 'bag') this.drawBag();
    else {
      this.lines.forEach((l, i) => g.text(l, 8, 112 + i * 16));
      const blink = Math.floor(this.frame / 20) % 2 === 0;
      if ((this.mode === 'end' || (this.mode === 'anim' && this.textWaiting)) && blink) g.downArrow(144, 132);
    }
  }

  /** Pokéballs showing how many Pokémon each side has left (shown before a mon is out). */
  /** The thrown Pokéball and the flash when it opens. */
  private drawThrow() {
    const c = this.gfx.ctx;
    if (this.ball) {
      const {x, y, rot} = this.ball, r = 2.6;
      c.save();
      c.translate(x, y);
      c.rotate(rot);
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(0, 0, r, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = C.accentRed;
      c.beginPath();
      c.arc(0, 0, r, Math.PI, 0);
      c.fill();
      c.strokeStyle = C.border;
      c.lineWidth = 0.6;
      c.beginPath();
      c.arc(0, 0, r, 0, Math.PI * 2);
      c.moveTo(-r, 0);
      c.lineTo(r, 0);
      c.stroke();
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(0, 0, 0.85, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.restore();
    }
    if (this.burst) {
      const {x, y, t} = this.burst;
      c.save();
      c.globalAlpha = Math.max(0, 1 - t);
      const glow = c.createRadialGradient(x, y, 0, x, y, 6 + t * 22);
      glow.addColorStop(0, 'rgba(255, 255, 255, 1)');
      glow.addColorStop(0.5, 'rgba(255, 250, 220, 0.8)');
      glow.addColorStop(1, 'rgba(255, 240, 200, 0)');
      c.fillStyle = glow;
      c.beginPath();
      c.arc(x, y, 6 + t * 22, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#ffffff';
      c.lineWidth = 1;
      c.lineCap = 'round';
      for (let i = 0; i < 8; i++) { // rays
        const a = (i * Math.PI) / 4 + t;
        c.beginPath();
        c.moveTo(x + Math.cos(a) * (4 + t * 10), y + Math.sin(a) * (4 + t * 10));
        c.lineTo(x + Math.cos(a) * (8 + t * 20), y + Math.sin(a) * (8 + t * 20));
        c.stroke();
      }
      c.restore();
    }
  }

  /** Each side's team as Pokéballs on a little tray (grey = fainted, purple tint = has a status). */
  private drawPartyBalls() {
    const g = this.gfx, c = g.ctx;
    const ball = (cx: number, cy: number, state: 'ok' | 'bad' | 'fainted') => {
      const r = 3.2;
      c.save();
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.fillStyle = '#ffffff';
      c.fill();
      c.beginPath();
      c.arc(cx, cy, r, Math.PI, 0);
      c.fillStyle = state === 'fainted' ? '#a7adb8' : state === 'bad' ? '#a050c8' : C.accentRed;
      c.fill();
      c.lineWidth = 0.7;
      c.strokeStyle = C.border;
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.moveTo(cx - r, cy);
      c.lineTo(cx + r, cy);
      c.stroke();
      c.beginPath();
      c.arc(cx, cy, 1, 0, Math.PI * 2);
      c.fillStyle = '#ffffff';
      c.fill();
      c.stroke();
      c.restore();
    };
    for (const side of ['red', 'player'] as SideId[]) {
      if (this.shown[side]) continue;
      const team = this.b.sides[side].team;
      const x0 = side === 'red' ? 6 : 88, y0 = side === 'red' ? 6 : 78;
      g.panel(x0, y0, 64, 11, {radius: 5, accent: side === 'red' ? C.accentRed : C.accentBlue});
      team.forEach((m, i) => ball(x0 + 12 + i * 9, y0 + 5.5, m.hp === 0 ? 'fainted' : m.status ? 'bad' : 'ok'));
    }
  }

  private drawMainMenu() {
    const g = this.gfx;
    g.tileBox(7, 12, 13, 6);
    const items = ['FIGHT', 'PKMN', 'ITEM', 'FORFEIT'];
    items.forEach((label, i) => {
      const x = i % 2 === 0 ? 72 : 120, y = i < 2 ? 112 : 128;
      g.text(label, x, y);
      if (this.mainCursor === i) g.cursor(x - 8, y);
      this.hot.push({x: x - 8, y: y - 4, w: 48, h: 16, fn: () => this.chooseMain(i)});
    });
  }

  private drawFightMenu() {
    const g = this.gfx;
    const ether = this.mode === 'etherMove';
    const mon = ether ? this.b.sides.player.team[this.pendingTarget] : this.b.mon('player');
    const v = this.b.sides.player.v;
    const moves = ether ? mon.moves : v.moves;
    const pp = ether ? mon.pp : (v.tpp ?? mon.pp);
    const maxPp = ether ? mon.maxPp : v.tpp ? moves.map(() => 5) : mon.maxPp;

    g.tileBox(7, 12, 13, 6);
    for (let i = 0; i < 4; i++) {
      const y = 102 + i * 10;
      if (moves[i]) {
        const mv = MOVES[moves[i]];
        typeIcon(g, 68, y - 0.5, 9, mv.type);
        g.text(mv.name, 80, y);
        this.hot.push({x: 56, y: y - 1, w: 104, h: 10, fn: () => {
          if (ether) {
            this.moveCursor = i;
            this.submit({type: 'item', item: 'ETHER', target: this.pendingTarget, moveSlot: i});
          } else this.chooseMove(i);
        }});
      } else {
        g.text('-', 80, y, C.light);
      }
    }
    g.cursor(60, 102 + this.moveCursor * 10);

    // Left box: what the highlighted move does (so new players know their moves).
    g.tileBox(0, 12, 7, 6);
    const sel = moves[this.moveCursor];
    if (sel) this.wrapSmall(moveDesc(sel), 6, 103, 45, 37);

    // Info panel: type badge, power, accuracy, PP.
    const id = moves[this.moveCursor];
    if (!id) return;
    const m = MOVES[id];
    g.panel(2, 50, 78, 44, {accent: TYPE_COLORS[m.type], radius: 4});
    const disabled = !ether && v.disabled?.slot === this.moveCursor;
    if (disabled) {
      g.text('DISABLED!', 9, 66, C.accentRed);
    } else {
      typePill(g, 8, 55, m.type, 9);
      const row = (label: string, value: string, y: number) => {
        g.smallText(label, 9, y + 1.2, C.light, 5.5);
        g.textRight(value, 74, y);
      };
      row('POWER', powerLabel(id), 67);
      row('ACCURACY', m.acc === null ? '—' : `${m.acc}`, 76);
      row('PP', `${pp[this.moveCursor]}/${maxPp[this.moveCursor]}`, 85);
    }
  }

  /** Small text wrapped to a width; shrinks the font until it fits the height. */
  private wrapSmall(text: string, x: number, y: number, w: number, h: number) {
    const g = this.gfx;
    for (let size = 5.5; size >= 3.5; size -= 0.5) {
      const lines: string[] = [];
      let line = '';
      for (const word of text.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (g.smallWidth(next, size) > w && line) { lines.push(line); line = word; } else line = next;
      }
      if (line) lines.push(line);
      const lh = size + 1.4;
      if (lines.length * lh <= h || size <= 3.5) {
        lines.forEach((l, i) => g.smallText(l, x, y + i * lh, C.ink, size));
        return;
      }
    }
  }

  private drawBag() {
    const g = this.gfx;
    const bag = this.b.sides.player.bag;
    const rows = drawBagList(g, bag, this.bagCursor, this.bagScroll, this.frame);
    rows.forEach(({i, y}) => this.hot.push({x: 0, y, w: W, h: 16, fn: () => this.chooseBag(i)}));
  }

  private drawParty() {
    const g = this.gfx;
    const team = this.b.sides.player.team;
    drawPartyRows(g, team, this.partyCursor, this.b.sides.player.active, this.mode === 'partyMenu',
      species => this.getSprite(frontUrl(SPECIES[species].num)), this.frame);
    team.forEach((_, i) => this.hot.push({x: 0, y: i * 16, w: W, h: 16, fn: () => {
      if (this.mode === 'partyMenu') this.mode = 'party';
      this.choosePartyMon(i);
    }}));
    g.tileBox(0, 12, 20, 6);
    if (this.mode === 'partyMenu') {
      g.tileBox(11, 11, 9, 7);
      ['SWITCH', 'STATS', 'CANCEL'].forEach((label, i) => {
        const y = 104 + i * 12;
        g.text(label, 104, y);
        if (i === this.partyMenuCursor) g.cursor(96, y);
        this.hot.push({x: 88, y: y - 2, w: 72, h: 12, fn: () => this.choosePartyMenu(i)});
      });
      wrap(this.prompt, 78).slice(0, 2).forEach((l, i) => g.text(l, 8, 112 + i * 16));
    } else {
      wrap(this.prompt).slice(0, 2).forEach((l, i) => g.text(l, 8, 112 + i * 16));
      if (this.partyPurpose !== 'forced') {
        this.hot.push({x: 0, y: 96, w: W, h: 48, fn: () => { this.mode = this.partyPurpose === 'switch' ? 'main' : 'bag'; }});
      }
    }
  }

  private drawStats() {
    const m = this.b.sides.player.team[this.partyCursor];
    drawStatsPage(this.gfx, m, this.statsPage, this.getSprite(frontUrl(SPECIES[m.species].num)), this.frame);
    this.hot.push({x: 0, y: 0, w: W, h: 144, fn: () => this.updateStats(true, false)});
  }
}
