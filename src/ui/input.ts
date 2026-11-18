// Keyboard (laptop) and on-screen buttons (phone) → Game Boy buttons.

import {audio} from '../audio';

export type Button = 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'start' | 'select';

const KEYS: Record<string, Button> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  KeyZ: 'a', Enter: 'a', Space: 'a', KeyX: 'b', Backspace: 'b', Escape: 'b',
  ShiftRight: 'select', ShiftLeft: 'select', KeyP: 'start', KeyM: 'start', Tab: 'start',
};

export class Input {
  private held = new Set<Button>();
  private justPressed = new Set<Button>();
  private repeatTimer = new Map<Button, number>();
  taps: {x: number; y: number}[] = [];
  /** Letters/digits typed this frame (for the name screen on a keyboard). */
  typed: string[] = [];
  /** Buttons pressed this frame via a letter key (WASD, Z, X...), so typing can ignore them. */
  fromLetter = new Set<Button>();

  constructor() {
    window.addEventListener('keydown', e => {
      // Typing in a form (account sign-up) or using the web menu: leave the keys alone.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (document.body.classList.contains('on-home') || document.body.classList.contains('sheet-open')) return;
      if (/^[a-z0-9]$/i.test(e.key) && !e.metaKey && !e.ctrlKey) this.typed.push(e.key.toUpperCase());
      else if (e.key === ' ') this.typed.push(' ');
      else if (e.key === 'Enter') { this.typed.push('\n'); this.fromLetter.add('a'); }
      else if (e.key === 'Backspace') { this.typed.push('\b'); this.fromLetter.add('b'); }
      const b = KEYS[e.code];
      if (b && e.key.length === 1) this.fromLetter.add(b);
      if (!b) return;
      e.preventDefault();
      if (!e.repeat) this.press(b);
    });
    window.addEventListener('keyup', e => {
      const b = KEYS[e.code];
      if (b) this.release(b);
    });
    window.addEventListener('blur', () => this.held.clear());
  }

  press(b: Button) {
    audio.unlock(); // sound can only start after the player interacts
    if (!this.held.has(b)) this.justPressed.add(b);
    this.held.add(b);
    this.repeatTimer.set(b, 0);
    if (navigator.vibrate) navigator.vibrate(8);
  }

  release(b: Button) {
    this.held.delete(b);
  }

  /** Pressed this frame (held arrows repeat, for scrolling lists). */
  pressed(b: Button): boolean {
    return this.justPressed.has(b);
  }

  isHeld(b: Button) {
    return this.held.has(b);
  }

  /** Call once per frame after the game has read input. */
  endFrame() {
    this.justPressed.clear();
    this.taps = [];
    this.typed = [];
    this.fromLetter.clear();
    for (const b of ['up', 'down', 'left', 'right'] as Button[]) {
      if (!this.held.has(b)) continue;
      const t = (this.repeatTimer.get(b) ?? 0) + 1;
      this.repeatTimer.set(b, t);
      if (t > 20 && t % 6 === 0) this.justPressed.add(b);
    }
  }

  /** Hooks up the on-screen buttons and tapping on the screen itself. */
  bindTouch(root: HTMLElement, canvas: HTMLCanvasElement) {
    root.querySelectorAll<HTMLElement>('[data-btn]').forEach(el => {
      const b = el.dataset.btn as Button;
      const down = (e: Event) => { e.preventDefault(); this.press(b); el.classList.add('pressed'); };
      const up = (e: Event) => { e.preventDefault(); this.release(b); el.classList.remove('pressed'); };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointerleave', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('contextmenu', e => e.preventDefault());
    });
    canvas.addEventListener('pointerdown', e => {
      audio.unlock();
      const r = canvas.getBoundingClientRect();
      this.taps.push({x: ((e.clientX - r.left) / r.width) * 160, y: ((e.clientY - r.top) / r.height) * 144});
    });
  }
}
