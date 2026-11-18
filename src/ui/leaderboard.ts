// Today's leaderboard: top 10 plus your own rank.

import {Gfx, C, wrap} from './gfx';
import type {Input} from './input';
import type {Scene} from './scene';
import {fetchTop, submittedFor, type Entry} from '../leaderboard';
import type {Level} from '../engine/daily';

export class LeaderboardScene implements Scene {
  private entries: Entry[] = [];
  private total = 0;
  private status = 'Loading...';
  private frame = 0;

  constructor(private gfx: Gfx, private input: Input, private date: string, private level: Level, private dayNumber: number,
    private onBack: () => void, private message = '') {
    void this.load();
  }

  private async load() {
    try {
      const {entries, total} = await fetchTop(this.date, this.level);
      this.entries = entries;
      this.total = total;
      this.status = entries.length ? '' : 'No one yet. Be first!';
    } catch (e) {
      this.status = (e as Error).message;
    }
  }

  update() {
    this.frame++;
    const i = this.input;
    if (i.pressed('a') || i.pressed('b') || i.taps.length) this.onBack();
  }

  draw() {
    const g = this.gfx;
    g.clear();
    g.text(`#${this.dayNumber} ${this.level.toUpperCase()}`, 8, 2);
    g.textRight(`${this.total} PLAYED`.slice(0, 10), 160, 2, C.light);
    g.rect(0, 11, 160, 1, C.ink);

    const mine = submittedFor(this.date, this.level);
    if (this.status) {
      wrap(this.status).forEach((l, i) => g.text(l, 8, 40 + i * 12));
    } else {
      this.entries.forEach((e, i) => {
        const y = 15 + i * 10;
        const me = mine && mine.rank === i + 1;
        if (me) g.rect(0, y - 1, 160, 10, '#fff0a0');
        g.textRight(String(i + 1), 16, y);
        g.text(e.name.slice(0, 10), 24, y);
        g.text(e.won ? `${e.mons_left}/6` : 'LOST', 104, y, e.won ? C.ink : C.hpRed);
        g.textRight(String(e.turns), 160, y, C.light);
      });
    }
    g.rect(0, 117, 160, 1, C.ink);
    if (this.message) g.text(this.message.slice(0, 20), 0, 121, C.hpRed);
    else if (mine) g.text(`YOU: #${mine.rank} of ${Math.max(mine.total, this.total)}`.slice(0, 20), 8, 121);
    if (Math.floor(this.frame / 30) % 2 === 0) g.text('A: BACK', 8, 134, C.light);
  }
}
