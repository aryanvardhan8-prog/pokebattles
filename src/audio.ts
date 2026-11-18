// 8-bit sound: a tiny Game Boy-style synth (square + triangle + noise) with original tunes.
// Browsers only allow sound after the player touches/clicks/presses a key, so unlock() is
// called from those events.

type Track = 'island' | 'battle' | 'victory' | 'defeat' | null;
export type Sfx = 'blip' | 'select' | 'back' | 'hit' | 'super' | 'weak' | 'faint' | 'ball' | 'heal' | 'error';

// Note names → frequency. 'C4' = middle C. '-' = rest.
const NOTE: Record<string, number> = {};
['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].forEach((n, i) => {
  for (let o = 1; o <= 7; o++) NOTE[`${n}${o}`] = 440 * 2 ** ((i - 9) / 12 + (o - 4));
});

/** "E5:1 D5:.5 -:1" → [[freq|0, beats], ...] */
function seq(s: string): [number, number][] {
  return s.trim().split(/\s+/).map(tok => {
    const [n, b] = tok.split(':');
    return [n === '-' ? 0 : NOTE[n], Number(b ?? 1)];
  });
}

interface Song { bpm: number; loop: boolean; lead: [number, number][]; bass: [number, number][]; harm?: [number, number][] }

// Original melodies in the spirit of Gen 1 (not Nintendo's music).
// Original, gentle melodies (not Nintendo's music): slow tempos, soft triangle/sine tones,
// a flowing arpeggio underneath and long bass notes.
const SONGS: Record<Exclude<Track, null>, Song> = {
  island: {
    bpm: 72, loop: true,
    lead: seq(`
      E5:2 D5:1 C5:1   D5:2 G4:2   C5:1.5 D5:.5 E5:1 G5:1   A5:3 -:1
      G5:2 E5:1 C5:1   D5:2 A4:2   B4:1 C5:1 D5:1 B4:1   C5:4`),
    harm: seq(`
      C4:1 E4:1 G4:1 E4:1   B3:1 D4:1 G4:1 D4:1   A3:1 C4:1 E4:1 C4:1   F3:1 A3:1 C4:1 A3:1
      C4:1 E4:1 G4:1 E4:1   F3:1 A3:1 C4:1 A3:1   G3:1 B3:1 D4:1 B3:1   C4:1 E4:1 G4:1 E4:1`),
    bass: seq(`C3:4 G2:4 A2:4 F2:4 C3:4 F2:4 G2:4 C3:4`),
  },
  battle: {
    bpm: 96, loop: true,
    lead: seq(`
      A4:1 C5:1 E5:2   D5:1 C5:1 B4:2   C5:1 B4:1 A4:1 G4:1   A4:4
      F4:1 A4:1 C5:2   B4:1 A4:1 G4:2   A4:1 B4:1 C5:1 D5:1   E5:4`),
    harm: seq(`
      A3:.5 C4:.5 E4:.5 C4:.5 A3:.5 C4:.5 E4:.5 C4:.5   G3:.5 B3:.5 D4:.5 B3:.5 G3:.5 B3:.5 D4:.5 B3:.5
      F3:.5 A3:.5 C4:.5 A3:.5 F3:.5 A3:.5 C4:.5 A3:.5   E3:.5 G#3:.5 B3:.5 G#3:.5 E3:.5 G#3:.5 B3:.5 G#3:.5
      F3:.5 A3:.5 C4:.5 A3:.5 F3:.5 A3:.5 C4:.5 A3:.5   G3:.5 B3:.5 D4:.5 B3:.5 G3:.5 B3:.5 D4:.5 B3:.5
      A3:.5 C4:.5 E4:.5 C4:.5 A3:.5 C4:.5 E4:.5 C4:.5   E3:.5 G#3:.5 B3:.5 G#3:.5 E3:.5 G#3:.5 B3:.5 G#3:.5`),
    bass: seq(`A2:4 G2:4 F2:4 E2:4 F2:4 G2:4 A2:4 E2:4`),
  },
  victory: {
    bpm: 100, loop: false,
    lead: seq('C5:.5 E5:.5 G5:.5 C6:1.5 -:.5 A5:.5 B5:.5 C6:.5 D6:.5 E6:3'),
    harm: seq('E4:2 -:.5 F4:1.5 G4:1 E4:3'),
    bass: seq('C3:2 -:.5 F3:1.5 G3:1 C3:3'),
  },
  defeat: {
    bpm: 66, loop: false,
    lead: seq('E5:1 D5:1 C5:1 B4:1 A4:3'),
    bass: seq('A2:2 F2:2 E2:3'),
  },
};

class Audio8 {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private track: Track = null;
  private wanted: Track = null;
  private timer: number | null = null;
  private voices: {song: Song; part: 'lead' | 'bass' | 'harm'; i: number; t: number}[] = [];
  muted = false;
  private listeners: ((m: boolean) => void)[] = [];

