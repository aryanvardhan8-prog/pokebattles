// Low-level drawing on the 160×144 Game Boy screen.

export const W = 160;
export const H = 144;

// Pokémon Yellow on Super Game Boy / Game Boy Color colours.
export const C = {
  bg: '#fffaf0', // panel / erase colour (warm cream)
  screen: '#e3eefb', // background of menu screens (soft blue)
  ink: '#1f2233',
  light: '#9aa3b5',
  hpGreen: '#2fc25b',
  hpYellow: '#f5b400',
  hpRed: '#e8433a',
  border: '#2b2d42',
  accentRed: '#e04a3a',
  accentBlue: '#3b78d8',
  gold: '#f6c445',
};

/** Everyday text: Nunito, drawn smoothly at the device's full sharpness (sizes are in game pixels). */
/** Where Nunito's baseline sits below the old 'top' / 'middle' positions, as a fraction of the font size
 *  (measured in Chrome). Drawing on the alphabetic baseline keeps text in the same place on every browser. */
export const NUNITO_TOP = 0.7413;
export const NUNITO_MIDDLE = 0.2413;
export const TEXT_FONT = '800 7.5px "Nunito"';
const LOGO_FONT = '8px "Press Start 2P"';

const measurer = document.createElement('canvas').getContext('2d')!;
/** Width of a line of everyday text, in game pixels. */
export function textWidth(s: string): number {
  measurer.font = TEXT_FONT;
  return Math.ceil(measurer.measureText(s).width);
}

/** Draws text once onto its own small canvas and snaps it to solid pixels. */
function crispText(s: string, color: string, font: string, width: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, width);
  cv.height = 8;
  const c = cv.getContext('2d')!;
  c.font = font;
  c.textBaseline = 'top';
  c.fillStyle = color;
  c.fillText(s, 0, 0);
  const img = c.getImageData(0, 0, cv.width, 8);
  const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  for (let i = 0; i < img.data.length; i += 4) {
    const on = img.data[i + 3] >= 110;
    img.data[i] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = b;
    img.data[i + 3] = on ? 255 : 0;
  }
  c.putImageData(img, 0, 0);
  return cv;
}

export class Gfx {
  ctx: CanvasRenderingContext2D;
  private glyphs = new Map<string, HTMLCanvasElement>();
  offsetX = 0; // screen shake
  offsetY = 0;

