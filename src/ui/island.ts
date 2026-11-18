// The island: a single 10×9-tile screen. Walk up to Red; he spots you, walks over, and the battle starts.

import {Gfx, C, wrap, loadSprite, frontUrl, redUrl, playerUrl} from './gfx';
import type {Input} from './input';
import {TypeText, type Scene} from './scene';
import {Battle, type BMon} from '../engine/battle';
import {SPECIES} from '../engine/data';
import {audio} from '../audio';
import {loadAni, aniUrl} from './ani';
import {drawSea, drawLand, drawDecor, drawDock, drawGrass, drawRock, drawPalm} from './islandArt';
import {drawRoomBack, drawPillar, drawRoomLight, ROOM_MAP, ROOM_FOE, ROOM_PLAYER, type RoomKey} from './eliteArt';
import {drawPartyRows, drawStatsPage, drawBagList, BAG_ROWS, STATS_PAGES} from './teamViews';

type Dir = 'up' | 'down' | 'left' | 'right';

// w water · s sand · g grass tuft · p palm · r rock · d dock
const MAP = [
  'wwwwwwwwww',
  'wwwsssssww',
  'wwsssssps',
  'wpssssssww',
  'wsssgssssw',
  'wwssssrssw',
  'wwsgssssww',
  'wwwsdsswww',
  'wwwwdwwwww',
].map(r => r.padEnd(10, 'w'));

const BLOCKED = new Set(['w', 'p', 'r']);
const RED_START = {x: 4, y: 2};
const PLAYER_START = {x: 4, y: 8};

/** Where the walk-up happens: the island (daily battles) or an Elite Four room. */
export interface Place {
  map: string[];
  blocked: Set<string>;
  foeStart: {x: number; y: number};
  playerStart: {x: number; y: number};
  foeUrl: string;
  foeName: string; // "RED", "LORELEI"…
  intro: string[][];
  talk: string[][];
  room?: RoomKey; // Elite Four room artwork (the island otherwise)
  /** Elite Four room after you won: the back door is open and walking through it calls this. */
  cleared?: () => void;
  tag?: string; // floating name tag in the room
}
export const ISLAND: Place = {
  map: MAP, blocked: BLOCKED, foeStart: RED_START, playerStart: PLAYER_START, foeUrl: redUrl, foeName: 'RED',
  intro: [['You washed ashore', 'on a tiny island.'], ['Your 6 POKÉMON', 'are with you.'], ['Check them with', 'START anytime.'], ['Someone is waiting', 'up ahead...']],
  talk: [['RED: ...'], ['RED: ...!'], ['Check your team', 'before you fight?']],
};
/** An Elite Four room (same walking, menus and battle start as the island). */
export function eliteRoom(room: RoomKey, foeUrl: string, foeName: string, tag: string, intro: string[][], talk: string[][]): Place {
  return {map: ROOM_MAP, blocked: new Set(['#', 'P']), foeStart: ROOM_FOE, playerStart: ROOM_PLAYER, foeUrl, foeName, intro, talk, room, tag};
}

const PAL = {
  sand: '#f8e0a8', sandDot: '#d8b070', sandEdge: '#c89858',
  water: '#78b8f0', waterDark: '#4888d0', foam: '#f8f8f8',
  grass: '#58b048', grassDark: '#307830',
  trunk: '#a86830', trunkDark: '#704018', leaf: '#40a840', leafDark: '#206820',
  rock: '#a0a0a0', rockDark: '#585858',
  plank: '#c08048', plankDark: '#704820',
};

// 16×16 overworld sprites. k ink · c cap · w white · s skin · h hair · t shirt · p pants
const DOWN = [
  '................', '.....kkkkkk.....', '....kcccccck....', '...kccwwwwcck...',
  '...kkkkkkkkkk...', '...kssssssssk...', '...kskssssksk...', '....kssssssk....',
  '...kttkkkkttk...', '..ksktttttttsk..', '..ksktttttttsk..', '...kkpppppppk...',
  '....kpppppppk...', '....kppkkkppk...', '....kkk...kkk...', '................',
];
const UP = [
  '................', '.....kkkkkk.....', '....kcccccck....', '...kcccccccck...',
  '...kcccccccck...', '...kkkkkkkkkk...', '...khhhhhhhhk...', '....khhhhhhk....',
  '...kttkkkkttk...', '..ksktttttttsk..', '..ksktttttttsk..', '...kkpppppppk...',
  '....kpppppppk...', '....kppkkkppk...', '....kkk...kkk...', '................',
];
const RIGHT = [
  '................', '....kkkkkk......', '...kccccccck....', '...kcccccwwk....',
  '..kkkkkkkkkkkk..', '...khhhssssk....', '...khhsssksk....', '....kssssssk....',
  '....kttttttk....', '....kttsstttk...', '....kttsstttk...', '....kppppppk....',
  '....kppppppk....', '....kppkkppk....', '....kkkk.kkkk...', '................',
];

