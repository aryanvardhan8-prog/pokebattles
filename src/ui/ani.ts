// Animated 3D Pokémon sprites (GIFs), unpacked into frames so they can play inside the game canvas.

import {parseGIF, decompressFrames} from 'gifuct-js';

// Memory: iPhones cap the total size of all canvases on a page (Safari blanks pictures past it, which made
// Pokémon flicker or vanish). So each animation keeps just two canvases: the first frame (`first`, for
// still pictures) and `view`, which is re-drawn frame by frame as the animation plays. The frame data
// itself lives as plain pixel arrays, which don't count towards that limit.
interface Part { img: ImageData; left: number; top: number; disposal: number }
export interface Ani {
  first: HTMLCanvasElement;
  view: HTMLCanvasElement;
  parts: Part[];
  idx: number; // frame currently drawn on `view` (-1 = none)
  restore: ImageData | null;
  ends: number[]; // cumulative end time (ms) of each frame
  total: number; // loop length (ms)
  width: number;
  height: number;
  cx: number; // horizontal centre of the body (tails and wings make the GIF's own middle look off-centre)
}

const BASE = import.meta.env.BASE_URL;
export const aniUrl = (id: string, back = false) => `${BASE}sprites/${back ? 'ani-back' : 'ani'}/${id}.gif`;

const cache = new Map<string, Promise<Ani | null>>();
const ready = new Map<string, Ani | null>();
const lastUsed = new Map<string, number>();
// iPhones cap the total memory of all canvases on a page; past it, new pictures come out blank.
// So only the most recently used animations are kept. Anything drawn in the last few seconds is never
// dropped (dropping a Pokémon that's on screen made it flicker: it reloaded, pushed out the other one, and so on).
const KEEP = 36;
const IN_USE_MS = 5000;

// The Pokémon in the current battle are never dropped (a benched one being dropped and reloaded on
// switch-in is what made it come out blank on iPhones).
let pinned = new Set<string>();
export function pinAnis(urls: string[]) {
  pinned = new Set(urls);
}

function touch(url: string) {
  const p = cache.get(url);
  if (!p) return;
  lastUsed.set(url, performance.now());
  cache.delete(url);
  cache.set(url, p); // Map order = least recently used first
  if (cache.size <= KEEP) return;
  const now = performance.now();
  for (const old of [...cache.keys()]) {
    if (cache.size <= KEEP) break;
    if (pinned.has(old) || now - (lastUsed.get(old) ?? 0) < IN_USE_MS) continue; // in this battle / on screen: keep it
    cache.delete(old);
    lastUsed.delete(old);
    const ani = ready.get(old);
    ready.delete(old);
    // Hand the memory back right away (iOS frees canvas memory when it's resized to 0).
    if (ani) release(ani);
  }
}

function release(ani: Ani) {
  ani.first.width = ani.first.height = 0;
  ani.view.width = ani.view.height = 0;
  ani.parts = [];
}

/** Loads and unpacks a GIF once. Resolves to null if it can't be loaded. */
export function loadAni(url: string): Promise<Ani | null> {
  let p = cache.get(url);
  if (p) { touch(url); return p; }
  p = fetch(url)
    .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then(buf => decode(buf))
    .catch(() => null)
    .then(ani => {
      if (cache.get(url) !== p) { if (ani) release(ani); return ani; }
      ready.set(url, ani);
      // Couldn't load or came out blank: the Game Boy sprite shows meanwhile; try again in a few seconds.
      if (!ani) setTimeout(() => { if (cache.get(url) === p) { cache.delete(url); ready.delete(url); lastUsed.delete(url); } }, 4000);
      return ani;
    });
  cache.set(url, p);
  touch(url);
  return p;
}

/** The animation if it has finished loading (starts loading it otherwise). Marks it as in use. */
export function getAni(url: string): Ani | null {
  if (!cache.has(url)) void loadAni(url);
  else touch(url);
  const a = ready.get(url) ?? null;
  // Never hand out an animation whose memory was already given back.
  return a && a.view.width > 0 ? a : null;
}

// One small canvas shared by all animations, used to blend each frame's pixels onto `view`.
let scratch: HTMLCanvasElement | null = null;

/** Draws frame `i` onto the animation's view (frames must be applied in order: GIF frames build on each other). */
function apply(ani: Ani, i: number) {
  const ctx = ani.view.getContext('2d')!;
  const prev = ani.parts[i - 1], f = ani.parts[i];
  if (prev?.disposal === 2) ctx.clearRect(prev.left, prev.top, prev.img.width, prev.img.height);
  if (prev?.disposal === 3 && ani.restore) ctx.putImageData(ani.restore, 0, 0);
  ani.restore = f.disposal === 3 ? ctx.getImageData(0, 0, ani.width, ani.height) : null;
  scratch ??= document.createElement('canvas');
  scratch.width = f.img.width;
  scratch.height = f.img.height;
  scratch.getContext('2d')!.putImageData(f.img, 0, 0);
  ctx.drawImage(scratch, f.left, f.top);
  ani.idx = i;
}

/** The picture to show at time `ms` (the animation's view, brought up to that frame). */
export function aniFrame(ani: Ani, ms: number): HTMLCanvasElement {
  if (ani.parts.length <= 1) return ani.first;
  const t = ms % ani.total;
  let i = ani.ends.findIndex(end => t < end);
  if (i < 0) i = 0;
  if (i === ani.idx) return ani.view;
  if (i < ani.idx) { // looped round: start again from a blank canvas
    ani.view.getContext('2d')!.clearRect(0, 0, ani.width, ani.height);
    ani.idx = -1;
    ani.restore = null;
  }
  for (let k = ani.idx + 1; k <= i; k++) apply(ani, k);
  return ani.view;
}

function decode(buf: ArrayBuffer): Ani {
  const gif = parseGIF(buf);
  const raw = decompressFrames(gif, true);
  const width = gif.lsd.width, height = gif.lsd.height;
  const parts: Part[] = raw.map(f => {
    const img = new ImageData(f.dims.width, f.dims.height);
    img.data.set(f.patch);
    return {img, left: f.dims.left, top: f.dims.top, disposal: f.disposalType};
  });
  const ends: number[] = [];
  let time = 0;
  for (const f of raw) { time += Math.max(20, f.delay || 100); ends.push(time); }
  const view = document.createElement('canvas');
  view.width = width;
  view.height = height;
  const ani: Ani = {first: document.createElement('canvas'), view, parts, idx: -1, restore: null, ends, total: Math.max(1, time), width, height, cx: width / 2};
  // One pass through every frame: keep the first as a still picture and find the body's centre.
  let sx = 0, n = 0;
  const ctx = view.getContext('2d')!;
  for (let i = 0; i < parts.length; i++) {
    apply(ani, i);
    if (i === 0) { ani.first.width = width; ani.first.height = height; ani.first.getContext('2d')!.drawImage(view, 0, 0); }
    if (i % 3 === 0) {
      const a = ctx.getImageData(0, 0, width, height).data;
      for (let p = 3, x = 0; p < a.length; p += 4, x = x + 1 === width ? 0 : x + 1) if (a[p] > 8) { sx += x; n++; }
    }
  }
  // Nothing drawn at all: the phone is out of canvas memory and blanked it. Give it back (the caller retries later).
  if (!n) { release(ani); throw new Error('blank'); }
  ani.cx = sx / n + 0.5;
  ctx.clearRect(0, 0, width, height);
  ani.idx = -1;
  ani.restore = null;
  return ani;
}