  /** How many real pixels each game pixel gets (so text can be smooth and sharp). */
  res = 1;

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.setResolution(4);
  }

  /** The game still thinks in 160×144 pixels; the canvas behind it is res× bigger. */
  setResolution(res: number) {
    this.res = Math.max(1, Math.round(res));
    this.canvas.width = W * this.res;
    this.canvas.height = H * this.res;
    this.ctx.setTransform(this.res, 0, 0, this.res, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  clear(color = C.screen) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, W, H);
  }

  rect(x: number, y: number, w: number, h: number, color: string) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x + this.offsetX), Math.round(y + this.offsetY), w, h);
  }

  /** One 8×8 character of the chunky logo font, cut to hard pixels (no blurry edges). */
  private glyph(ch: string, color: string): HTMLCanvasElement {
    const key = ch + color;
    let g = this.glyphs.get(key);
    if (g) return g;
    g = crispText(ch, color, LOGO_FONT, 8);
    this.glyphs.set(key, g);
    return g;
  }

  /** Everyday text (smooth Nunito; pixel art stays pixel art). */
  text(s: string, x: number, y: number, color = C.ink) {
    if (!s) return;
    const c = this.ctx;
    c.font = TEXT_FONT;
    c.textBaseline = 'alphabetic'; // 'top'/'middle' sit lower on iPhone Safari than in Chrome; the baseline is the same everywhere
    c.fillStyle = color;
    c.fillText(s, x + this.offsetX, y + this.offsetY + 0.5 + NUNITO_TOP * 7.5);
  }

  /** Big text for logos: each pixel of the font drawn as a scale×scale block. */
  textBig(s: string, x: number, y: number, scale: number, color = C.ink) {
    for (let i = 0; i < s.length; i++) {
      if (s[i] === ' ') continue;
      this.ctx.drawImage(this.glyph(s[i], color), Math.round(x + i * 8 * scale), Math.round(y), 8 * scale, 8 * scale);
    }
  }

  textRight(s: string, right: number, y: number, color = C.ink) {
    this.text(s, right - textWidth(s), y, color);
  }

  /** Menu pointer: a smooth red arrow. */
  cursor(x: number, y: number, color = C.accentRed) {
    const c = this.ctx;
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(x + 1 + this.offsetX, y + 0.5 + this.offsetY);
    c.lineTo(x + 6 + this.offsetX, y + 4 + this.offsetY);
    c.lineTo(x + 1 + this.offsetX, y + 7.5 + this.offsetY);
    c.closePath();
    c.fill();
  }

  hollowCursor(x: number, y: number) {
    const c = this.ctx;
    c.strokeStyle = C.accentRed;
    c.lineWidth = 0.9;
    c.beginPath();
    c.moveTo(x + 1.5, y + 1);
    c.lineTo(x + 5.5, y + 4);
    c.lineTo(x + 1.5, y + 7);
    c.closePath();
    c.stroke();
  }

  /** "More text" arrow. */
  downArrow(x: number, y: number, color = C.accentRed) {
    const c = this.ctx;
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(x + 0.5 + this.offsetX, y + 2 + this.offsetY);
    c.lineTo(x + 6.5 + this.offsetX, y + 2 + this.offsetY);
    c.lineTo(x + 3.5 + this.offsetX, y + 6 + this.offsetY);
    c.closePath();
    c.fill();
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number) {
    const c = this.ctx;
    c.beginPath();
    if (c.roundRect) c.roundRect(x + this.offsetX, y + this.offsetY, w, h, r);
    else c.rect(x + this.offsetX, y + this.offsetY, w, h);
  }

  /** Rounded panel with a dark outline and an optional coloured stripe on the left. */
  panel(x: number, y: number, w: number, h: number, opts: {fill?: string; accent?: string; radius?: number} = {}) {
    const c = this.ctx, r = opts.radius ?? 3;
    c.save();
    c.fillStyle = 'rgba(31, 34, 51, 0.18)'; // drop shadow
    this.roundRect(x + 1, y + 1.5, w, h, r);
    c.fill();
    c.fillStyle = opts.fill ?? C.bg;
    this.roundRect(x, y, w, h, r);
    c.fill();
    if (opts.accent) {
      c.save();
      this.roundRect(x, y, w, h, r);
      c.clip();
      c.fillStyle = opts.accent;
      c.fillRect(x + this.offsetX, y + this.offsetY, 3, h);
      c.restore();
    }
    c.lineWidth = 1.2;
    c.strokeStyle = C.border;
    this.roundRect(x + 0.6, y + 0.6, w - 1.2, h - 1.2, r);
    c.stroke();
    c.restore();
  }

  /** Text frame used by every text box and menu: cream panel, dark rounded outline. */
  box(x: number, y: number, w: number, h: number) {
    this.panel(x + 1, y + 1, w - 2, h - 2, {radius: 4});
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(59, 120, 216, 0.35)';
    this.ctx.lineWidth = 0.8;
    this.roundRect(x + 3.5, y + 3.5, w - 7, h - 7, 2.5);
    this.ctx.stroke();
    this.ctx.restore();
  }

  /** Box in 8px tile units, like the real game's layouts. */
  tileBox(tx: number, ty: number, tw: number, th: number) {
    this.box(tx * 8, ty * 8, tw * 8, th * 8);
  }

  /** HP bar: small gold "HP" tag, then a rounded bar that turns yellow and red as HP drops. */
  hpBar(x: number, y: number, hp: number, max: number, width = 48) {
    const c = this.ctx;
    c.save();
    c.fillStyle = C.gold;
    this.roundRect(x - 13, y - 0.5, 12, 6, 1.5);
    c.fill();
    c.font = '800 5px "Nunito"';
    c.textBaseline = 'alphabetic';
    c.fillStyle = C.ink;
    c.fillText('HP', x - 11.2 + this.offsetX, y + 2.6 + this.offsetY + NUNITO_MIDDLE * 5);
    c.fillStyle = C.border;
    this.roundRect(x - 0.5, y - 0.5, width + 1, 6, 2.5);
    c.fill();
    c.fillStyle = '#e9edf3';
    this.roundRect(x + 0.5, y + 0.5, width - 1, 4, 1.8);
    c.fill();
    const frac = hp <= 0 ? 0 : Math.max(1 / width, hp / max);
    const color = frac > 0.5 ? C.hpGreen : frac > 0.2 ? C.hpYellow : C.hpRed;
    if (frac > 0) {
      c.fillStyle = color;
      this.roundRect(x + 0.5, y + 0.5, Math.max(1.5, (width - 1) * frac), 4, 1.8);
      c.fill();
      c.fillStyle = 'rgba(255, 255, 255, 0.35)'; // shine
      c.fillRect(x + 1.5 + this.offsetX, y + 1 + this.offsetY, Math.max(0, (width - 3) * frac), 1);
    }
    c.restore();
  }

  /** Battle backdrop: the island beach. Sky, sea with moving waves, sand, and sandy platforms. */
  battleBackground(time = 0) {
    const c = this.ctx;
    const sky = c.createLinearGradient(0, 0, 0, 36);
    sky.addColorStop(0, '#79c3f0');
    sky.addColorStop(1, '#d9f0ff');
    c.fillStyle = sky;
    c.fillRect(0, 0, W, 36);
    // a couple of soft clouds
    c.fillStyle = 'rgba(255, 255, 255, 0.8)';
    for (const [cx, cy, r] of [[30, 12, 5], [37, 10, 6], [44, 13, 4], [100, 20, 4], [106, 18, 5]] as const) {
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.fill();
    }
    // sea
    const sea = c.createLinearGradient(0, 34, 0, 52);
    sea.addColorStop(0, '#2f8fd0');
    sea.addColorStop(1, '#5fc0e8');
    c.fillStyle = sea;
    c.fillRect(0, 34, W, 18);
    c.fillStyle = 'rgba(255, 255, 255, 0.55)';
    const shift = (time / 120) % 24;
    for (let row = 0; row < 3; row++) {
      for (let x = -24 + ((shift + row * 9) % 24); x < W; x += 24) c.fillRect(x, 37 + row * 5, 9, 0.8);
    }
    // foam line and wet sand
    c.fillStyle = '#ffffff';
    c.fillRect(0, 51, W, 1.2);
    c.fillStyle = '#e4cf98';
    c.fillRect(0, 52, W, 3);
    // dry sand
    const sand = c.createLinearGradient(0, 55, 0, 100);
    sand.addColorStop(0, '#f6e4ad');
    sand.addColorStop(1, '#ecd08d');
    c.fillStyle = sand;
    c.fillRect(0, 55, W, 45);
    c.fillStyle = 'rgba(176, 133, 70, 0.35)'; // grains & shells
    for (const [x, y] of [[12, 62], [70, 66], [150, 70], [96, 86], [58, 92], [140, 90], [20, 84], [84, 74]] as const) c.fillRect(x, y, 1, 1);
    c.fillStyle = '#ffffff';
    c.fillRect(66, 80, 1.5, 1);
    c.fillRect(146, 64, 1.5, 1);
    const platform = (cx: number, cy: number, rx: number, ry: number) => {
      c.fillStyle = '#d2ac63';
      c.beginPath();
      c.ellipse(cx, cy + 1.5, rx, ry, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#f9e9bd';
      c.beginPath();
      c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255, 255, 255, 0.45)';
      c.beginPath();
      c.ellipse(cx, cy - ry * 0.35, rx * 0.65, ry * 0.35, 0, 0, Math.PI * 2);
      c.fill();
    };
    platform(122, 60, 34, 7);
    platform(40, 97, 46, 10);
  }

  /** Rounded colour pill (badges, tags). */
  pill(x: number, y: number, w: number, h: number, fill: string, r = 2) {
    this.ctx.fillStyle = fill;
    this.roundRect(x, y, w, h, r);
    this.ctx.fill();
  }

  /** Draws an emoji (full colour) at a given size in game pixels. */
  emoji(ch: string, x: number, y: number, size: number) {
    const c = this.ctx;
    c.save();
    c.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    c.textBaseline = 'top';
    c.fillText(ch, x + this.offsetX, y + this.offsetY);
    c.restore();
  }

  /** Smaller text for labels inside badges and bars. */
  smallText(s: string, x: number, y: number, color = C.ink, size = 5.5) {
    const c = this.ctx;
    c.font = `800 ${size}px "Nunito"`;
    c.textBaseline = 'alphabetic';
    c.fillStyle = color;
    c.fillText(s, x + this.offsetX, y + this.offsetY + NUNITO_TOP * size);
  }

  smallWidth(s: string, size = 5.5) {
    this.ctx.font = `800 ${size}px "Nunito"`;
    return this.ctx.measureText(s).width;
  }

  image(img: CanvasImageSource, x: number, y: number, w: number, h: number) {
    this.ctx.drawImage(img, Math.round(x + this.offsetX), Math.round(y + this.offsetY), w, h);
  }

  invert() {
    const c = this.ctx;
    c.save();
    c.globalCompositeOperation = 'difference';
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, W, H);
    c.restore();
  }
}