interface Look { c: string; t: string; p: string }
const PLAYER_LOOK: Look = {c: '#3878e0', t: '#40a060', p: '#384870'};
const RED_LOOK: Look = {c: '#e03820', t: '#e03820', p: '#3050c0'};

const spriteCache = new Map<string, HTMLCanvasElement>();
function charSprite(dir: Dir, look: Look): HTMLCanvasElement {
  const key = dir + look.c;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const rows = dir === 'down' ? DOWN : dir === 'up' ? UP : RIGHT;
  const cv = document.createElement('canvas');
  cv.width = 16;
  cv.height = 16;
  const ctx = cv.getContext('2d')!;
  const colors: Record<string, string> = {k: C.ink, c: look.c, w: '#f8f8f8', s: '#f8c8a0', h: '#583018', t: look.t, p: look.p};
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (!colors[ch]) return;
    ctx.fillStyle = colors[ch];
    ctx.fillRect(dir === 'left' ? 15 - x : x, y, 1, 1);
  }));
  spriteCache.set(key, cv);
  return cv;
}

class Walker {
  px: number;
  py: number;
  moving: {dx: number; dy: number; f: number} | null = null;
  constructor(public x: number, public y: number, public dir: Dir, public look: Look) {
    this.px = x * 16;
    this.py = y * 16;
  }
  start(dir: Dir) {
    const [dx, dy] = {up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0]}[dir];
    this.dir = dir;
    this.moving = {dx, dy, f: 0};
  }
  /** Advances one frame; returns true on the frame a step finishes. */
  tick(): boolean {
    if (!this.moving) return false;
    const m = this.moving;
    m.f++;
    this.px = this.x * 16 + m.dx * m.f * 2;
    this.py = this.y * 16 + m.dy * m.f * 2;
    if (m.f >= 8) {
      this.x += m.dx;
      this.y += m.dy;
      this.moving = null;
      return true;
    }
    return false;
  }
  /** Detailed trainer picture (if loaded); the small pixel walker is the fallback. */
  hd: HTMLCanvasElement | null = null;
  /** Elite Four trainers stand on two tiles (x and x+1), drawn on the line between them. */
  wide = false;
  /** Back view, used while walking up (only drawn for the player). */
  back: HTMLCanvasElement | null = null;

  draw(g: Gfx) {
    const bob = this.moving && this.moving.f >= 2 && this.moving.f <= 5 ? -1 : 0;
    if (!this.hd) {
      g.image(charSprite(this.dir, this.look), this.px, this.py - 4 + bob, 16, 16);
      return;
    }
    const pic = this.dir === 'up' && this.back ? this.back : this.hd;
    const h = 21, w = (pic.width * h) / pic.height;
    const cx = this.px + (this.wide ? 16 : 8), ground = this.py + 15;
    const c = g.ctx;
    c.save();
    c.fillStyle = 'rgba(0, 0, 0, 0.18)'; // shadow on the sand
    c.beginPath();
    c.ellipse(cx, ground, 6, 2, 0, 0, Math.PI * 2);
    c.fill();
    c.imageSmoothingEnabled = false;
    if (this.dir === 'right') { // face the way you're walking
      c.translate(cx * 2, 0);
      c.scale(-1, 1);
    }
    // A little side-to-side sway while walking.
    const sway = this.moving ? (this.moving.f < 4 ? -0.6 : 0.6) : 0;
    g.image(pic, cx - w / 2 + sway, ground - h + bob, w, h);
    c.restore();
  }
}

type Phase = 'arrive' | 'walk' | 'startMenu' | 'party' | 'stats' | 'bag' | 'talk' | 'ready' | 'exclaim' | 'flash' | 'wipe';

const START_ITEMS = ['POKÉMON', 'ITEM', 'EXIT'];
const READY_ITEMS = ['POKÉMON', 'BAG', 'FIGHT!', 'NOT YET'];
const PARTY_ITEMS = ['STATS', 'SWITCH', 'CANCEL'];

/**
 * The player seen from behind, made from the front picture (Hilbert, trimmed to 35×71): same outline,
 * but the face becomes hair, the cap shows its back, the shirt front becomes jacket, and a backpack is added.
 */
