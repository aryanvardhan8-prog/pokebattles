// Gen 1 style naming screen: pick letters from a grid (or just type on a keyboard).

import {Gfx, C, textWidth} from './gfx';
import type {Input} from './input';
import type {Scene} from './scene';

const ROWS = ['ABCDEFGHI', 'JKLMNOPQR', 'STUVWXYZ ', '012345678', '9'];
const MAX = 10;

export class NameEntryScene implements Scene {
  private name: string;
  private cx = 0;
  private cy = 0;
  private frame = 0;
  private hot: {x: number; y: number; w: number; h: number; fn: () => void}[] = [];

  constructor(private gfx: Gfx, private input: Input, initial: string,
    private onDone: (name: string) => void, private onCancel: () => void) {
    this.name = initial.slice(0, MAX);
  }

  // Bottom row: 9, DEL, END
  private cell(x: number, y: number): string {
    if (y === 4) return x === 0 ? '9' : x <= 4 ? 'DEL' : 'END';
    return ROWS[y][x];
  }

  private press(ch: string) {
    if (ch === 'DEL') this.name = this.name.slice(0, -1);
    else if (ch === 'END') {
      if (this.name.trim()) this.onDone(this.name.trim());
    } else if (this.name.length < MAX) this.name += ch;
  }

  update() {
    this.frame++;
    const i = this.input;
    const tap = i.taps[0];
    const hit = tap && this.hot.find(h => tap.x >= h.x && tap.x < h.x + h.w && tap.y >= h.y && tap.y < h.y + h.h);
    if (hit) return hit.fn();

    for (const ch of i.typed) this.press(ch === '\n' ? 'END' : ch === '\b' ? 'DEL' : ch); // typing on a keyboard
    const btn = (b: Parameters<Input['pressed']>[0]) => i.pressed(b) && !i.fromLetter.has(b);
    if (btn('left')) this.cx = (this.cx + 8) % 9;
    if (btn('right')) this.cx = (this.cx + 1) % 9;
    if (btn('up')) this.cy = (this.cy + 4) % 5;
    if (btn('down')) this.cy = (this.cy + 1) % 5;
    if (this.cy === 4 && (btn('left') || btn('right'))) this.cx = this.cx === 0 ? (btn('right') ? 1 : 5) : this.cx <= 4 ? (btn('right') ? 5 : 0) : (btn('right') ? 0 : 1);
    if (btn('a')) this.press(this.cell(this.cx, this.cy));
    if (btn('b')) {
      if (this.name) this.name = this.name.slice(0, -1);
      else this.onCancel();
    }
    if (i.pressed('start')) this.press('END');
  }

  draw() {
    const g = this.gfx;
    this.hot = [];
    g.clear();
    g.text('YOUR NAME?', 8, 8);
    g.text(this.name, 24, 24);
    for (let k = 0; k < MAX; k++) g.rect(24 + k * 8, 33, 7, 1, k === this.name.length && Math.floor(this.frame / 20) % 2 ? C.bg : C.ink);

    g.tileBox(0, 5, 20, 13);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 9; x++) {
        const ch = this.cell(x, y);
        if (y === 4 && x > 0 && x !== 1 && x !== 5) continue; // DEL / END drawn once
        const px = 16 + x * 16, py = 56 + y * 14;
        g.text(ch === ' ' ? '_' : ch, px, py);
        const w = textWidth(ch);
        this.hot.push({x: px - 4, y: py - 3, w: w + 8, h: 14, fn: () => { this.cx = x; this.cy = y; this.press(ch); }});
      }
    }
    // cursor
    const onWord = this.cy === 4 && this.cx > 0;
    const cx = onWord ? (this.cx <= 4 ? 1 : 5) : this.cx;
    g.cursor(16 + cx * 16 - 8, 56 + this.cy * 14);
    g.text(matchMedia('(pointer: fine)').matches ? 'Type, then ENTER' : 'Pick letters, END', 8, 128, C.light);
  }
}