// ---------- sprites ----------

const cache = new Map<string, Promise<HTMLCanvasElement>>();

/** Loads a sprite and turns its white background transparent. */
export function loadSprite(url: string, trim = false): Promise<HTMLCanvasElement> {
  let p = cache.get(url);
  if (p) return p;
  p = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      let minX = c.width, minY = c.height, maxX = 0, maxY = 0;
      for (let i = 0; i < d.data.length; i += 4) {
        if (d.data[i] > 240 && d.data[i + 1] > 240 && d.data[i + 2] > 240) d.data[i + 3] = 0;
        if (d.data[i + 3] > 0) {
          const px = (i / 4) % c.width, py = Math.floor(i / 4 / c.width);
          minX = Math.min(minX, px); maxX = Math.max(maxX, px);
          minY = Math.min(minY, py); maxY = Math.max(maxY, py);
        }
      }
      ctx.putImageData(d, 0, 0);
      if (!trim || maxX < minX) return resolve(c);
      const t = document.createElement('canvas');
      t.width = maxX - minX + 1;
      t.height = maxY - minY + 1;
      t.getContext('2d')!.drawImage(c, -minX, -minY);
      resolve(t);
    };
    img.onerror = reject;
    img.src = url;
  });
  cache.set(url, p);
  return p;
}

