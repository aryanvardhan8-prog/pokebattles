// Results screen: outcome, team summary, stats, share and countdown to the next island.

import {Gfx, C, textWidth} from './gfx';
import type {Input} from './input';
import type {Scene} from './scene';
import {type DayResult, type Stats, currentStreak, shareText} from '../stats';

const BUTTONS = ['SHARE', 'RANKS', 'MENU'];

export class ResultsScene implements Scene {
  private frame = 0;
  private cursor = 0;
  private note = '';
  private noteTimer = 0;
  private hot: {x: number; y: number; w: number; h: number; fn: () => void}[] = [];

  constructor(
    private gfx: Gfx, private input: Input,
    private day: {number: number; date: string; level: string},
    private result: DayResult, private stats: Stats,
    private onMenu: () => void,
    private onRanks: () => void,
  ) {}

  private async share() {
    const text = shareText(this.day.number, this.day.level, this.result, location.origin + location.pathname);
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({text});
        this.flashNote('Shared!');
      } else {
        await navigator.clipboard.writeText(text);
        this.flashNote('Copied! Paste it.');
      }
    } catch {
      // Older browsers / no permission: copy through a hidden text box.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      this.flashNote(ok ? 'Copied! Paste it.' : 'Could not copy.');
    }
  }

  private flashNote(s: string) {
    this.note = s;
    this.noteTimer = 150;
  }

  private choose(i: number) {
    this.cursor = i;
    if (i === 0) void this.share();
    else if (i === 1) this.onRanks();
    else this.onMenu();
  }

  update() {
    this.frame++;
    if (this.noteTimer > 0) this.noteTimer--;
    const i = this.input;
    const tap = i.taps[0];
    const hit = tap && this.hot.find(h => tap.x >= h.x && tap.x < h.x + h.w && tap.y >= h.y && tap.y < h.y + h.h);
    if (hit) return hit.fn();
    if (i.pressed('left') || i.pressed('up')) this.cursor = (this.cursor + 2) % 3;
    if (i.pressed('right') || i.pressed('down')) this.cursor = (this.cursor + 1) % 3;
    if (i.pressed('a')) this.choose(this.cursor);
    if (i.pressed('b')) this.onMenu();
  }

  private countdown() {
    const now = new Date();
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const t = Math.max(0, Math.floor((next - now.getTime()) / 1000));
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
  }

  draw() {
    const g = this.gfx;
    const r = this.result, s = this.stats;
    this.hot = [];
    g.clear();

    g.text(`#${this.day.number} ${this.day.level.toUpperCase()}`, 8, 4);
    g.textBig(r.won ? 'VICTORY!' : 'DEFEAT', r.won ? 16 : 32, 16, 2, r.won ? C.hpGreen : C.hpRed);

    // Team squares, like the share text.
    r.hp.forEach((p, i) => {
      const x = 32 + i * 16, y = 38;
      const color = p === 0 ? C.ink : p > 50 ? C.hpGreen : p > 20 ? C.hpYellow : C.hpRed;
      g.rect(x, y, 12, 12, color);
    });
    g.text(r.won ? `${r.left}/6 LEFT  ${r.turns} TURNS` : `${r.turns} TURNS`, r.won ? 8 : 48, 54);

    g.tileBox(0, 8, 20, 6);
    const rate = s.played ? Math.round((s.wins / s.played) * 100) : 0;
    const cell = (label: string, value: number, x: number, y: number) => {
      g.text(label, x, y);
      g.textRight(String(value), x + 64, y + 8);
    };
    cell('PLAYED', s.played, 8, 72);
    cell('WIN %', rate, 88, 72);
    g.rect(80, 70, 1, 32, C.light);
    cell('STREAK', currentStreak(s, this.day.date), 8, 88 - 0);
    cell('BEST', s.maxStreak, 88, 88);

    BUTTONS.forEach((label, i) => {
      const x = [8, 64, 112][i] + 8, y = 116;
      g.text(label, x, y);
      if (this.cursor === i) g.cursor(x - 8, y);
      this.hot.push({x: x - 8, y: y - 6, w: textWidth(label) + 12, h: 18, fn: () => this.choose(i)});
    });

    g.text(this.noteTimer > 0 ? this.note : `NEXT ISLAND ${this.countdown()}`, 0, 134, this.noteTimer > 0 ? C.hpGreen : C.ink);
  }
}