function playerBackView(front: HTMLCanvasElement): HTMLCanvasElement {
  const W = front.width, H = front.height;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d')!;
  ctx.translate(W, 0); // mirrored, as if he turned round
  ctx.scale(-1, 1);
  ctx.drawImage(front, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const sy = H / 71, sx = W / 35; // picture is 35×71 at its original size
  const set = (i: number, r: number, g: number, b: number) => { d[i] = r; d[i + 1] = g; d[i + 2] = b; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (d[i + 3] < 100) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const dark = r + g + b < 150;
    const blue = b > 140 && r < 120;
    const light = r + g + b;
    const ry = y / sy, rx = x / sx;
    if (ry < 6.5) { // back of the cap: red with a dark band and a white strap at the bottom
      if (!dark) set(i, light > 400 ? 230 : 200, light > 400 ? 70 : 40, light > 400 ? 70 : 45);
    } else if (ry < 8) {
      if (!dark) set(i, 245, 245, 245);
    } else if (ry < 18) { // hair (face, ears and the saluting hand are hidden from behind)
      if (!blue && !dark) {
        const shade = (x + y) % 3 === 0 ? 1.25 : 1;
        set(i, 70 * shade, 42 * shade, 26 * shade);
      }
    } else if (ry < 40) { // jacket: the white shirt front becomes blue jacket
      if (!blue && !dark && light > 330) set(i, 60, 112, 200);
    }
  }
  ctx.putImageData(img, 0, 0);
  // Backpack on the shoulders, drawn only where the body is.
  ctx.globalCompositeOperation = 'source-atop';
  const bx = (35 - 26) * sx, by = 21 * sy, bw = 13 * sx, bh = 15 * sy;
  ctx.fillStyle = '#2b2d38';
  ctx.strokeStyle = '#0d0e12';
  ctx.lineWidth = Math.max(1, sx);
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 3 * sx);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#434656'; // flap
  ctx.fillRect(bx + sx, by + sy, bw - 2 * sx, 5 * sy);
  ctx.fillStyle = '#d8d8de'; // buckle
  ctx.fillRect(bx + bw / 2 - sx, by + 5 * sy, 2 * sx, 2 * sy);
  ctx.fillStyle = '#1a1b22'; // straps over the shoulders
  ctx.fillRect(bx + 2 * sx, by - 3 * sy, 2 * sx, 3 * sy);
  ctx.fillRect(bx + bw - 4 * sx, by - 3 * sy, 2 * sx, 3 * sy);
  return out;
}

export class IslandScene implements Scene {
  private player: Walker;
  private red: Walker;
  private phase: Phase = 'arrive';
  private text = new TypeText();
  private frame = 0;
  private timer = 0;
  private path: Dir[] = [];
  private talkAfterPath = false;
  private menuCursor = 0;
  private listCursor = 0;
  private bagScroll = 0;
  private statsPage = 0;
  private menuFrom: 'startMenu' | 'ready' = 'startMenu';
  private hot: {x: number; y: number; w: number; h: number; fn: () => void}[] = [];
  private sprites = new Map<number, HTMLCanvasElement>();
  /** Party screen: the STATS / SWITCH / CANCEL box is open. */
  private partyMenu = false;
  private partyMenuCursor = 0;
  /** Party screen: index of the POKÉMON being moved, while choosing where it goes. */
  private moving: number | null = null;
  /** Before the battle: uses an item on team member `target` (null = done, or why it can't be used). Unset = items only in battle. */
  onItem?: (item: string, target: number) => string | null;
  /** The item being used (party screen picks who gets it). */
  private usingItem: string | null = null;
  private exited = false;
  /** A short message over the bag/party screen (e.g. "Used POTION!"). */
  private note: string[] | null = null;
  private noteTimer = 0;

  get menuSounds() {
    return ['startMenu', 'ready', 'party', 'stats', 'bag'].includes(this.phase);
  }

  constructor(
    private gfx: Gfx, private input: Input,
    private team: BMon[], private bag: Record<string, number>,
    private onBattle: () => void,
    /** Swaps two team members (the battle records the new order). */
    private onSwap: (i: number, j: number) => void = () => {},
    private place: Place = ISLAND,
  ) {
    this.player = new Walker(place.playerStart.x, place.playerStart.y, 'up', PLAYER_LOOK);
    this.red = new Walker(place.foeStart.x, place.foeStart.y, 'down', RED_LOOK);
    this.red.wide = !!place.room;
    if (place.cleared) { // you stand where the battle was, the door behind the trainer is open
      this.player = new Walker(place.foeStart.x, place.foeStart.y + 2, 'up', PLAYER_LOOK);
      this.place = {...place, map: place.map.map((row, y) => y === 1 || y === 0 ? row.slice(0, 4) + '..' + row.slice(6) : row)};
    }
    this.text.show(place.intro);
    for (const m of team) {
      const n = SPECIES[m.species].num;
      void loadSprite(frontUrl(n)).then(img => this.sprites.set(n, img));
      void loadAni(aniUrl(m.species));
    }
    void loadSprite(playerUrl, true).then(img => {
      this.player.hd = img;
      this.player.back = playerBackView(img);
    });
    void loadSprite(place.foeUrl, true).then(img => { this.red.hd = img; });
  }