const BASE = import.meta.env.BASE_URL;
export const frontUrl = (num: number) => `${BASE}sprites/front/${num}.png`;
export const backUrl = (num: number) => `${BASE}sprites/back/${num}.png`;
export const redUrl = `${BASE}sprites/trainers/red-hd.png`;
export const playerUrl = `${BASE}sprites/trainers/player-hd.png`;

/** Word-wraps text to lines no wider than `width` pixels (the text box fits 144). */
export function wrap(s: string, width = 144): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of s.split(' ')) {
    if (!line) line = word;
    else if (textWidth(line + ' ' + word) <= width) line += ' ' + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ---------- size by real height ----------

const sizedCache = new Map<string, HTMLCanvasElement>();

/**
 * Gen 1 draws every Pokémon in the same square, so a Pidgey looks as big as a Snorlax.
 * This rescales a sprite so its height follows the Pokémon's real Pokédex height
 * (on a log scale, so tiny ones stay visible and giants still fit), standing on the
 * bottom of a `box`×`box` square.
 */
export function sizedSprite(src: HTMLCanvasElement, heightM: number, box: number, key: string): HTMLCanvasElement {
  const cacheKey = `${key}:${box}`;
  const hit = sizedCache.get(cacheKey);
  if (hit) return hit;

  // Bounding box of the visible pixels.
  const sctx = src.getContext('2d')!;
  const data = sctx.getImageData(0, 0, src.width, src.height).data;
  let x0 = src.width, y0 = src.height, x1 = -1, y1 = -1;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (data[(y * src.width + x) * 4 + 3] > 0) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
  }
  const out = document.createElement('canvas');
  out.width = box;
  out.height = box;
  if (x1 < 0) return out;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;

  // Target height: ~40% of the box for 0.3 m, ~70% for 1 m, full box from ~2.5 m up.
  const frac = Math.min(1, Math.max(0.36, 0.7 + 0.19 * Math.log2(Math.max(0.1, heightM))));
  const target = frac * box;
  const k = Math.min(1.15, target / h, box / w, box / h);

  const ctx = out.getContext('2d')!;
  // Shrinking pixel art: smooth it so details survive, then snap edges back to solid.
  ctx.imageSmoothingEnabled = k < 1;
  ctx.imageSmoothingQuality = 'high';
  const dw = Math.round(w * k), dh = Math.round(h * k);
  ctx.drawImage(src, x0, y0, w, h, Math.round((box - dw) / 2), box - dh, dw, dh);
  const img = ctx.getImageData(0, 0, box, box);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] > 100 ? 255 : 0;
  ctx.putImageData(img, 0, 0);
  sizedCache.set(cacheKey, out);
  return out;
}

const iconCache = new Map<string, HTMLCanvasElement>();

/** A 16×16 menu icon: the sprite's visible part shrunk to fit, standing on the bottom edge. */
export function iconSprite(src: HTMLCanvasElement, key: string, size = 16): HTMLCanvasElement {
  const hit = iconCache.get(key);
  if (hit) return hit;
  const data = src.getContext('2d')!.getImageData(0, 0, src.width, src.height).data;
  let x0 = src.width, y0 = src.height, x1 = -1, y1 = -1;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (data[(y * src.width + x) * 4 + 3] > 0) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
  }
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  if (x1 < 0) return out;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const k = Math.min(size / w, size / h);
  const dw = Math.max(1, Math.round(w * k)), dh = Math.max(1, Math.round(h * k));
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, x0, y0, w, h, Math.round((size - dw) / 2), size - dh, dw, dh);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] > 90 ? 255 : 0;
  ctx.putImageData(img, 0, 0);
  iconCache.set(key, out);
  return out;
}
