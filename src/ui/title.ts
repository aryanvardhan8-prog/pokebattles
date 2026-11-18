// Title screen: logo, day number, and a level picker showing today's progress on each level.

import {Gfx, C, loadSprite, redUrl} from './gfx';
import type {Input} from './input';
import type {Scene} from './scene';
import {LEVELS, type Level} from '../engine/daily';

export type LevelState = 'new' | 'playing' | 'won' | 'lost';
const STATE_LABEL: Record<LevelState, string> = {new: 'NEW', playing: 'GO ON', won: 'WON', lost: 'LOST'};
const STATE_COLOR: Record<LevelState, string> = {new: C.ink, playing: C.hpYellow, won: C.hpGreen, lost: C.hpRed};

export class TitleScene implements Scene {
  private frame = 0;
  private red: HTMLCanvasElement | null = null;
  private cursor: number;
  private hot: {x: number; y: number; w: number; h: number; fn: () => void}[] = [];

  constructor(
    private gfx: Gfx, private input: Input,
    private info: {number: number; date: string; states: Record<Level, LevelState>},
    private onPick: (level: Level) => void,
  ) {
    void loadSprite(redUrl, true).then(s => { this.red = s; });
    // Start on the first level not finished yet.
    const open = LEVELS.findIndex(l => info.states[l] === 'new' || info.states[l] === 'playing');
    this.cursor = open < 0 ? 0 : open;
  }

  update() {
    this.frame++;
    if (this.frame < 15) return;
    const i = this.input;
    const tap = i.taps[0];
    const hit = tap && this.hot.find(h => tap.x >= h.x && tap.x < h.x + h.w && tap.y >= h.y && tap.y < h.y + h.h);
    if (hit) return hit.fn();
    if (i.pressed('up')) this.cursor = (this.cursor + 2) % 3;
    if (i.pressed('down')) this.cursor = (this.cursor + 1) % 3;
    if (i.pressed('a') || i.pressed('start')) this.onPick(LEVELS[this.cursor]);
  }

  draw() {
    const g = this.gfx;
    this.hot = [];
    g.clear();
    g.textBig('POKE', 6, 4, 3, '#e03820');
    g.textBig('BATTLES', 6, 32, 2, C.ink);
    if (this.red) {
      const h = 54, w = (this.red.width * h) / this.red.height;
      g.image(this.red, 156 - w, 57 - h, w, h);
    }
    g.rect(0, 58, 160, 2, C.ink);
    g.text(`DAY #${this.info.number}`, 8, 64);
    g.textRight(this.info.date.slice(5), 152, 64, C.light);

    g.box(0, 74, 160, 70);
    LEVELS.forEach((level, i) => {
      const y = 84 + i * 14;
      const state = this.info.states[level];
      g.text(level.toUpperCase(), 24, y);
      g.textRight(STATE_LABEL[state], 144, y, STATE_COLOR[state]);
      if (i === this.cursor) g.cursor(16, y);
      this.hot.push({x: 0, y: y - 4, w: 160, h: 14, fn: () => { this.cursor = i; this.onPick(level); }});
    });
    if (Math.floor(this.frame / 30) % 2 === 0) g.text('CHOOSE A LEVEL', 24, 128, C.light);
  }
}