  constructor() {
    try { this.muted = localStorage.getItem('pokebattles:muted') === '1'; } catch { /* ignore */ }
    // iPhones only allow sound to start from a "finished" touch (touchend / click), not from the
    // moment a finger goes down, so listen for those everywhere on the page.
    if (typeof window !== 'undefined') {
      for (const ev of ['touchend', 'pointerup', 'click', 'keydown']) {
        window.addEventListener(ev, () => this.unlock(), {capture: true, passive: true});
      }
      // Coming back to the tab/app: iOS pauses ("interrupts") the sound engine in the background.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.ctx && !this.muted && this.ctx.state !== 'running') void this.ctx.resume();
      });
    }
  }

  /** Call from a tap / click / key press. Creates or resumes the audio engine. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
      if (!AC) return;
      // iOS 17+: play like a music app, so the side silent switch doesn't silence the game.
      try {
        const nav = navigator as unknown as {audioSession?: {type: string}};
        if (nav.audioSession) nav.audioSession.type = 'playback';
      } catch { /* older browsers */ }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.35;
      this.musicGain.connect(this.master);
      const len = this.ctx.sampleRate * 0.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      if (this.wanted) this.startTrack(this.wanted);
    }
    if (this.ctx.state !== 'running' && !this.muted) {
      void this.ctx.resume();
      // Older iPhones also need a sound to actually play inside the touch: a tiny silent one.
      const b = this.ctx.createBuffer(1, 1, 22050);
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      src.connect(this.ctx.destination);
      src.start(0);
    }
    if (this.muted && this.ctx.state === 'running') void this.ctx.suspend();
  }

  onMuteChange(fn: (m: boolean) => void) {
    this.listeners.push(fn);
    fn(this.muted);
  }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('pokebattles:muted', this.muted ? '1' : '0'); } catch { /* ignore */ }
    if (this.master && this.ctx) {
      // Silence instantly and pause the whole sound engine, so nothing (music or effects) can play.
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setValueAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime);
      if (this.muted) void this.ctx.suspend();
      else void this.ctx.resume();
    }
    this.listeners.forEach(fn => fn(this.muted));
  }

  // ---------- music ----------

  music(track: Track) {
    this.wanted = track;
    if (track === this.track) return;
    if (this.ctx) this.startTrack(track);
  }

  private startTrack(track: Track) {
    this.track = track;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.voices = [];
    if (!track || !this.ctx) return;
    const song = SONGS[track];
    const t0 = this.ctx.currentTime + 0.05;
    this.voices = (['lead', 'bass', 'harm'] as const).filter(p => song[p]).map(part => ({song, part, i: 0, t: t0}));
    const schedule = () => {
      const ctx = this.ctx!;
      const beat = 60 / song.bpm;
      for (const v of this.voices) {
        const notes = v.song[v.part]!;
        while (v.t < ctx.currentTime + 0.2) {
          if (v.i >= notes.length) {
            if (!song.loop) break;
            v.i = 0;
          }
          const [f, beats] = notes[v.i++];
          const dur = beats * beat;
          if (f) {
            if (v.part === 'bass') this.soft('triangle', f, v.t, dur * 0.95, 0.4);
            else if (v.part === 'lead') this.soft('triangle', f, v.t, dur * 0.9, 0.5);
            else this.soft('sine', f, v.t, dur * 1.4, 0.16);
          }
          v.t += dur;
        }
      }
      if (!song.loop && this.voices.every(v => v.i >= v.song[v.part]!.length)) {
        clearInterval(this.timer!);
        this.timer = null;
      }
    };
    schedule();
    this.timer = window.setInterval(schedule, 50);
  }

  /** A music note with a soft start and a gentle fade (no harsh 8-bit edges). */
  private soft(type: OscillatorType, freq: number, at: number, dur: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(vol, at + Math.min(0.06, dur / 4));
    g.gain.exponentialRampToValueAtTime(vol * 0.35, at + dur * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.musicGain!);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  // ---------- sound effects ----------

  private tone(type: OscillatorType, freq: number, at: number, dur: number, vol: number, out: AudioNode, endFreq?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, at + dur);
    g.gain.setValueAtTime(vol, at);
    g.gain.setValueAtTime(vol, at + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, at + dur);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  private hiss(at: number, dur: number, vol: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    src.connect(g).connect(this.master!);
    src.start(at);
    src.stop(at + dur);
  }

  sfx(name: Sfx) {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime + 0.005, m = this.master;
    switch (name) {
      case 'blip': this.tone('square', 1320, t, 0.03, 0.12, m); break;
      case 'select': this.tone('square', 990, t, 0.04, 0.14, m); this.tone('square', 1480, t + 0.04, 0.05, 0.14, m); break;
      case 'back': this.tone('square', 1320, t, 0.04, 0.12, m); this.tone('square', 880, t + 0.04, 0.05, 0.12, m); break;
      case 'error': this.tone('square', 220, t, 0.12, 0.18, m); break;
      case 'hit': this.hiss(t, 0.18, 0.5); this.tone('square', 160, t, 0.1, 0.25, m, 60); break;
      case 'super': this.hiss(t, 0.28, 0.6); this.tone('square', 600, t, 0.18, 0.2, m, 120); break;
      case 'weak': this.hiss(t, 0.1, 0.25); break;
      case 'faint': this.tone('square', 900, t, 0.6, 0.2, m, 80); break;
      case 'ball': this.tone('square', 300, t, 0.15, 0.18, m, 1200); this.hiss(t + 0.15, 0.12, 0.25); break;
      case 'heal':
        [784, 988, 1175, 1568].forEach((f, i) => this.tone('square', f, t + i * 0.06, 0.06, 0.12, m));
        break;
    }
  }
}

export const audio = new Audio8();