  private blocked(x: number, y: number) {
    if (x < 0 || y < 0 || x >= 10 || y >= 9) return true;
    if (this.place.blocked.has(this.place.map[y][x])) return true;
    return this.isRedTile(x, y);
  }

  private isRedTile(x: number, y: number) {
    return y === this.red.y && (x === this.red.x || (this.red.wide && x === this.red.x + 1));
  }

  /** Shortest walk to a tapped tile (for phones). */
  private findPath(tx: number, ty: number): Dir[] {
    const start = `${this.player.x},${this.player.y}`;
    const prev = new Map<string, [string, Dir]>([[start, ['', 'up']]]);
    const queue = [[this.player.x, this.player.y]];
    const steps: [Dir, number, number][] = [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]];
    while (queue.length) {
      const [x, y] = queue.shift()!;
      if (x === tx && y === ty) break;
      for (const [d, dx, dy] of steps) {
        const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
        if (prev.has(k) || this.blocked(nx, ny)) continue;
        prev.set(k, [`${x},${y}`, d]);
        queue.push([nx, ny]);
      }
    }
    const out: Dir[] = [];
    let k = `${tx},${ty}`;
    if (!prev.has(k)) return [];
    while (k !== start) {
      const [p, d] = prev.get(k)!;
      out.unshift(d);
      k = p;
    }
    return out;
  }

  private facingRed() {
    const p = this.player;
    const [dx, dy] = {up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0]}[p.dir];
    return this.isRedTile(p.x + dx, p.y + dy);
  }

  private isNextToRed() {
    const {x, y} = this.player;
    return this.isRedTile(x - 1, y) || this.isRedTile(x + 1, y) || this.isRedTile(x, y - 1) || this.isRedTile(x, y + 1);
  }

  private dirTo(x: number, y: number, from: {x: number; y: number} = this.player): Dir {
    const dx = x - from.x, dy = y - from.y;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
  }

  private talkToRed() {
    this.path = [];
    this.talkAfterPath = false;
    if (this.place.cleared) { // beaten: they just repeat their line
      this.player.dir = this.dirTo(this.red.x, this.red.y);
      this.phase = 'arrive';
      this.text.show(this.place.talk);
      return;
    }
    const rx = this.red.wide && this.player.x > this.red.x ? this.red.x + 1 : this.red.x;
    this.player.dir = this.dirTo(rx, this.red.y);
    this.red.dir = this.dirTo(this.player.x, this.player.y, this.red);
    this.phase = 'talk';
    this.text.show(this.place.talk);
  }

  private upDown(n: number, cur: number) {
    if (this.input.pressed('up')) return (cur + n - 1) % n;
    if (this.input.pressed('down')) return (cur + 1) % n;
    return cur;
  }

  update() {
    this.frame++;
    if (this.noteTimer > 0 && --this.noteTimer === 0) this.note = null;
    const i = this.input;
    const tap = i.taps[0];
    const hit = tap && this.hot.find(h => tap.x >= h.x && tap.x < h.x + h.w && tap.y >= h.y && tap.y < h.y + h.h);
    if (hit) {
      hit.fn();
      return;
    }
    const a = i.pressed('a') || (!!tap && this.phase !== 'walk');
    const b = i.pressed('b');

    switch (this.phase) {
      case 'arrive':
        this.text.tick(a);
        if (this.text.done) this.phase = 'walk';
        return;

      case 'walk':
        return this.updateWalk(tap, a);

      case 'startMenu':
        this.menuCursor = this.upDown(START_ITEMS.length, this.menuCursor);
        if (b || i.pressed('start')) this.phase = 'walk';
        else if (a) this.chooseMenu(START_ITEMS[this.menuCursor], 'startMenu');
        return;

      case 'ready':
        this.menuCursor = this.upDown(READY_ITEMS.length, this.menuCursor);
        if (b) this.phase = 'walk';
        else if (a) this.chooseMenu(READY_ITEMS[this.menuCursor], 'ready');
        return;

      case 'party':
        if (this.partyMenu) {
          this.partyMenuCursor = this.upDown(PARTY_ITEMS.length, this.partyMenuCursor);
          if (b) this.partyMenu = false;
          else if (a) this.choosePartyItem(this.partyMenuCursor);
          return;
        }
        this.listCursor = this.upDown(this.team.length, this.listCursor);
        if (this.usingItem) {
          if (b) this.endItem();
          else if (a) this.giveItem(this.listCursor);
          return;
        }
        if (b) {
          if (this.moving !== null) this.moving = null;
          else this.phase = this.menuFrom;
        } else if (a) this.pickPartyRow(this.listCursor);
        return;

      case 'stats':
        if (b) this.phase = 'party';
        else if (a) this.nextStatsPage();
        return;

      case 'bag': {
        const n = Object.keys(this.bag).length + 1;
        this.listCursor = Math.max(0, Math.min(n - 1, this.listCursor + (i.pressed('down') ? 1 : 0) - (i.pressed('up') ? 1 : 0)));
        if (this.listCursor < this.bagScroll) this.bagScroll = this.listCursor;
        if (this.listCursor > this.bagScroll + BAG_ROWS - 1) this.bagScroll = this.listCursor - BAG_ROWS + 1;
        if (b || (a && this.listCursor === n - 1)) this.phase = this.menuFrom;
        else if (a) this.startItem(Object.keys(this.bag)[this.listCursor]);
        return;
      }

      case 'talk':
        this.text.tick(a);
        if (this.text.done) {
          this.phase = 'ready';
          this.menuCursor = 0;
        }
        return;

      case 'exclaim':
        if (++this.timer > 40) {
          this.phase = 'flash';
          this.timer = 0;
        }
        return;

      case 'flash':
        if (++this.timer > 36) {
          this.phase = 'wipe';
          this.timer = 0;
        }
        return;

      case 'wipe':
        if (++this.timer > 40) this.onBattle();
        return;
    }
  }

  private chooseMenu(item: string, from: 'startMenu' | 'ready') {
    this.menuFrom = from;
    this.listCursor = 0;
    this.bagScroll = 0;
    switch (item) {
      case 'POKÉMON': this.phase = 'party'; this.partyMenu = false; this.moving = null; break;
      case 'ITEM': case 'BAG': this.phase = 'bag'; break;
      case 'EXIT': case 'NOT YET': this.phase = 'walk'; break;
      case 'FIGHT!': this.phase = 'exclaim'; this.timer = 0; audio.music('battle'); break;
    }
  }

  /** Splits a message into two short lines for the text box. */
  private say(msg: string) {
    const words = msg.split(' ');
    const lines = ['', ''];
    for (const w of words) {
      const k = lines[0] && (lines[0] + ' ' + w).length > 19 ? 1 : 0;
      if (k === 1 || !lines[1]) lines[k] = lines[k] ? `${lines[k]} ${w}` : w;
      else lines[1] += ` ${w}`;
    }
    this.note = lines.filter(Boolean);
    this.noteTimer = 100;
  }

  private startItem(item: string | undefined) {
    if (!item) return;
    if (!this.onItem) return this.say('Items can be used in the battle.');
    if (Battle.BATTLE_ONLY.includes(item)) return this.say(`${item} only works in battle.`);
    if (item === 'ETHER') return this.say('Use ETHER during the battle.');
    this.usingItem = item;
    this.phase = 'party';
    this.listCursor = 0;
    this.note = null;
  }

  private giveItem(i: number) {
    const item = this.usingItem!;
    this.listCursor = i;
    const err = this.onItem!(item, i);
    if (err) { this.say(err); return; }
    audio.sfx('blip');
    this.say(`Used ${item} on ${SPECIES[this.team[i].species].name}!`);
    if (!this.bag[item]) this.endItem(true);
  }

  private endItem(keepNote = false) {
    this.usingItem = null;
    this.phase = 'bag';
    const n = Object.keys(this.bag).length;
    this.listCursor = Math.min(this.listCursor, n);
    if (!keepNote) this.note = null;
  }

  private pickPartyRow(i: number) {
    if (this.usingItem) return this.giveItem(i);
    this.listCursor = i;
    if (this.moving === null) {
      this.partyMenu = true;
      this.partyMenuCursor = 0;
      return;
    }
    if (this.moving !== i) {
      this.onSwap(this.moving, i);
      audio.sfx('blip');
    }
    this.moving = null;
  }

  private choosePartyItem(k: number) {
    this.partyMenu = false;
    if (PARTY_ITEMS[k] === 'STATS') this.openStats(this.listCursor);
    else if (PARTY_ITEMS[k] === 'SWITCH') this.moving = this.listCursor;
  }

  private openStats(i: number) {
    this.listCursor = i;
    this.statsPage = 0;
    this.phase = 'stats';
  }

  private nextStatsPage() {
    if (this.statsPage < STATS_PAGES - 1) this.statsPage++;
    else this.phase = 'party';
  }

  private updateWalk(tap: {x: number; y: number} | undefined, a: boolean) {
    const i = this.input;
    if (this.player.moving) {
      if (!this.player.tick()) return;
      if (this.place.cleared && this.player.y <= 1 && !this.exited) { // through the open door
        this.exited = true;
        audio.sfx('blip');
        this.place.cleared();
        return;
      }
    }
    if (i.pressed('start') && !this.player.moving) {
      this.phase = 'startMenu';
      this.menuCursor = 0;
      this.path = [];
      return;
    }
    if (tap) {
      const tx = Math.floor(tap.x / 16), ty = Math.floor((tap.y + 4) / 16);
      this.talkAfterPath = this.isRedTile(tx, ty);
      if (this.talkAfterPath) {
        // Walk to the nearest free tile next to Red, then talk.
        const spots: [number, number][] = [[tx, ty + 1], [tx - 1, ty], [tx + 1, ty], [tx, ty - 1]];
        const routes = spots.filter(([sx, sy]) => !this.blocked(sx, sy)).map(([sx, sy]) => this.findPath(sx, sy)).filter(r => r.length);
        this.path = this.isNextToRed() ? [] : (routes.sort((p, q) => p.length - q.length)[0] ?? []);
      } else {
        this.path = this.findPath(tx, ty);
      }
    }
    if ((a && this.facingRed()) || (this.talkAfterPath && !this.path.length && this.isNextToRed())) {
      this.talkToRed();
      return;
    }
    const held = (['up', 'down', 'left', 'right'] as Dir[]).find(d => i.isHeld(d) || i.pressed(d));
    const dir = held ?? this.path.shift();
    if (held) {
      this.path = [];
      this.talkAfterPath = false;
    }
    if (dir) {
      const [dx, dy] = {up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0]}[dir];
      if (!this.blocked(this.player.x + dx, this.player.y + dy)) this.player.start(dir);
      else {
        this.player.dir = dir;
        this.path = [];
      }
    }
  }

  // ---------- drawing ----------

  private drawTile(t: string, x: number, y: number) {
    const g = this.gfx;
    const X = x * 16, Y = y * 16;
    if (t === 'w') {
      g.rect(X, Y, 16, 16, PAL.water);
      const shift = Math.floor(this.frame / 30) % 2 ? 4 : 0;
      g.rect(X + 2 + shift, Y + 4, 5, 1, PAL.waterDark);
      g.rect(X + 9 - shift, Y + 11, 5, 1, PAL.waterDark);
      // foam where water meets sand
      const land = (xx: number, yy: number) => yy >= 0 && yy < 9 && xx >= 0 && xx < 10 && MAP[yy][xx] !== 'w';
      if (land(x, y - 1)) g.rect(X, Y, 16, 2, PAL.foam);
      if (land(x, y + 1)) g.rect(X, Y + 14, 16, 2, PAL.foam);
      if (land(x - 1, y)) g.rect(X, Y, 2, 16, PAL.foam);
      if (land(x + 1, y)) g.rect(X + 14, Y, 2, 16, PAL.foam);
      return;
    }
    if (t === 'd') {
      g.rect(X, Y, 16, 16, PAL.plank);
      for (let i = 0; i < 4; i++) g.rect(X, Y + i * 4 + 3, 16, 1, PAL.plankDark);
      g.rect(X, Y, 1, 16, PAL.plankDark);
      g.rect(X + 15, Y, 1, 16, PAL.plankDark);
      return;
    }
    g.rect(X, Y, 16, 16, PAL.sand);
    g.rect(X + 3, Y + 4, 1, 1, PAL.sandDot);
    g.rect(X + 11, Y + 2, 1, 1, PAL.sandDot);
    g.rect(X + 7, Y + 10, 1, 1, PAL.sandDot);
    g.rect(X + 13, Y + 13, 1, 1, PAL.sandDot);
    if (t === 'g') {
      for (const [gx, gy] of [[3, 6], [9, 9], [6, 3], [11, 4]]) {
        g.rect(X + gx, Y + gy, 1, 3, PAL.grassDark);
        g.rect(X + gx + 1, Y + gy - 1, 1, 4, PAL.grass);
        g.rect(X + gx + 2, Y + gy, 1, 3, PAL.grassDark);
      }
    } else if (t === 'r') {
      g.rect(X + 3, Y + 6, 10, 7, PAL.rockDark);
      g.rect(X + 4, Y + 5, 8, 7, PAL.rock);
      g.rect(X + 5, Y + 6, 3, 2, '#d0d0d0');
      g.rect(X + 3, Y + 13, 10, 1, PAL.sandEdge);
    } else if (t === 'p') {
      g.rect(X + 7, Y + 6, 3, 10, PAL.trunk);
      g.rect(X + 9, Y + 6, 1, 10, PAL.trunkDark);
      for (let i = 0; i < 4; i++) g.rect(X + 7, Y + 7 + i * 3, 3, 1, PAL.trunkDark);
      g.rect(X + 1, Y + 2, 14, 4, PAL.leaf);
      g.rect(X + 4, Y, 8, 3, PAL.leaf);
      g.rect(X, Y + 5, 4, 3, PAL.leafDark);
      g.rect(X + 12, Y + 5, 4, 3, PAL.leafDark);
      g.rect(X + 3, Y + 1, 2, 1, PAL.leafDark);
      g.rect(X + 11, Y + 1, 2, 1, PAL.leafDark);
      g.rect(X + 7, Y + 4, 3, 2, '#806020');
    }
  }

  private drawMenu(items: string[], tx: number, ty: number, tw: number) {
    const g = this.gfx;
    g.tileBox(tx, ty, tw, items.length * 2 + 2);
    items.forEach((label, i) => {
      const x = tx * 8 + 16, y = ty * 8 + 12 + i * 16;
      g.text(label, x, y);
      if (i === this.menuCursor) g.cursor(x - 8, y);
      this.hot.push({x: tx * 8, y: y - 4, w: tw * 8, h: 16, fn: () => {
        this.menuCursor = i;
        this.chooseMenu(label, items === READY_ITEMS ? 'ready' : 'startMenu');
      }});
    });
  }

  private textBox(lines: string[]) {
    const g = this.gfx;
    g.tileBox(0, 12, 20, 6);
    lines.forEach((l, i) => g.text(l, 8, 112 + i * 16));
  }

  draw() {
    const g = this.gfx;
    this.hot = [];
    g.clear(PAL.water);

    if (this.phase === 'party') {
      g.clear();
      drawPartyRows(g, this.team, this.listCursor, null, this.partyMenu, species => this.sprites.get(SPECIES[species].num) ?? null, this.frame);
      if (this.moving !== null) { // the POKÉMON being moved gets a blue outline and a hollow cursor
        g.ctx.save();
        g.ctx.strokeStyle = C.accentBlue;
        g.ctx.lineWidth = 1.2;
        g.ctx.beginPath();
        g.ctx.roundRect(9, this.moving * 16 + 0.5, 150, 15, 3);
        g.ctx.stroke();
        g.ctx.restore();
        if (this.moving !== this.listCursor) g.hollowCursor(0, this.moving * 16 + 4);
      }
      if (this.partyMenu) {
        const name = SPECIES[this.team[this.listCursor].species].name;
        this.textBox(['Do what with', `${name}?`]);
        g.tileBox(11, 10, 9, 8);
        PARTY_ITEMS.forEach((label, k) => {
          const y = 92 + k * 16;
          g.text(label, 104, y);
          if (k === this.partyMenuCursor) g.cursor(96, y);
          this.hot.push({x: 88, y: y - 4, w: 72, h: 16, fn: () => this.choosePartyItem(k)});
        });
        this.hot.push({x: 0, y: 0, w: 160, h: 144, fn: () => { this.partyMenu = false; }});
        return;
      }
      this.team.forEach((_, i) => this.hot.push({x: 0, y: i * 16, w: 160, h: 16, fn: () => this.pickPartyRow(i)}));
      if (this.usingItem) {
        this.textBox(this.note ?? [`Use ${this.usingItem}`, 'on which POKÉMON?']);
        this.hot.push({x: 0, y: 96, w: 160, h: 48, fn: () => this.endItem()});
      } else if (this.moving !== null) {
        this.textBox([`Move ${SPECIES[this.team[this.moving].species].name}`, 'where?']);
        this.hot.push({x: 0, y: 96, w: 160, h: 48, fn: () => { this.moving = null; }});
      } else {
        this.textBox(['Choose a POKÉMON.', 'The top one goes first!']);
        this.hot.push({x: 0, y: 96, w: 160, h: 48, fn: () => { this.phase = this.menuFrom; }});
      }
      return;
    }
    if (this.phase === 'stats') {
      g.clear();
      const m = this.team[this.listCursor];
      drawStatsPage(g, m, this.statsPage, this.sprites.get(SPECIES[m.species].num) ?? null, this.frame);
      this.hot.push({x: 0, y: 0, w: 160, h: 144, fn: () => this.nextStatsPage()});
      return;
    }

    const time = performance.now();
    if (this.place.room) this.drawRoom(time);
    else this.drawIsland(time);

    this.drawOverlays();
  }

  /** An Elite Four room: floor and walls, then pillars and people back to front, then the lighting. */
  private drawRoom(time: number) {
    const g = this.gfx, room = this.place.room!;
    drawRoomBack(g, room, time, !!this.place.cleared);
    const standing: {y: number; draw: () => void}[] = [
      {y: this.red.py + 15, draw: () => this.red.draw(g)},
      {y: this.player.py + 15, draw: () => this.player.draw(g)},
    ];
    this.place.map.forEach((row, y) => [...row].forEach((t, x) => {
      if (t === 'P') standing.push({y: y * 16 + 15, draw: () => drawPillar(g, room, x, y, time)});
    }));
    standing.sort((a, b) => a.y - b.y).forEach(o => o.draw());
    drawRoomLight(g, room, time, {x: this.red.px + (this.red.wide ? 16 : 8), y: this.red.py + 4}, this.place.tag ?? '');
  }

  private drawIsland(time: number) {
    const g = this.gfx;
    // Scenery: sea, beach, dock, grass, decorations…
    drawSea(g, time);
    drawLand(g, MAP, time);
    drawDecor(g);
    MAP.forEach((row, y) => [...row].forEach((t, x) => {
      if (t === 'd') drawDock(g, x, y, y === MAP.length - 1 || MAP[y + 1][x] !== 'd');
      if (t === 'g') drawGrass(g, x, y, time);
    }));
    // …then everything that stands up, drawn back to front so you can walk behind palm leaves.
    const standing: {y: number; draw: () => void}[] = [
      {y: this.red.py + 15, draw: () => this.red.draw(g)},
      {y: this.player.py + 15, draw: () => this.player.draw(g)},
    ];
    MAP.forEach((row, y) => [...row].forEach((t, x) => {
      if (t === 'p') standing.push({y: y * 16 + 14, draw: () => drawPalm(g, x, y, time, x < 5 ? 1 : -1)});
      if (t === 'r') standing.push({y: y * 16 + 14, draw: () => drawRock(g, x, y)});
    }));
    standing.sort((a, b) => a.y - b.y).forEach(o => o.draw());
  }

  private drawOverlays() {
    const g = this.gfx;
    if (this.phase === 'exclaim') {
      const bx = this.red.px + (this.red.wide ? 12 : 4), by = this.red.py - (this.red.hd ? 18 : 14);
      g.rect(bx, by, 9, 10, C.ink);
      g.rect(bx + 1, by + 1, 7, 8, C.bg);
      g.rect(bx + 4, by + 2, 1, 4, C.ink);
      g.rect(bx + 4, by + 7, 1, 1, C.ink);
    }

    if (this.phase === 'startMenu') {
      this.drawMenu(START_ITEMS, 10, 0, 10);
    } else if (this.phase === 'ready') {
      this.textBox(['Ready to battle', `${this.place.foeName}?`]);
      this.drawMenu(READY_ITEMS, 9, 1, 11);
    } else if (this.phase === 'bag') {
      const rows = drawBagList(g, this.bag, this.listCursor, this.bagScroll, this.frame, 'CLOSE');
      const n = Object.keys(this.bag).length;
      rows.forEach(({i, y}) => this.hot.push({x: 0, y, w: 160, h: 16, fn: () => {
        if (i === n) this.phase = this.menuFrom;
        else if (this.listCursor === i) this.startItem(Object.keys(this.bag)[i]);
        else this.listCursor = i;
      }}));
      if (this.note) this.textBox(this.note);
      return;
    } else if (this.text.lines.length || (!this.text.done && (this.phase === 'arrive' || this.phase === 'talk'))) {
      this.textBox(this.text.lines);
      if (this.text.waiting && Math.floor(this.frame / 20) % 2 === 0) g.downArrow(144, 132);
    }

    if (this.phase === 'flash' && Math.floor(this.timer / 6) % 2 === 0) g.invert();
    if (this.phase === 'wipe') {
      const w = Math.min(80, this.timer * 2);
      for (let row = 0; row < 18; row++) {
        const fromLeft = row % 2 === 0;
        g.rect(fromLeft ? 0 : 160 - w * 2, row * 8, w * 2, 8, C.ink);
      }
    }
  }
}
