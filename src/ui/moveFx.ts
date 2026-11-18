// Move animations, one style per type. Each is drawn from a progress value t (0 → 1):
// roughly the first half travels from the attacker to the target, the second half is the impact.
// Status moves that boost the user show rising arrows on the user instead.

import type {Gfx} from './gfx';

export interface Fx {
  type: string;
  kind: 'attack' | 'boost' | 'status' | 'charge';
  move?: string;
  from: {x: number; y: number};
  to: {x: number; y: number};
  t: number;
}

/** Frames each animation lasts (60 = one second). */
export const FX_FRAMES = 42;

const rnd = (i: number, k = 0) => {
  const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return s - Math.floor(s);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);

/** How much to shake the screen right now (game pixels). */
export function fxShake(fx: Fx | null): number {
  if (!fx || fx.kind === 'charge') return 0;
  const special = moveShake(fx);
  if (special !== null) return special;
  if (fx.kind !== 'attack') return 0;
  const hit = fx.t > 0.5 ? (fx.t - 0.5) * 2 : 0;
  if (!hit) return 0;
  const strong = fx.type === 'Ground' || fx.type === 'Rock' || fx.type === 'Fighting';
  return strong ? Math.sin(hit * 60) * 2 * (1 - hit) : 0;
}

/** Full-screen colour wash for some types (lightning flash, ghostly dark, icy blue). */
export function fxOverlay(g: Gfx, fx: Fx | null) {
  if (!fx) return;
  const c = g.ctx;
  if (fx.kind === 'charge') {
    // Solar Beam / Sky Attack: the scene brightens while the user powers up.
    if (fx.move === 'solarbeam' || fx.move === 'skyattack') {
      c.fillStyle = `rgba(255, 250, 200, ${0.22 * Math.sin(Math.PI * fx.t)})`;
      c.fillRect(0, 0, 160, 96);
    }
    return;
  }
  const special = moveOverlay(fx);
  if (special !== null) {
    if (special) {
      c.fillStyle = special;
      c.fillRect(0, 0, 160, 96);
    }
    return;
  }
  if (fx.kind !== 'attack' || (fx.move && fx.move in MOVE_FX)) return;
  const hit = fx.t > 0.5 ? (fx.t - 0.5) * 2 : 0;
  let color = '';
  if (fx.type === 'Electric' && hit > 0 && Math.floor(hit * 10) % 3 === 0) color = 'rgba(255, 245, 140, 0.35)';
  if (fx.type === 'Ghost') color = `rgba(40, 20, 70, ${0.35 * Math.sin(Math.PI * fx.t)})`;
  if (fx.type === 'Ice' && hit > 0) color = `rgba(170, 230, 255, ${0.25 * (1 - hit)})`;
  if (fx.type === 'Psychic' && hit > 0) color = `rgba(255, 120, 200, ${0.15 * Math.sin(Math.PI * hit)})`;
  if (!color) return;
  c.fillStyle = color;
  c.fillRect(0, 0, 160, 96);
}

export function drawFx(g: Gfx, fx: Fx | null) {
  if (!fx) return;
  const c = g.ctx;
  c.save();
  const special = fx.move ? MOVE_FX[fx.move] : undefined;
  if (fx.kind === 'charge') drawCharge(c, fx);
  else if (special) special(c, fx);
  else if (fx.kind === 'boost') drawBoost(c, fx);
  else if (fx.kind === 'status') drawStatus(c, fx);
  else (ATTACKS[fx.type] ?? ATTACKS.Normal)(c, fx);
  c.restore();
}

type Ctx = CanvasRenderingContext2D;

// ---------- helpers ----------

function glowBall(c: Ctx, x: number, y: number, r: number, inner: string, outer: string) {
  const grad = c.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  c.fillStyle = grad;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}

function travel(fx: Fx, t: number, arc = 0) {
  const k = ease(Math.min(1, t));
  return {
    x: lerp(fx.from.x, fx.to.x, k),
    y: lerp(fx.from.y, fx.to.y, k) - Math.sin(Math.PI * k) * arc,
  };
}

function burst(c: Ctx, x: number, y: number, hit: number, color: string, rays = 8, size = 14) {
  c.globalAlpha = Math.max(0, 1 - hit);
  c.strokeStyle = color;
  c.lineWidth = 1.2;
  c.lineCap = 'round';
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + 0.3;
    c.beginPath();
    c.moveTo(x + Math.cos(a) * size * 0.3 * (1 + hit), y + Math.sin(a) * size * 0.3 * (1 + hit));
    c.lineTo(x + Math.cos(a) * size * (0.5 + hit), y + Math.sin(a) * size * (0.5 + hit));
    c.stroke();
  }
  c.globalAlpha = 1;
}

function star(c: Ctx, x: number, y: number, r: number, color: string, points = 8) {
  c.fillStyle = color;
  c.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i * Math.PI) / points;
    const rr = i % 2 === 0 ? r : r * 0.45;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
  c.fill();
}

const phase = (fx: Fx) => ({go: Math.min(1, fx.t * 2), hit: fx.t > 0.5 ? (fx.t - 0.5) * 2 : 0});

// ---------- one animation per type ----------

const ATTACKS: Record<string, (c: Ctx, fx: Fx) => void> = {
  Normal(c, fx) {
    const {hit} = phase(fx);
    if (!hit) return;
    const {x, y} = fx.to;
    c.globalAlpha = 1 - hit;
    star(c, x, y, 6 + hit * 10, '#ffffff');
    star(c, x, y, 3 + hit * 6, '#ffe680');
    burst(c, x, y, hit, '#ffffff', 8, 16);
  },

  Fighting(c, fx) {
    const {hit} = phase(fx);
    const {x, y} = fx.to;
    if (!hit) { // a fist-like blur rushing in
      const p = travel(fx, fx.t * 2);
      glowBall(c, p.x, p.y, 4, 'rgba(255,200,120,0.9)', 'rgba(255,120,40,0)');
      return;
    }
    c.globalAlpha = 1 - hit;
    star(c, x, y, 8 + hit * 12, '#ff7a2f', 6);
    star(c, x, y, 5 + hit * 8, '#fff2c0', 6);
    burst(c, x, y, hit, '#ffffff', 10, 22);
  },

  Fire(c, fx) {
    const {go, hit} = phase(fx);
    for (let i = 0; i < 3; i++) { // three fireballs in an arc
      const p = travel(fx, go - i * 0.12, 10);
      if (go - i * 0.12 > 0 && go - i * 0.12 < 1) glowBall(c, p.x, p.y, 6, '#fff6b0', 'rgba(255,90,20,0)');
    }
    if (!hit) return;
    for (let i = 0; i < 9; i++) { // flames licking upward
      const fx0 = fx.to.x + (rnd(i) - 0.5) * 30, rise = ((hit * 1.6 + rnd(i, 2)) % 1);
      const fy = fx.to.y + 12 - rise * 30, r = 7 * (1 - rise);
      c.fillStyle = `rgba(255, ${120 + rnd(i, 3) * 100 | 0}, 30, ${0.85 * (1 - rise)})`;
      c.beginPath();
      c.moveTo(fx0, fy - r * 1.8);
      c.quadraticCurveTo(fx0 + r, fy, fx0, fy + r);
      c.quadraticCurveTo(fx0 - r, fy, fx0, fy - r * 1.8);
      c.fill();
    }
  },

  Water(c, fx) {
    const {go, hit} = phase(fx);
    for (let i = 0; i < 10; i++) { // stream of droplets
      const tt = go - i * 0.06;
      if (tt <= 0 || tt >= 1) continue;
      const p = travel(fx, tt, 4);
      glowBall(c, p.x, p.y, 3.2, '#e6f6ff', 'rgba(60,140,240,0.25)');
    }
    if (!hit) return;
    for (let i = 0; i < 12; i++) { // splash
      const a = (i / 12) * Math.PI * 2;
      const d = hit * (10 + rnd(i) * 10);
      c.fillStyle = `rgba(110, 180, 255, ${1 - hit})`;
      c.beginPath();
      c.arc(fx.to.x + Math.cos(a) * d, fx.to.y + Math.sin(a) * d * 0.7 - hit * 4, 1.8, 0, Math.PI * 2);
      c.fill();
    }
    for (let i = 0; i < 5; i++) { // bubbles
      c.strokeStyle = `rgba(220, 240, 255, ${1 - hit})`;
      c.lineWidth = 0.6;
      c.beginPath();
      c.arc(fx.to.x + (rnd(i, 5) - 0.5) * 20, fx.to.y + 6 - hit * 20 * rnd(i, 6), 1.5 + rnd(i) * 1.5, 0, Math.PI * 2);
      c.stroke();
    }
  },

  Grass(c, fx) {
    const {go, hit} = phase(fx);
    for (let i = 0; i < 6; i++) {
      const tt = Math.min(1, go - i * 0.07);
      if (tt <= 0) continue;
      let p = travel(fx, tt, 6 + i * 2);
      if (hit) { // scatter outward
        const a = rnd(i) * Math.PI * 2;
        p = {x: fx.to.x + Math.cos(a) * hit * 18, y: fx.to.y + Math.sin(a) * hit * 12};
      }
      c.save();
      c.globalAlpha = hit ? 1 - hit : 1;
      c.translate(p.x, p.y);
      c.rotate(fx.t * 12 + i);
      c.fillStyle = i % 2 ? '#5fbf3f' : '#8fdc5a';
      c.beginPath();
      c.ellipse(0, 0, 4.5, 1.8, 0, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#2f7a24';
      c.lineWidth = 0.4;
      c.beginPath();
      c.moveTo(-3, 0);
      c.lineTo(3, 0);
      c.stroke();
      c.restore();
    }
  },

  Electric(c, fx) {
    const {hit} = phase(fx);
    const {x, y} = fx.to;
    const flicker = Math.floor(fx.t * 30) % 3 !== 2;
    if (fx.t < 0.35 || !flicker) return;
    c.strokeStyle = '#fff36a';
    c.lineWidth = 1.8;
    c.lineJoin = 'round';
    for (let b = 0; b < 3; b++) { // lightning bolts striking down
      c.beginPath();
      let bx = x + (b - 1) * 9, by = y - 40;
      c.moveTo(bx, by);
      for (let s = 0; s < 6; s++) {
        bx += (rnd(b * 7 + s, Math.floor(fx.t * 20)) - 0.5) * 9;
        by += 7;
        c.lineTo(bx, by);
      }
      c.stroke();
    }
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.lineWidth = 0.6;
    c.stroke();
    if (hit) glowBall(c, x, y, 12 * (1 - hit) + 4, 'rgba(255,255,200,0.8)', 'rgba(255,230,60,0)');
  },

  Ice(c, fx) {
    const {go, hit} = phase(fx);
    if (!hit) { // icy beam
      const p = travel(fx, go);
      const grad = c.createLinearGradient(fx.from.x, fx.from.y, p.x, p.y);
      grad.addColorStop(0, 'rgba(180,235,255,0.1)');
      grad.addColorStop(1, 'rgba(230,250,255,0.95)');
      c.strokeStyle = grad;
      c.lineWidth = 2.5;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(fx.from.x, fx.from.y);
      c.lineTo(p.x, p.y);
      c.stroke();
      return;
    }
    for (let i = 0; i < 8; i++) { // ice crystals forming around the target
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const d = 9 + rnd(i) * 7;
      const s = Math.min(1, hit * 2) * (2.5 + rnd(i, 1) * 2);
      const px = fx.to.x + Math.cos(a) * d, py = fx.to.y + Math.sin(a) * d * 0.8;
      c.globalAlpha = hit > 0.7 ? (1 - hit) / 0.3 : 1;
      c.fillStyle = 'rgba(200,240,255,0.9)';
      c.strokeStyle = '#6fc7ee';
      c.lineWidth = 0.4;
      c.beginPath();
      c.moveTo(px, py - s * 1.6);
      c.lineTo(px + s * 0.7, py);
      c.lineTo(px, py + s * 1.6);
      c.lineTo(px - s * 0.7, py);
      c.closePath();
      c.fill();
      c.stroke();
    }
  },

  Poison(c, fx) {
    const {go, hit} = phase(fx);
    for (let i = 0; i < 4; i++) {
      const tt = go - i * 0.1;
      if (tt <= 0 || tt >= 1) continue;
      const p = travel(fx, tt, 8);
      glowBall(c, p.x, p.y, 3, '#e8a6ff', 'rgba(140,40,170,0.3)');
    }
    if (!hit) return;
    for (let i = 0; i < 10; i++) { // bubbling poison
      const rise = (hit * 1.4 + rnd(i)) % 1;
      c.globalAlpha = 1 - rise;
      c.fillStyle = i % 2 ? '#a24bc9' : '#d68cf0';
      c.beginPath();
      c.arc(fx.to.x + (rnd(i, 2) - 0.5) * 24, fx.to.y + 8 - rise * 22, 1.5 + rnd(i, 3) * 2, 0, Math.PI * 2);
      c.fill();
    }
  },

  Ground(c, fx) {
    const {hit} = phase(fx);
    if (fx.t < 0.3) return;
    const h = (fx.t - 0.3) / 0.7;
    const base = fx.to.y + 14;
    for (let i = 0; i < 10; i++) { // rocks and dust thrown up from the ground
      const a = -Math.PI / 2 + (rnd(i) - 0.5) * 2.2;
      const v = 18 + rnd(i, 1) * 14;
      const px = fx.to.x + (rnd(i, 2) - 0.5) * 22 + Math.cos(a) * v * h;
      const py = base + Math.sin(a) * v * h + 30 * h * h;
      c.globalAlpha = 1 - h;
      c.fillStyle = i % 3 ? '#9b7646' : '#c79b5f';
      c.beginPath();
      c.ellipse(px, py, 2 + rnd(i, 3) * 1.5, 1.5 + rnd(i, 4), rnd(i, 5) * 3, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 0.5 * (1 - hit);
    c.fillStyle = '#d8bb86'; // dust cloud
    c.beginPath();
    c.ellipse(fx.to.x, base, 14 + h * 10, 4 + h * 3, 0, 0, Math.PI * 2);
    c.fill();
  },

  Flying(c, fx) {
    const {go, hit} = phase(fx);
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.lineWidth = 1;
    c.lineCap = 'round';
    for (let i = 0; i < 4; i++) { // wind gusts
      const p = travel(fx, Math.min(1, go - i * 0.08), 3 + i * 3);
      if (go - i * 0.08 <= 0) continue;
      c.globalAlpha = hit ? 1 - hit : 0.9;
      c.beginPath();
      c.arc(p.x, p.y + (i - 1.5) * 4, 5 + i, -0.5, 1.8);
      c.stroke();
    }
    if (!hit) return;
    for (let i = 0; i < 5; i++) { // feathers
      c.save();
      c.globalAlpha = 1 - hit;
      c.translate(fx.to.x + (rnd(i) - 0.5) * 24, fx.to.y - 8 + hit * 16 * rnd(i, 1));
      c.rotate(Math.sin(hit * 8 + i) * 0.8);
      c.fillStyle = '#f2efe8';
      c.beginPath();
      c.ellipse(0, 0, 3.2, 1.1, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
  },

  Psychic(c, fx) {
    const {go, hit} = phase(fx);
    c.lineWidth = 1.2;
    if (!hit) {
      const p = travel(fx, go);
      c.strokeStyle = 'rgba(255,120,200,0.8)';
      c.beginPath();
      c.arc(p.x, p.y, 3 + go * 4, 0, Math.PI * 2);
      c.stroke();
      return;
    }
    for (let i = 0; i < 4; i++) { // pulsing rings
      const r = ((hit * 2 + i / 4) % 1) * 22;
      c.strokeStyle = `rgba(${i % 2 ? '255,110,190' : '190,120,255'}, ${1 - r / 22})`;
      c.beginPath();
      c.ellipse(fx.to.x, fx.to.y, r, r * 0.75, 0, 0, Math.PI * 2);
      c.stroke();
    }
  },

  Bug(c, fx) {
    const {go, hit} = phase(fx);
    c.strokeStyle = '#a6c51f';
    c.lineWidth = 0.9;
    c.lineCap = 'round';
    for (let i = 0; i < 5; i++) { // needles
      const tt = go - i * 0.07;
      if (tt <= 0 || tt >= 1) continue;
      const p = travel(fx, tt, 2), q = travel(fx, tt - 0.08, 2);
      c.beginPath();
      c.moveTo(q.x, q.y + (i - 2) * 2);
      c.lineTo(p.x, p.y + (i - 2) * 2);
      c.stroke();
    }
    if (hit) burst(c, fx.to.x, fx.to.y, hit, '#c8e24a', 6, 12);
  },

  Rock(c, fx) {
    if (fx.t < 0.25) return;
    const h = (fx.t - 0.25) / 0.75;
    for (let i = 0; i < 6; i++) { // rocks raining down
      const start = rnd(i) * 0.4;
      const k = Math.min(1, Math.max(0, (h - start) / 0.45));
      if (k <= 0) continue;
      const px = fx.to.x + (rnd(i, 1) - 0.5) * 26;
      const py = fx.to.y - 44 + k * 50;
      c.globalAlpha = k >= 1 ? Math.max(0, 1 - (h - start - 0.45) * 4) : 1;
      c.fillStyle = i % 2 ? '#8d8476' : '#b0a593';
      c.strokeStyle = '#5c554b';
      c.lineWidth = 0.5;
      c.beginPath();
      const r = 2.5 + rnd(i, 2) * 2;
      for (let s = 0; s < 6; s++) {
        const a = (s / 6) * Math.PI * 2;
        c.lineTo(px + Math.cos(a) * r * (0.8 + rnd(i, s) * 0.4), py + Math.sin(a) * r * (0.8 + rnd(s, i) * 0.4));
      }
      c.closePath();
      c.fill();
      c.stroke();
    }
  },

  Ghost(c, fx) {
    const {x, y} = fx.to;
    for (let i = 0; i < 5; i++) { // shadowy wisps circling the target
      const a = fx.t * Math.PI * 4 + (i / 5) * Math.PI * 2;
      const px = x + Math.cos(a) * 14, py = y + Math.sin(a) * 8;
      glowBall(c, px, py, 4, 'rgba(160,110,220,0.8)', 'rgba(60,30,100,0)');
    }
    if (fx.t > 0.5) glowBall(c, x, y, 10 * Math.sin(Math.PI * fx.t), 'rgba(40,10,70,0.6)', 'rgba(40,10,70,0)');
  },

  Dragon(c, fx) {
    const {go, hit} = phase(fx);
    if (!hit) { // spiralling twin energy streams
      for (let s = 0; s < 2; s++) {
        c.strokeStyle = s ? 'rgba(120,90,255,0.9)' : 'rgba(80,190,255,0.9)';
        c.lineWidth = 1.4;
        c.beginPath();
        for (let k = 0; k <= 20; k++) {
          const tt = (k / 20) * go;
          const p = travel(fx, tt);
          const off = Math.sin(tt * 18 + s * Math.PI) * 4;
          c.lineTo(p.x, p.y + off);
        }
        c.stroke();
      }
      return;
    }
    glowBall(c, fx.to.x, fx.to.y, 6 + hit * 16, `rgba(170,140,255,${1 - hit})`, 'rgba(70,30,200,0)');
    burst(c, fx.to.x, fx.to.y, hit, '#8f7bff', 10, 20);
  },
};

// ---------- status moves ----------

/** The build-up turn of a two-turn move, drawn around the user (fx.from). */
function drawCharge(c: Ctx, fx: Fx) {
  const {x, y} = fx.from, t = fx.t;
  const fade = Math.sin(Math.PI * Math.min(1, t * 1.15));
  switch (fx.move) {
    case 'solarbeam': {
      // Motes of sunlight drift in from all around and gather into a growing glow.
      for (let i = 0; i < 28; i++) {
        const p = (t * 1.8 + rnd(i)) % 1, a = rnd(i, 1) * Math.PI * 2, r = 48 * (1 - ease(p));
        c.globalAlpha = Math.sin(Math.PI * p) * fade;
        c.fillStyle = i % 3 ? '#fff38a' : '#ffffff';
        c.fillRect(x + Math.cos(a) * r - 1.5, y + Math.sin(a) * r * 0.8 - 1.5, 3, 3);
      }
      const R = 8 + 22 * ease(t);
      const glow = c.createRadialGradient(x, y, 0, x, y, R);
      glow.addColorStop(0, 'rgba(255,255,235,1)');
      glow.addColorStop(0.45, 'rgba(255,245,150,0.75)');
      glow.addColorStop(1, 'rgba(255,240,120,0)');
      c.globalAlpha = fade;
      c.fillStyle = glow;
      c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.fill();
      break;
    }
    case 'skyattack': {
      // A pulsing golden aura.
      for (let k = 0; k < 3; k++) {
        const p = (t * 2 + k / 3) % 1;
        c.globalAlpha = (1 - p) * fade;
        c.strokeStyle = k % 2 ? '#fff6a0' : '#ffd24a';
        c.lineWidth = 2;
        c.beginPath(); c.ellipse(x, y, 8 + p * 22, 6 + p * 16, 0, 0, Math.PI * 2); c.stroke();
      }
      break;
    }
    case 'razorwind': {
      // Wind whirls around the user.
      c.strokeStyle = '#ffffff';
      c.lineWidth = 1.5;
      for (let i = 0; i < 5; i++) {
        const a = t * 12 + i * (Math.PI * 2 / 5), r = 14 + 4 * Math.sin(t * 9 + i);
        c.globalAlpha = 0.85 * fade;
        c.beginPath(); c.arc(x, y, r, a, a + 1.1); c.stroke();
      }
      break;
    }
    case 'skullbash': {
      // Focus lines pull in toward the user.
      c.strokeStyle = '#ffffff';
      c.lineWidth = 1.2;
      for (let i = 0; i < 10; i++) {
        const a = rnd(i) * Math.PI * 2, p = (t * 2 + rnd(i, 2)) % 1, r1 = 30 - p * 16;
        c.globalAlpha = Math.sin(Math.PI * p) * fade;
        c.beginPath(); c.moveTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1); c.lineTo(x + Math.cos(a) * (r1 - 7), y + Math.sin(a) * (r1 - 7)); c.stroke();
      }
      break;
    }
    case 'dig': {
      // Dirt flies up as the user burrows.
      for (let i = 0; i < 14; i++) {
        const p = (t * 1.4 + rnd(i)) % 1, dx = (rnd(i, 1) - 0.5) * 34;
        c.globalAlpha = (1 - p) * fade;
        c.fillStyle = i % 2 ? '#a0703c' : '#c8945a';
        c.fillRect(x + dx * p, y + 14 - Math.sin(Math.PI * p) * 18, 3, 3);
      }
      break;
    }
    case 'fly': {
      // Gusts streak upward as the user takes off.
      c.strokeStyle = '#ffffff';
      c.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) {
        const p = (t * 2 + rnd(i)) % 1, dx = (i - 2.5) * 7;
        c.globalAlpha = Math.sin(Math.PI * p) * fade;
        c.beginPath(); c.moveTo(x + dx, y + 16 - p * 34); c.lineTo(x + dx, y + 24 - p * 34); c.stroke();
      }
      break;
    }
    default:
      drawBoost(c, fx);
  }
  c.globalAlpha = 1;
}

function drawBoost(c: Ctx, fx: Fx) {
  // Rising arrows and sparkles around the user.
  const {x, y} = fx.from;
  for (let i = 0; i < 6; i++) {
    const rise = (fx.t * 1.5 + i / 6) % 1;
    const px = x + (i - 2.5) * 6, py = y + 14 - rise * 30;
    c.globalAlpha = Math.sin(Math.PI * rise);
    c.fillStyle = '#ff6b4a';
    c.beginPath();
    c.moveTo(px, py - 4);
    c.lineTo(px + 3, py);
    c.lineTo(px + 1, py);
    c.lineTo(px + 1, py + 4);
    c.lineTo(px - 1, py + 4);
    c.lineTo(px - 1, py);
    c.lineTo(px - 3, py);
    c.closePath();
    c.fill();
  }
  c.globalAlpha = 0.6 * Math.sin(Math.PI * fx.t);
  star(c, x + 10, y - 10, 2.5, '#fff6a0', 4);
  star(c, x - 12, y - 4, 2, '#fff6a0', 4);
}

function drawStatus(c: Ctx, fx: Fx) {
  // Coloured powder / rings drifting onto the target, in the move type's colour.
  const color = ({Grass: '186,230,90', Electric: '255,230,80', Poison: '200,110,240', Ghost: '150,100,220',
    Psychic: '255,120,200', Normal: '255,255,255', Water: '120,190,255', Ice: '190,235,255', Bug: '190,220,60',
  } as Record<string, string>)[fx.type] ?? '255,255,255';
  const {x, y} = fx.to;
  for (let i = 0; i < 14; i++) {
    const fall = (fx.t * 1.3 + rnd(i)) % 1;
    c.globalAlpha = Math.sin(Math.PI * fall) * 0.9;
    c.fillStyle = `rgb(${color})`;
    c.beginPath();
    c.arc(x + (rnd(i, 1) - 0.5) * 30 + Math.sin(fall * 6 + i) * 3, y - 24 + fall * 34, 1 + rnd(i, 2), 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 0.7 * Math.sin(Math.PI * fx.t);
  c.strokeStyle = `rgb(${color})`;
  c.lineWidth = 1;
  c.beginPath();
  c.ellipse(x, y, 12 + fx.t * 8, 8 + fx.t * 5, 0, 0, Math.PI * 2);
  c.stroke();
}

// ---------- signature animations for individual moves ----------
// Moves listed here get their own animation instead of the generic one for their type.

const P = (x: number, y: number) => ({x, y});
type Pt = {x: number; y: number};
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** 0 → 1 → 0 over the window [a, b] of t. */
const win = (t: number, a: number, b: number) => (t < a || t > b ? 0 : Math.sin(Math.PI * (t - a) / (b - a)));
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

function impact(c: Ctx, p: Pt, hit: number, size = 1, color = '#ffe680') {
  if (hit <= 0 || hit >= 1) return;
  c.globalAlpha = 1 - hit;
  star(c, p.x, p.y, (6 + hit * 10) * size, '#ffffff');
  star(c, p.x, p.y, (3 + hit * 6) * size, color);
  burst(c, p.x, p.y, hit, '#ffffff', 8, 16 * size);
  c.globalAlpha = 1;
}

function fist(c: Ctx, x: number, y: number, s: number, color = '#f3d2a8') {
  c.fillStyle = color;
  c.strokeStyle = '#5a3a28';
  c.lineWidth = 0.6;
  c.beginPath();
  c.roundRect(x - s, y - s * 0.8, s * 2, s * 1.6, s * 0.5);
  c.fill();
  c.stroke();
  c.beginPath(); // knuckles
  for (let k = -1; k <= 1; k++) {
    c.moveTo(x + k * s * 0.6, y - s * 0.8);
    c.lineTo(x + k * s * 0.6, y - s * 0.1);
  }
  c.stroke();
  c.beginPath(); // thumb
  c.ellipse(x - s * 0.9, y + s * 0.2, s * 0.35, s * 0.55, 0.4, 0, Math.PI * 2);
  c.fill();
  c.stroke();
}

function boot(c: Ctx, x: number, y: number, s: number) {
  c.fillStyle = '#c94a3a';
  c.strokeStyle = '#4a1d16';
  c.lineWidth = 0.6;
  c.beginPath();
  c.moveTo(x - s * 0.6, y - s * 1.3);
  c.lineTo(x + s * 0.4, y - s * 1.3);
  c.lineTo(x + s * 0.4, y - s * 0.1);
  c.quadraticCurveTo(x + s * 1.5, y, x + s * 1.4, y + s * 0.6);
  c.lineTo(x - s * 0.6, y + s * 0.6);
  c.closePath();
  c.fill();
  c.stroke();
  c.fillStyle = '#f2efe8';
  c.fillRect(x - s * 0.6, y + s * 0.35, s * 2, s * 0.25);
}

function claws(c: Ctx, p: Pt, t: number, color = '#ffffff', n = 3) {
  c.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const k = span(t, i * 0.08, i * 0.08 + 0.3);
    if (k <= 0) continue;
    const ox = (i - (n - 1) / 2) * 6;
    c.globalAlpha = t > 0.75 ? (1 - t) / 0.25 : 1;
    c.strokeStyle = color;
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(p.x - 10 + ox, p.y - 12);
    c.lineTo(p.x - 10 + ox + 18 * k, p.y - 12 + 24 * k);
    c.stroke();
    c.strokeStyle = 'rgba(255,80,80,0.6)';
    c.lineWidth = 0.6;
    c.stroke();
  }
  c.globalAlpha = 1;
}

function jaws(c: Ctx, p: Pt, t: number, fangs = 4, color = '#ffffff') {
  const close = span(t, 0.2, 0.6);
  const gap = 14 * (1 - close) + 1;
  c.globalAlpha = t > 0.8 ? (1 - t) / 0.2 : clamp01(t * 5);
  c.fillStyle = color;
  c.strokeStyle = '#555';
  c.lineWidth = 0.5;
  for (const dir of [-1, 1]) {
    const by = p.y + dir * gap;
    for (let i = 0; i < fangs; i++) {
      const fx0 = p.x - 12 + (i + 0.5) * (24 / fangs);
      c.beginPath();
      c.moveTo(fx0 - 3, by + dir * 4);
      c.lineTo(fx0 + 3, by + dir * 4);
      c.lineTo(fx0, by - dir * 3);
      c.closePath();
      c.fill();
      c.stroke();
    }
  }
  c.globalAlpha = 1;
  if (close >= 1) impact(c, p, span(t, 0.6, 1), 0.7);
}

function beam(c: Ctx, from: Pt, to: Pt, k: number, width: number, outer: string, inner: string, wobble = 0) {
  const x = lerp(from.x, to.x, k), y = lerp(from.y, to.y, k);
  c.lineCap = 'round';
  c.strokeStyle = outer;
  c.lineWidth = width + Math.sin(performance.now() / 30) * wobble;
  c.beginPath();
  c.moveTo(from.x, from.y);
  c.lineTo(x, y);
  c.stroke();
  c.strokeStyle = inner;
  c.lineWidth = width * 0.4;
  c.stroke();
}

function drain(c: Ctx, fx: Fx, color: string, inner = '#ffffff') {
  // Orbs pulled out of the target and flowing back to the user.
  impact(c, fx.to, span(fx.t, 0, 0.3), 0.6, color);
  for (let i = 0; i < 8; i++) {
    const k = span(fx.t, 0.2 + i * 0.05, 0.7 + i * 0.05);
    if (k <= 0 || k >= 1) continue;
    const e = ease(k);
    const x = lerp(fx.to.x, fx.from.x, e) + Math.sin(k * 9 + i) * 6;
    const y = lerp(fx.to.y, fx.from.y, e) - Math.sin(Math.PI * k) * 10;
    glowBall(c, x, y, 3, inner, color);
  }
  if (fx.t > 0.85) glowBall(c, fx.from.x, fx.from.y, 14 * win(fx.t, 0.85, 1), 'rgba(255,255,255,0.6)', 'rgba(255,255,255,0)');
}

function needles(c: Ctx, fx: Fx, n: number, color: string, len = 7) {
  const {go, hit} = phase(fx);
  c.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const tt = go - i * (0.5 / n);
    if (tt <= 0 || tt >= 1) continue;
    const p = travel(fx, tt), ang = Math.atan2(fx.to.y - fx.from.y, fx.to.x - fx.from.x);
    const oy = ((i % 3) - 1) * 3;
    c.strokeStyle = color;
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(p.x - Math.cos(ang) * len, p.y + oy - Math.sin(ang) * len);
    c.lineTo(p.x, p.y + oy);
    c.stroke();
  }
  if (hit) burst(c, fx.to.x, fx.to.y, hit, color, 8, 14);
}

function squeeze(c: Ctx, p: Pt, t: number, color: string, dark: string) {
  const k = ease(span(t, 0, 0.5));
  const r = 26 - 12 * k + Math.sin(t * 40) * (t > 0.5 ? 1 : 0);
  c.globalAlpha = t > 0.85 ? (1 - t) / 0.15 : 1;
  c.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    const y = p.y - 8 + i * 8;
    c.strokeStyle = dark;
    c.beginPath();
    c.ellipse(p.x, y, r, 4, 0, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = color;
    c.lineWidth = 1.6;
    c.stroke();
    c.lineWidth = 3;
  }
  c.globalAlpha = 1;
}

function tornado(c: Ctx, p: Pt, t: number, color: string) {
  c.lineWidth = 1;
  c.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const y = p.y + 14 - i * 5;
    const r = 4 + i * 2.5;
    c.globalAlpha = win(t, 0, 1) * 0.9;
    c.strokeStyle = color;
    c.beginPath();
    const a0 = t * 30 + i;
    c.ellipse(p.x + Math.sin(t * 10 + i) * 2, y, r, r * 0.3, 0, a0, a0 + 4);
    c.stroke();
  }
  c.globalAlpha = 1;
}

function soundWaves(c: Ctx, fx: Fx, color: string, sharp = false) {
  const ang = Math.atan2(fx.to.y - fx.from.y, fx.to.x - fx.from.x);
  const dist = Math.hypot(fx.to.x - fx.from.x, fx.to.y - fx.from.y);
  c.lineWidth = 1.3;
  c.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const k = (fx.t * 2 + i / 5) % 1;
    if (fx.t * 2 < i / 5) continue;
    const d = k * dist;
    c.globalAlpha = (1 - k) * win(fx.t, 0, 1);
    c.strokeStyle = color;
    c.beginPath();
    if (sharp) {
      const cx = fx.from.x + Math.cos(ang) * d, cy = fx.from.y + Math.sin(ang) * d;
      for (let s = -3; s <= 3; s++) {
        const a = ang + Math.PI / 2;
        c.lineTo(cx + Math.cos(a) * s * 3 + (s % 2 ? Math.cos(ang) * 2 : 0), cy + Math.sin(a) * s * 3 + (s % 2 ? Math.sin(ang) * 2 : 0));
      }
    } else {
      c.arc(fx.from.x, fx.from.y, d, ang - 0.5, ang + 0.5);
    }
    c.stroke();
  }
  c.globalAlpha = 1;
}

function note(c: Ctx, x: number, y: number, color: string) {
  c.fillStyle = color;
  c.strokeStyle = color;
  c.lineWidth = 0.8;
  c.beginPath();
  c.ellipse(x, y, 2, 1.5, -0.4, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.moveTo(x + 1.8, y);
  c.lineTo(x + 1.8, y - 7);
  c.quadraticCurveTo(x + 4, y - 5, x + 4.5, y - 3);
  c.stroke();
}

function heart(c: Ctx, x: number, y: number, s: number, color = '#ff5a8a') {
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(x, y + s);
  c.bezierCurveTo(x - s * 1.6, y - s * 0.2, x - s * 0.7, y - s * 1.4, x, y - s * 0.5);
  c.bezierCurveTo(x + s * 0.7, y - s * 1.4, x + s * 1.6, y - s * 0.2, x, y + s);
  c.fill();
}

function cloud(c: Ctx, p: Pt, t: number, rgb: string, size = 1) {
  for (let i = 0; i < 9; i++) {
    const a = rnd(i) * Math.PI * 2;
    const d = (6 + rnd(i, 1) * 10) * size * (0.4 + span(t, 0, 0.5) * 0.6);
    c.globalAlpha = 0.55 * win(t, 0, 1);
    glowBall(c, p.x + Math.cos(a + t * 2) * d, p.y + Math.sin(a + t * 2) * d * 0.6, (7 + rnd(i, 2) * 5) * size, `rgba(${rgb},0.9)`, `rgba(${rgb},0)`);
  }
  c.globalAlpha = 1;
}

function sparkles(c: Ctx, p: Pt, t: number, color: string, n = 8, r = 18) {
  for (let i = 0; i < n; i++) {
    const k = (t * 1.5 + rnd(i)) % 1;
    c.globalAlpha = Math.sin(Math.PI * k) * win(t, 0, 1);
    star(c, p.x + (rnd(i, 1) - 0.5) * r * 2, p.y + (rnd(i, 2) - 0.5) * r * 1.5 - k * 6, 1.5 + rnd(i, 3) * 1.5, color, 4);
  }
  c.globalAlpha = 1;
}

function wall(c: Ctx, fx: Fx, rgb: string) {
  // A see-through shield panel in front of the user.
  const p = fx.from, dir = fx.from.x < 80 ? 1 : -1;
  const k = win(fx.t, 0, 1);
  c.save();
  c.translate(p.x + dir * 16, p.y - 4);
  c.globalAlpha = k;
  c.fillStyle = `rgba(${rgb},0.3)`;
  c.strokeStyle = `rgba(${rgb},0.95)`;
  c.lineWidth = 1;
  c.beginPath();
  c.roundRect(-5, -18, 10, 34, 3);
  c.fill();
  c.stroke();
  c.globalAlpha = k * 0.8;
  c.strokeStyle = '#ffffff';
  const shine = ((fx.t * 2) % 1) * 40 - 20;
  c.beginPath();
  c.moveTo(-4, shine);
  c.lineTo(4, shine - 6);
  c.stroke();
  c.restore();
}

function aura(c: Ctx, p: Pt, t: number, rgb: string) {
  for (let i = 0; i < 10; i++) {
    const rise = (t * 1.8 + rnd(i)) % 1;
    const x = p.x + (rnd(i, 1) - 0.5) * 28;
    const y = p.y + 14 - rise * 34;
    c.globalAlpha = Math.sin(Math.PI * rise) * win(t, 0, 1);
    c.fillStyle = `rgb(${rgb})`;
    c.beginPath();
    c.moveTo(x, y - 6);
    c.quadraticCurveTo(x + 3, y, x, y + 3);
    c.quadraticCurveTo(x - 3, y, x, y - 6);
    c.fill();
  }
  c.globalAlpha = 0.35 * win(t, 0, 1);
  glowBall(c, p.x, p.y, 20, `rgba(${rgb},0.6)`, `rgba(${rgb},0)`);
  c.globalAlpha = 1;
}

function speedLines(c: Ctx, p: Pt, t: number, color = '#ffffff') {
  c.strokeStyle = color;
  c.lineWidth = 0.8;
  for (let i = 0; i < 8; i++) {
    const k = (t * 3 + rnd(i)) % 1;
    const y = p.y - 16 + rnd(i, 1) * 32;
    c.globalAlpha = Math.sin(Math.PI * k) * 0.9;
    c.beginPath();
    c.moveTo(p.x - 24 + k * 48, y);
    c.lineTo(p.x - 34 + k * 48, y);
    c.stroke();
  }
  c.globalAlpha = 1;
}

function fireball(c: Ctx, x: number, y: number, r: number, alpha = 1) {
  c.globalAlpha = alpha;
  glowBall(c, x, y, r, 'rgba(255,240,180,1)', 'rgba(255,120,20,0)');
  glowBall(c, x, y, r * 0.6, 'rgba(255,255,255,1)', 'rgba(255,220,120,0)');
  c.globalAlpha = 1;
}

function explosion(c: Ctx, p: Pt, t: number, scale = 1) {
  if (t < 0.15) { // the user glows, about to blow
    glowBall(c, p.x, p.y, 10 + t * 60, `rgba(255,255,255,${t / 0.15})`, 'rgba(255,255,255,0)');
    return;
  }
  const k = span(t, 0.15, 1);
  const R = (14 + 46 * ease(Math.min(1, k * 1.6))) * scale;
  const fade = k > 0.6 ? (1 - k) / 0.4 : 1;
  c.globalAlpha = fade;
  glowBall(c, p.x, p.y, R, 'rgba(255,90,30,0.9)', 'rgba(120,30,10,0)');
  glowBall(c, p.x, p.y, R * 0.75, 'rgba(255,190,60,1)', 'rgba(255,120,30,0)');
  glowBall(c, p.x, p.y, R * 0.45 * (1 - k * 0.6), 'rgba(255,255,240,1)', 'rgba(255,240,160,0)');
  for (let i = 0; i < 14; i++) { // flying debris
    const a = rnd(i) * Math.PI * 2;
    const d = R * (0.6 + rnd(i, 1) * 0.8);
    c.fillStyle = i % 2 ? '#ffcf4a' : '#5a3a28';
    c.beginPath();
    c.arc(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.7, 1 + rnd(i, 2) * 1.5, 0, Math.PI * 2);
    c.fill();
  }
  if (k > 0.4) cloud(c, {x: p.x, y: p.y - 6}, span(k, 0.4, 1) * 0.5, '90,80,80', 1.5 * scale);
  c.globalAlpha = 1;
}

function bone(c: Ctx, x: number, y: number, ang: number) {
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.fillStyle = '#f4efe0';
  c.strokeStyle = '#7d7563';
  c.lineWidth = 0.5;
  c.beginPath();
  c.rect(-6, -1.2, 12, 2.4);
  for (const sx of [-6, 6]) for (const sy of [-1.6, 1.6]) {
    c.moveTo(sx + 2, sy);
    c.arc(sx, sy, 2, 0, Math.PI * 2);
  }
  c.fill();
  c.stroke();
  c.restore();
}

function electricRing(c: Ctx, p: Pt, t: number) {
  c.strokeStyle = '#fff36a';
  c.lineWidth = 1.2;
  for (let r = 0; r < 2; r++) {
    c.globalAlpha = win(t, 0, 1);
    c.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const j = (rnd(i, Math.floor(t * 30) + r) - 0.5) * 5;
      c.lineTo(p.x + Math.cos(a) * (16 + j + r * 4), p.y + Math.sin(a) * (11 + j + r * 3));
    }
    c.stroke();
  }
  c.globalAlpha = 1;
}

function shimmer(c: Ctx, p: Pt, t: number) {
  for (let i = 0; i < 6; i++) {
    const r = ((t * 2 + i / 6) % 1) * 24;
    c.strokeStyle = `hsla(${(i * 60 + t * 360) % 360}, 90%, 70%, ${1 - r / 24})`;
    c.lineWidth = 1;
    c.beginPath();
    c.ellipse(p.x, p.y, r, r * 0.75, 0, 0, Math.PI * 2);
    c.stroke();
  }
}

const MOVE_FX: Record<string, (c: Ctx, fx: Fx) => void> = {};
const fam = (ids: string, fn: (c: Ctx, fx: Fx) => void) => { for (const id of ids.split(' ')) MOVE_FX[id] = fn; };

// --- Normal / physical contact ---
fam('explosion selfdestruct', (c, fx) => explosion(c, fx.from, fx.t, fx.move === 'explosion' ? 1.25 : 1));
fam('cometpunch megapunch dizzypunch firepunch icepunch thunderpunch', (c, fx) => {
  const k = span(fx.t, 0, 0.45);
  if (k < 1) { // the fist zooms in from the user
    const p = travel(fx, k);
    fist(c, p.x, p.y, 3 + k * 4);
  } else {
    const h = span(fx.t, 0.45, 1);
    c.globalAlpha = 1 - h;
    fist(c, fx.to.x, fx.to.y, 7 - h * 2);
    c.globalAlpha = 1;
    if (fx.move === 'firepunch' || fx.move === 'icepunch' || fx.move === 'thunderpunch') ATTACKS[fx.type](c, {...fx, t: 0.5 + h / 2});
    else impact(c, fx.to, h, fx.move === 'megapunch' ? 1.4 : 1);
    if (fx.move === 'dizzypunch') for (let i = 0; i < 3; i++) {
      const a = h * 8 + (i / 3) * Math.PI * 2;
      star(c, fx.to.x + Math.cos(a) * 12, fx.to.y - 16 + Math.sin(a) * 3, 2, '#ffe14a', 5);
    }
  }
});
fam('pound doubleslap', (c, fx) => {
  const h = span(fx.t, 0.2, 0.9);
  const sweep = fx.move === 'doubleslap' ? Math.sin(fx.t * Math.PI * 4) * 10 : (1 - h) * 10;
  c.globalAlpha = win(fx.t, 0, 1);
  c.fillStyle = '#f3d2a8';
  c.strokeStyle = '#5a3a28';
  c.lineWidth = 0.6;
  c.beginPath(); // open palm
  c.ellipse(fx.to.x + sweep, fx.to.y, 6, 7, 0.3, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  impact(c, fx.to, span(fx.t, 0.5, 1));
});
fam('doublekick jumpkick highjumpkick rollingkick lowkick megakick stomp', (c, fx) => {
  const k = span(fx.t, 0, 0.45);
  const from = fx.move === 'stomp' ? P(fx.to.x, fx.to.y - 40) : fx.move === 'highjumpkick' || fx.move === 'jumpkick' ? P(fx.to.x - 30, fx.to.y - 30) : fx.from;
  if (k < 1) {
    const e = ease(k);
    const big = fx.move === 'megakick' ? 6 : 4;
    c.save();
    c.translate(lerp(from.x, fx.to.x, e), lerp(from.y, fx.to.y, e));
    if (fx.move === 'rollingkick') c.rotate(k * 10);
    boot(c, 0, 0, 3 + k * big);
    c.restore();
  } else {
    const h = span(fx.t, 0.45, 1);
    impact(c, fx.to, h, fx.move === 'megakick' || fx.move === 'highjumpkick' ? 1.5 : 1, '#ffb070');
    if (fx.move === 'doublekick') impact(c, P(fx.to.x + 8, fx.to.y - 6), span(fx.t, 0.6, 1), 0.8, '#ffb070');
  }
});
fam('scratch slash furyswipes cut karatechop', (c, fx) => {
  claws(c, fx.to, span(fx.t, 0.15, 1), fx.move === 'karatechop' ? '#ffd27a' : '#ffffff', fx.move === 'cut' || fx.move === 'karatechop' ? 1 : 3);
  if (fx.move === 'furyswipes') claws(c, P(fx.to.x + 6, fx.to.y + 4), span(fx.t, 0.45, 1));
});
fam('crabhammer', (c, fx) => {
  claws(c, fx.to, span(fx.t, 0, 0.6), '#bfe3ff');
  if (fx.t > 0.5) ATTACKS.Water(c, fx);
});
fam('bite hyperfang superfang', (c, fx) => jaws(c, fx.to, fx.t, fx.move === 'bite' ? 4 : 2));
fam('guillotine visegrip', (c, fx) => {
  const close = ease(span(fx.t, 0.1, 0.55));
  c.fillStyle = '#c94a3a';
  c.strokeStyle = '#4a1d16';
  c.lineWidth = 0.6;
  c.globalAlpha = fx.t > 0.85 ? (1 - fx.t) / 0.15 : 1;
  for (const dir of [-1, 1]) { // two pincers snapping shut
    c.save();
    c.translate(fx.to.x + dir * (14 - close * 9), fx.to.y);
    c.scale(-dir, 1);
    c.beginPath();
    c.moveTo(0, -10);
    c.quadraticCurveTo(10, -6, 4, 0);
    c.quadraticCurveTo(10, 6, 0, 10);
    c.quadraticCurveTo(6, 0, 0, -10);
    c.fill();
    c.stroke();
    c.restore();
  }
  c.globalAlpha = 1;
  impact(c, fx.to, span(fx.t, 0.55, 1), fx.move === 'guillotine' ? 1.6 : 1);
});
fam('tackle bodyslam takedown doubleedge headbutt skullbash slam struggle rage strength thrash', (c, fx) => {
  const heavy = ['bodyslam', 'takedown', 'doubleedge', 'skullbash', 'slam', 'strength', 'thrash'].includes(fx.move ?? '');
  impact(c, fx.to, span(fx.t, 0.35, 1), heavy ? 1.5 : 1);
  if (heavy) impact(c, P(fx.to.x + 6, fx.to.y + 5), span(fx.t, 0.45, 1), 0.8, '#ff9a5a');
  if (fx.move === 'rage' && fx.t > 0.3) aura(c, fx.from, span(fx.t, 0.3, 1), '255,70,50');
});
fam('quickattack', (c, fx) => {
  if (fx.t < 0.45) {
    const p = travel(fx, span(fx.t, 0, 0.45));
    speedLines(c, p, fx.t);
    glowBall(c, p.x, p.y, 6, 'rgba(255,255,255,0.9)', 'rgba(255,255,255,0)');
  }
  impact(c, fx.to, span(fx.t, 0.45, 1));
});
fam('hornattack furyattack horndrill', (c, fx) => {
  const k = span(fx.t, 0, 0.5);
  const ang = Math.atan2(fx.to.y - fx.from.y, fx.to.x - fx.from.x);
  if (k < 1) {
    const p = travel(fx, k);
    c.save();
    c.translate(p.x, p.y);
    c.rotate(ang);
    c.fillStyle = '#efe6cf';
    c.strokeStyle = '#7d7563';
    c.lineWidth = 0.5;
    c.beginPath();
    c.moveTo(6, 0);
    c.lineTo(-4, -3);
    c.lineTo(-4, 3);
    c.closePath();
    c.fill();
    c.stroke();
    if (fx.move === 'horndrill') { // drill grooves spinning
      c.strokeStyle = '#7d7563';
      for (let i = 0; i < 3; i++) {
        const gx = 4 - ((i * 3 + fx.t * 60) % 9);
        c.beginPath();
        c.moveTo(gx, -3 * (6 - gx) / 10);
        c.lineTo(gx - 2, 3 * (6 - gx) / 10);
        c.stroke();
      }
    }
    c.restore();
  } else {
    const h = span(fx.t, 0.5, 1);
    impact(c, fx.to, h, fx.move === 'horndrill' ? 2 : 1);
    if (fx.move === 'furyattack') impact(c, P(fx.to.x - 6, fx.to.y + 6), span(fx.t, 0.6, 1), 0.7);
  }
});
fam('spikecannon pinmissile twineedle poisonsting', (c, fx) =>
  needles(c, fx, fx.move === 'twineedle' ? 2 : fx.move === 'poisonsting' ? 1 : 5,
    fx.move === 'poisonsting' ? '#c56be8' : fx.move === 'spikecannon' ? '#e6e0d0' : '#c8e24a', 7));
fam('peck drillpeck', (c, fx) => {
  for (let i = 0; i < (fx.move === 'drillpeck' ? 4 : 2); i++)
    impact(c, P(fx.to.x + (rnd(i) - 0.5) * 14, fx.to.y + (rnd(i, 1) - 0.5) * 12), span(fx.t, 0.15 + i * 0.15, 0.55 + i * 0.15), 0.6, '#ffcf6a');
  if (fx.move === 'drillpeck') tornado(c, fx.to, fx.t, 'rgba(255,255,255,0.8)');
});
fam('swift', (c, fx) => {
  for (let i = 0; i < 5; i++) {
    const k = span(fx.t, i * 0.08, 0.5 + i * 0.08);
    if (k <= 0 || k >= 1) continue;
    const p = travel(fx, k, 6 + i * 4);
    c.save();
    c.translate(p.x, p.y + (i - 2) * 3);
    c.rotate(fx.t * 14);
    star(c, 0, 0, 4, '#fff27a', 5);
    c.restore();
  }
  impact(c, fx.to, span(fx.t, 0.55, 1), 1, '#fff27a');
});
fam('eggbomb barrage', (c, fx) => {
  const n = fx.move === 'barrage' ? 3 : 1;
  for (let i = 0; i < n; i++) {
    const k = span(fx.t, i * 0.12, 0.5 + i * 0.12);
    if (k > 0 && k < 1) {
      const p = travel(fx, k, 22);
      c.fillStyle = fx.move === 'barrage' ? '#f1b54a' : '#fff8e8';
      c.strokeStyle = '#8b7a55';
      c.lineWidth = 0.5;
      c.beginPath();
      c.ellipse(p.x, p.y, fx.move === 'barrage' ? 3 : 3.5, fx.move === 'barrage' ? 3 : 4.5, k * 8, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
  }
  const h = span(fx.t, 0.5, 1);
  if (h > 0) explosion(c, fx.to, 0.15 + h * 0.85, fx.move === 'eggbomb' ? 0.5 : 0.3);
});
fam('payday', (c, fx) => {
  for (let i = 0; i < 7; i++) {
    const k = span(fx.t, i * 0.05, 0.6 + i * 0.05);
    if (k <= 0 || k >= 1) continue;
    const p = travel(fx, k, 16 + rnd(i) * 10);
    c.fillStyle = '#ffd23a';
    c.strokeStyle = '#a07a10';
    c.lineWidth = 0.5;
    c.beginPath();
    c.ellipse(p.x + (i - 3) * 2, p.y, 2.5 * Math.abs(Math.cos(fx.t * 20 + i)) + 0.4, 2.5, 0, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }
  impact(c, fx.to, span(fx.t, 0.6, 1), 0.8, '#ffd23a');
});
fam('triattack', (c, fx) => {
  const cols = [['255,110,40', '#fff1b0'], ['120,220,255', '#f0fbff'], ['255,230,60', '#ffffff']];
  const k = span(fx.t, 0, 0.6);
  const spin = fx.t * 8;
  cols.forEach(([rgb, inner], i) => {
    const a = spin + (i / 3) * Math.PI * 2;
    const r = 14 * (1 - k);
    const base = travel(fx, k);
    glowBall(c, base.x + Math.cos(a) * r, base.y + Math.sin(a) * r, 4, inner, `rgba(${rgb},0)`);
  });
  if (fx.t > 0.6) {
    const h = span(fx.t, 0.6, 1);
    impact(c, fx.to, h, 1.2, '#ff8a3a');
  }
});
fam('sonicboom', (c, fx) => {
  const k = span(fx.t, 0, 0.6);
  const ang = Math.atan2(fx.to.y - fx.from.y, fx.to.x - fx.from.x);
  for (let i = 0; i < 3; i++) {
    const kk = k - i * 0.1;
    if (kk <= 0 || kk >= 1) continue;
    const p = travel(fx, kk);
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(p.x - Math.cos(ang) * 6, p.y - Math.sin(ang) * 6, 8, ang - 1, ang + 1);
    c.stroke();
  }
  impact(c, fx.to, span(fx.t, 0.6, 1), 1, '#e0e8ff');
});
fam('wrap bind constrict', (c, fx) => squeeze(c, fx.to, fx.t, fx.move === 'constrict' ? '#a07ad8' : '#e3c26a', '#5a4220'));
fam('clamp', (c, fx) => { jaws(c, fx.to, fx.t, 5, '#c7b8e8'); squeeze(c, fx.to, span(fx.t, 0.5, 1), '#9fd0ff', '#2a4a7a'); });
fam('gust razorwind whirlwind', (c, fx) => {
  if (fx.move === 'razorwind') {
    for (let i = 0; i < 3; i++) {
      const k = span(fx.t, i * 0.1, 0.5 + i * 0.1);
      if (k <= 0 || k >= 1) continue;
      const p = travel(fx, k);
      c.strokeStyle = '#ffffff';
      c.lineWidth = 1.4;
      c.beginPath();
      c.arc(p.x, p.y + (i - 1) * 6, 6, -2, 0.6);
      c.stroke();
    }
    impact(c, fx.to, span(fx.t, 0.5, 1), 1.2, '#dff0ff');
    return;
  }
  tornado(c, fx.to, fx.t, 'rgba(255,255,255,0.9)');
  tornado(c, P(fx.to.x + 2, fx.to.y + 2), fx.t + 0.2, 'rgba(200,225,255,0.8)');
});
fam('hyperbeam', (c, fx) => {
  if (fx.t < 0.3) {
    const k = fx.t / 0.3;
    for (let i = 0; i < 8; i++) { // energy gathers at the user
      const a = (i / 8) * Math.PI * 2 + k * 3;
      const d = 22 * (1 - k);
      glowBall(c, fx.from.x + Math.cos(a) * d, fx.from.y + Math.sin(a) * d, 2.5, '#ffffff', 'rgba(255,170,60,0)');
    }
    glowBall(c, fx.from.x, fx.from.y, 4 + k * 6, '#ffffff', 'rgba(255,170,60,0)');
    return;
  }
  const k = span(fx.t, 0.3, 0.45);
  const fade = fx.t > 0.85 ? (1 - fx.t) / 0.15 : 1;
  c.globalAlpha = fade;
  beam(c, fx.from, fx.to, k, 10, 'rgba(255,140,40,0.85)', '#fff7d6', 2);
  if (k >= 1) glowBall(c, fx.to.x, fx.to.y, 16 + Math.sin(fx.t * 60) * 3, 'rgba(255,255,230,1)', 'rgba(255,140,40,0)');
  c.globalAlpha = 1;
});
fam('bide counter', (c, fx) => {
  aura(c, fx.from, span(fx.t, 0, 0.5) * 0.99, '255,90,60');
  if (fx.t > 0.4) {
    beam(c, fx.from, fx.to, span(fx.t, 0.4, 0.55), 6, 'rgba(255,90,60,0.8)', '#fff0e0');
    impact(c, fx.to, span(fx.t, 0.55, 1), 1.5, '#ff7a4a');
  }
});
fam('seismictoss submission', (c, fx) => {
  // The target is flung round in a big loop, then slammed into the ground.
  const k = span(fx.t, 0, 0.65);
  if (k < 1) {
    const a = k * Math.PI * 2 * (fx.move === 'submission' ? 2 : 1);
    const p = P(fx.to.x + Math.sin(a) * 18, fx.to.y - 10 - Math.cos(a) * -12 - 8);
    c.strokeStyle = 'rgba(255,255,255,0.7)';
    c.lineWidth = 2;
    c.beginPath();
    c.ellipse(fx.to.x, fx.to.y - 18, 18, 12, 0, a - 1.2, a);
    c.stroke();
    glowBall(c, p.x, p.y, 4, '#ffffff', 'rgba(255,200,120,0)');
  } else impact(c, P(fx.to.x, fx.to.y + 10), span(fx.t, 0.65, 1), 1.8, '#ffb070');
});
fam('lick', (c, fx) => {
  const k = win(fx.t, 0, 1);
  c.strokeStyle = '#ff7aa8';
  c.lineWidth = 4;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(fx.to.x - 10, fx.to.y + 6);
  c.quadraticCurveTo(fx.to.x, fx.to.y + 6 - k * 22, fx.to.x + 4 * k, fx.to.y - 10 * k);
  c.stroke();
  if (fx.t > 0.5) ATTACKS.Ghost(c, fx);
});
fam('nightshade', (c, fx) => {
  for (let i = 0; i < 4; i++) {
    const r = ((fx.t * 1.5 + i / 4) % 1) * 30;
    c.strokeStyle = `rgba(40,10,60,${(1 - r / 30) * 0.9})`;
    c.lineWidth = 3;
    c.beginPath();
    c.ellipse(fx.to.x, fx.to.y, r, r * 0.7, 0, 0, Math.PI * 2);
    c.stroke();
  }
  glowBall(c, fx.to.x, fx.to.y, 14 * win(fx.t, 0.3, 1), 'rgba(120,40,160,0.7)', 'rgba(20,0,40,0)');
});
fam('confuseray', (c, fx) => {
  const k = span(fx.t, 0, 0.6);
  const p = travel(fx, k, 10);
  const wob = Math.sin(fx.t * 30) * 3;
  glowBall(c, p.x + wob, p.y, 5, '#fffbd0', 'rgba(255,220,60,0)');
  if (fx.t > 0.6) for (let i = 0; i < 3; i++) {
    const a = fx.t * 12 + (i / 3) * Math.PI * 2;
    star(c, fx.to.x + Math.cos(a) * 12, fx.to.y - 16 + Math.sin(a) * 3, 2, '#ffe14a', 5);
  }
});

// --- Fire ---
fam('fireblast', (c, fx) => {
  const k = span(fx.t, 0, 0.45);
  if (k < 1) { const p = travel(fx, k, 6); fireball(c, p.x, p.y, 6 + k * 4); return; }
  const h = span(fx.t, 0.45, 1);
  const fade = h > 0.7 ? (1 - h) / 0.3 : 1;
  for (let arm = 0; arm < 5; arm++) { // the famous 大-shaped blast
    const a = [-Math.PI / 2, -0.25, Math.PI + 0.25, 1.1, Math.PI - 1.1][arm];
    for (let s = 0; s < 6; s++) {
      const d = s * 4 * Math.min(1, h * 3);
      fireball(c, fx.to.x + Math.cos(a) * d, fx.to.y + Math.sin(a) * d, 5 - s * 0.4, fade);
    }
  }
});
fam('flamethrower', (c, fx) => {
  const len = span(fx.t, 0, 0.4);
  const fade = fx.t > 0.8 ? (1 - fx.t) / 0.2 : 1;
  for (let i = 0; i < 16; i++) {
    const k = ((i / 16) + fx.t * 3) % 1 * len;
    const p = travel(fx, k);
    const j = Math.sin(fx.t * 40 + i) * 2 * k;
    fireball(c, p.x, p.y + j, 2 + k * 5, fade * 0.85);
  }
  if (fx.t > 0.45) ATTACKS.Fire(c, {...fx, t: 0.5 + span(fx.t, 0.45, 1) / 2});
});
fam('firespin', (c, fx) => {
  for (let i = 0; i < 12; i++) {
    const a = fx.t * 14 + (i / 12) * Math.PI * 2;
    const y = fx.to.y + 10 - ((i / 12 + fx.t) % 1) * 26;
    fireball(c, fx.to.x + Math.cos(a) * 16, y + Math.sin(a) * 4, 3.5, win(fx.t, 0, 1));
  }
});
fam('dragonrage', (c, fx) => {
  const k = span(fx.t, 0, 0.45);
  if (k < 1) { const p = travel(fx, k, 8); glowBall(c, p.x, p.y, 7, '#e8f0ff', 'rgba(90,80,255,0)'); return; }
  const h = span(fx.t, 0.45, 1);
  for (let i = 0; i < 10; i++) {
    const rise = (h * 1.6 + rnd(i, 2)) % 1;
    c.globalAlpha = 1 - h;
    glowBall(c, fx.to.x + (rnd(i) - 0.5) * 28, fx.to.y + 12 - rise * 30, 6 * (1 - rise) + 2, '#c8d8ff', 'rgba(80,60,255,0)');
  }
  c.globalAlpha = 1;
});

// --- Water ---
fam('hydropump', (c, fx) => {
  const k = span(fx.t, 0, 0.35);
  const fade = fx.t > 0.8 ? (1 - fx.t) / 0.2 : 1;
  c.globalAlpha = fade;
  beam(c, fx.from, fx.to, k, 9, 'rgba(70,140,240,0.85)', 'rgba(230,248,255,0.95)', 1.5);
  c.globalAlpha = 1;
  if (k >= 1) ATTACKS.Water(c, {...fx, t: 0.5 + span(fx.t, 0.35, 1) / 2});
});
fam('surf', (c, fx) => {
  // A wave rises behind the user and sweeps across the whole field.
  const k = ease(span(fx.t, 0, 0.85));
  const dir = fx.from.x < 80 ? 1 : -1;
  const front = dir > 0 ? -40 + k * 240 : 200 - k * 240;
  c.globalAlpha = fx.t > 0.85 ? (1 - fx.t) / 0.15 : 0.85;
  c.fillStyle = 'rgba(70,140,230,0.8)';
  c.beginPath();
  c.moveTo(front, 96);
  for (let i = 0; i <= 12; i++) {
    const x = front - dir * i * 10;
    c.lineTo(x, 40 + Math.sin(i * 0.9 + fx.t * 20) * 4 + i * 2);
  }
  c.lineTo(front - dir * 200, 96);
  c.closePath();
  c.fill();
  c.strokeStyle = '#f2fbff';
  c.lineWidth = 2;
  c.beginPath();
  for (let i = 0; i <= 12; i++) c.lineTo(front - dir * i * 10, 40 + Math.sin(i * 0.9 + fx.t * 20) * 4 + i * 2);
  c.stroke();
  c.globalAlpha = 1;
});
fam('waterfall', (c, fx) => {
  const k = span(fx.t, 0, 0.5);
  const fade = fx.t > 0.8 ? (1 - fx.t) / 0.2 : 1;
  c.globalAlpha = fade;
  const grad = c.createLinearGradient(0, 0, 0, fx.to.y);
  grad.addColorStop(0, 'rgba(120,190,255,0.3)');
  grad.addColorStop(1, 'rgba(220,245,255,0.95)');
  c.fillStyle = grad;
  c.fillRect(fx.to.x - 9, 0, 18, fx.to.y * k);
  c.globalAlpha = 1;
  if (k >= 1) ATTACKS.Water(c, {...fx, t: 0.5 + span(fx.t, 0.5, 1) / 2});
});
fam('bubble bubblebeam', (c, fx) => {
  const n = fx.move === 'bubblebeam' ? 12 : 6;
  for (let i = 0; i < n; i++) {
    const k = span(fx.t, i * (0.4 / n), 0.55 + i * (0.4 / n));
    if (k <= 0 || k >= 1) continue;
    const p = travel(fx, k, 4);
    const r = 2 + rnd(i) * 2;
    c.strokeStyle = 'rgba(200,235,255,0.95)';
    c.fillStyle = 'rgba(120,190,255,0.3)';
    c.lineWidth = 0.7;
    c.beginPath();
    c.arc(p.x + Math.sin(k * 10 + i) * 3, p.y + (rnd(i, 1) - 0.5) * 8, r, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }
  impact(c, fx.to, span(fx.t, 0.65, 1), 0.8, '#bfe3ff');
});

// --- Electric ---
fam('thunder', (c, fx) => {
  if (fx.t < 0.25) { cloud(c, P(fx.to.x, 8), fx.t * 2, '60,60,80', 1.2); return; }
  cloud(c, P(fx.to.x, 8), 0.5, '60,60,80', 1.2);
  if (Math.floor(fx.t * 30) % 3 === 2) return;
  for (const w of [5, 2]) {
    c.strokeStyle = w > 3 ? 'rgba(255,240,90,0.9)' : '#ffffff';
    c.lineWidth = w;
    c.lineJoin = 'round';
    c.beginPath();
    let x = fx.to.x, y = 4;
    c.moveTo(x, y);
    for (let s = 0; s < 7; s++) {
      x = fx.to.x + (rnd(s, Math.floor(fx.t * 12)) - 0.5) * 16;
      y += (fx.to.y - 4) / 7;
      c.lineTo(x, y);
    }
    c.stroke();
  }
  glowBall(c, fx.to.x, fx.to.y, 16, 'rgba(255,255,220,0.9)', 'rgba(255,230,60,0)');
});

// --- Ice ---
fam('icebeam aurorabeam', (c, fx) => {
  const k = span(fx.t, 0, 0.4);
  const fade = fx.t > 0.85 ? (1 - fx.t) / 0.15 : 1;
  c.globalAlpha = fade;
  if (fx.move === 'aurorabeam') {
    ['rgba(255,120,180,0.8)', 'rgba(120,255,180,0.8)', 'rgba(120,180,255,0.8)'].forEach((col, i) => {
      const off = (i - 1) * 2.5;
      beam(c, P(fx.from.x, fx.from.y + off), P(fx.to.x, fx.to.y + off), k, 3, col, 'rgba(255,255,255,0.6)');
    });
  } else beam(c, fx.from, fx.to, k, 5, 'rgba(140,220,255,0.85)', '#ffffff');
  c.globalAlpha = 1;
  if (k >= 1) ATTACKS.Ice(c, {...fx, t: 0.5 + span(fx.t, 0.4, 1) / 2});
});
fam('blizzard', (c, fx) => {
  const dir = fx.from.x < 80 ? 1 : -1;
  for (let i = 0; i < 40; i++) {
    const k = (fx.t * 1.6 + rnd(i)) % 1;
    const x = dir > 0 ? -10 + k * 180 : 170 - k * 180;
    const y = rnd(i, 1) * 96 + Math.sin(k * 10 + i) * 4 - (dir > 0 ? k * 20 : -k * 20);
    c.globalAlpha = win(fx.t, 0, 1) * 0.95;
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.arc(x, y, 0.8 + rnd(i, 2) * 1.4, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
  if (fx.t > 0.5) ATTACKS.Ice(c, fx);
});
fam('haze mist', (c, fx) => {
  for (let i = 0; i < 6; i++) {
    const x = ((rnd(i) * 200 + fx.t * 60 * (i % 2 ? 1 : -1)) % 200) - 20;
    c.globalAlpha = 0.5 * win(fx.t, 0, 1);
    glowBall(c, x, 20 + rnd(i, 1) * 60, 26, fx.move === 'mist' ? 'rgba(220,245,255,0.9)' : 'rgba(150,150,170,0.9)', 'rgba(200,200,220,0)');
  }
  c.globalAlpha = 1;
});

// --- Ground / Rock ---
fam('earthquake fissure', (c, fx) => {
  const base = fx.to.y + 14;
  const k = span(fx.t, 0.1, 0.5);
  c.strokeStyle = '#3a2a1a';
  c.lineWidth = fx.move === 'fissure' ? 2.5 : 1.5;
  c.globalAlpha = fx.t > 0.85 ? (1 - fx.t) / 0.15 : 1;
  c.beginPath(); // a crack racing across the ground
  const len = (fx.move === 'fissure' ? 30 : 60) * k;
  for (let i = 0; i <= 12; i++) {
    const x = fx.to.x - len + (i / 12) * len * 2;
    c.lineTo(x, base + (rnd(i, 3) - 0.5) * 4);
  }
  c.stroke();
  if (fx.move === 'fissure' && k > 0.5) {
    c.fillStyle = '#1a120a';
    c.beginPath();
    c.ellipse(fx.to.x, base, 22 * span(fx.t, 0.3, 0.6), 4, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
  ATTACKS.Ground(c, fx);
});
fam('dig', (c, fx) => {
  if (fx.t < 0.4) { // dirt flying up where the user digs
    const p = P(fx.from.x, fx.from.y + 14);
    for (let i = 0; i < 6; i++) {
      const k = (fx.t * 4 + rnd(i)) % 1;
      c.fillStyle = '#9b7646';
      c.beginPath();
      c.arc(p.x + (rnd(i, 1) - 0.5) * 20, p.y - Math.sin(Math.PI * k) * 14, 1.6, 0, Math.PI * 2);
      c.fill();
    }
    return;
  }
  ATTACKS.Ground(c, fx);
  impact(c, fx.to, span(fx.t, 0.5, 1), 1.2, '#d8bb86');
});
fam('bonemerang boneclub', (c, fx) => {
  const k = span(fx.t, 0, 0.6);
  const out = fx.move === 'bonemerang' ? Math.sin(Math.PI * k) : Math.min(1, k * 1.6);
  const p = P(lerp(fx.from.x, fx.to.x, out), lerp(fx.from.y, fx.to.y, out) - Math.sin(Math.PI * k) * 14);
  if (fx.t < 0.85) bone(c, p.x, p.y, fx.t * 30);
  impact(c, fx.to, span(fx.t, 0.3, 0.75), 1);
});
fam('sandattack', (c, fx) => {
  for (let i = 0; i < 18; i++) {
    const k = span(fx.t, rnd(i) * 0.3, 0.6 + rnd(i) * 0.3);
    if (k <= 0 || k >= 1) continue;
    const p = travel(fx, k, 8 + rnd(i, 1) * 12);
    c.fillStyle = i % 2 ? '#d8bb86' : '#b8955a';
    c.fillRect(p.x + (rnd(i, 2) - 0.5) * 10, p.y + (rnd(i, 3) - 0.5) * 10, 1.4, 1.4);
  }
});

// --- Grass / Bug / Poison ---
fam('absorb megadrain leechlife dreameater', (c, fx) =>
  drain(c, fx, fx.move === 'dreameater' ? 'rgba(255,110,190,0.5)' : fx.move === 'leechlife' ? 'rgba(200,60,60,0.5)' : 'rgba(110,220,80,0.5)'));
fam('vinewhip', (c, fx) => {
  for (let v = 0; v < 2; v++) {
    const k = win(fx.t, 0.05 + v * 0.15, 0.75 + v * 0.15);
    if (k <= 0) continue;
    c.strokeStyle = '#3f9a2f';
    c.lineWidth = 1.6;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(fx.from.x, fx.from.y);
    const tip = travel(fx, k);
    c.quadraticCurveTo((fx.from.x + tip.x) / 2, Math.min(fx.from.y, tip.y) - 20 + v * 30, tip.x, tip.y + (v - 0.5) * 10);
    c.stroke();
  }
  impact(c, fx.to, span(fx.t, 0.45, 0.9), 0.8, '#9fe07a');
});
fam('petaldance', (c, fx) => {
  for (let i = 0; i < 14; i++) {
    const a = fx.t * 10 + (i / 14) * Math.PI * 2;
    const r = 8 + (i % 3) * 5;
    c.save();
    c.globalAlpha = win(fx.t, 0, 1);
    c.translate(fx.to.x + Math.cos(a) * r, fx.to.y + Math.sin(a) * r * 0.6 - 4);
    c.rotate(a * 2);
    c.fillStyle = i % 2 ? '#ff9ec6' : '#ffd0e4';
    c.beginPath();
    c.ellipse(0, 0, 2.6, 1.4, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
});
fam('solarbeam', (c, fx) => {
  if (fx.t < 0.35) { // sunlight gathering
    const k = fx.t / 0.35;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const d = 28 * (1 - ((k * 2 + rnd(i)) % 1));
      glowBall(c, fx.from.x + Math.cos(a) * d, fx.from.y + Math.sin(a) * d, 2, '#fffbd0', 'rgba(255,240,120,0)');
    }
    glowBall(c, fx.from.x, fx.from.y, 4 + k * 8, '#ffffff', 'rgba(255,250,150,0)');
    return;
  }
  const k = span(fx.t, 0.35, 0.5);
  c.globalAlpha = fx.t > 0.85 ? (1 - fx.t) / 0.15 : 1;
  beam(c, fx.from, fx.to, k, 11, 'rgba(255,245,140,0.85)', '#ffffff', 2);
  if (k >= 1) glowBall(c, fx.to.x, fx.to.y, 18, 'rgba(255,255,230,1)', 'rgba(170,255,120,0)');
  c.globalAlpha = 1;
});
fam('leechseed', (c, fx) => {
  for (let i = 0; i < 3; i++) {
    const k = span(fx.t, i * 0.08, 0.45 + i * 0.08);
    const p = k < 1 ? travel(fx, k, 20) : P(fx.to.x + (i - 1) * 8, fx.to.y + 6);
    c.fillStyle = '#8a6a3a';
    c.beginPath();
    c.ellipse(p.x, p.y, 2, 2.6, 0, 0, Math.PI * 2);
    c.fill();
  }
  if (fx.t > 0.55) { // vines sprout and wrap
    const h = span(fx.t, 0.55, 1);
    c.strokeStyle = '#3f9a2f';
    c.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      for (let s = 0; s <= 10 * h; s++) c.lineTo(fx.to.x + (i - 1) * 8 + Math.sin(s * 1.2 + i) * 4, fx.to.y + 6 - s * 2);
      c.stroke();
    }
  }
});
fam('stringshot', (c, fx) => {
  c.strokeStyle = 'rgba(255,255,255,0.9)';
  c.lineWidth = 0.6;
  for (let i = 0; i < 6; i++) {
    const k = span(fx.t, i * 0.05, 0.5 + i * 0.05);
    const p = travel(fx, k, 6);
    c.beginPath();
    c.moveTo(fx.from.x, fx.from.y);
    c.quadraticCurveTo((fx.from.x + p.x) / 2, (fx.from.y + p.y) / 2 + (i - 3) * 4, p.x + (i - 3) * 3, p.y + (i - 3) * 2);
    c.stroke();
  }
  if (fx.t > 0.5) squeeze(c, fx.to, span(fx.t, 0.5, 1), '#ffffff', 'rgba(200,200,200,0.6)');
});
fam('acid sludge', (c, fx) => {
  for (let i = 0; i < 5; i++) {
    const k = span(fx.t, i * 0.06, 0.5 + i * 0.06);
    if (k <= 0 || k >= 1) continue;
    const p = travel(fx, k, 16);
    c.fillStyle = fx.move === 'acid' ? '#b8e23a' : '#9d43a0';
    c.beginPath();
    c.ellipse(p.x, p.y, 3, 3.6, 0, 0, Math.PI * 2);
    c.fill();
  }
  if (fx.t > 0.5) ATTACKS.Poison(c, fx);
});
fam('smog poisongas smokescreen', (c, fx) => {
  const rgb = fx.move === 'smokescreen' ? '40,40,45' : fx.move === 'smog' ? '120,90,140' : '170,90,200';
  const k = span(fx.t, 0, 0.4);
  if (k < 1) { const p = travel(fx, k); cloud(c, p, 0.5, rgb, 0.5); }
  else cloud(c, fx.to, span(fx.t, 0.4, 1), rgb, 1.2);
});
fam('toxic', (c, fx) => {
  ATTACKS.Poison(c, {...fx, t: Math.min(1, fx.t * 1.4)});
  for (let i = 0; i < 8; i++) {
    const rise = (fx.t * 2 + rnd(i)) % 1;
    c.globalAlpha = (1 - rise) * win(fx.t, 0, 1);
    c.strokeStyle = '#d68cf0';
    c.lineWidth = 0.8;
    c.beginPath();
    c.arc(fx.to.x + (rnd(i, 2) - 0.5) * 26, fx.to.y + 10 - rise * 28, 2 + rnd(i, 3) * 2, 0, Math.PI * 2);
    c.stroke();
  }
  c.globalAlpha = 1;
});

// --- Flying ---
fam('fly skyattack', (c, fx) => {
  // A dive out of the sky onto the target, trailing light.
  const k = span(fx.t, 0, 0.5);
  const start = P(fx.to.x - 40, -10);
  const p = P(lerp(start.x, fx.to.x, ease(k)), lerp(start.y, fx.to.y, ease(k)));
  c.strokeStyle = fx.move === 'skyattack' ? 'rgba(255,220,120,0.9)' : 'rgba(255,255,255,0.85)';
  c.lineWidth = fx.move === 'skyattack' ? 5 : 3;
  c.lineCap = 'round';
  if (k < 1) {
    c.beginPath();
    c.moveTo(start.x, start.y);
    c.lineTo(p.x, p.y);
    c.stroke();
    glowBall(c, p.x, p.y, fx.move === 'skyattack' ? 8 : 5, '#ffffff', 'rgba(255,220,120,0)');
  }
  impact(c, fx.to, span(fx.t, 0.5, 1), fx.move === 'skyattack' ? 1.8 : 1.2);
});
fam('wingattack', (c, fx) => {
  for (const dir of [-1, 1]) {
    const k = span(fx.t, 0.1, 0.6);
    c.strokeStyle = '#ffffff';
    c.lineWidth = 2;
    c.globalAlpha = win(fx.t, 0, 1);
    c.beginPath();
    c.arc(fx.to.x + dir * (14 - k * 10), fx.to.y, 10, dir > 0 ? Math.PI * 0.6 : -Math.PI * 0.4, dir > 0 ? Math.PI * 1.4 : Math.PI * 0.4);
    c.stroke();
  }
  c.globalAlpha = 1;
  impact(c, fx.to, span(fx.t, 0.55, 1));
  ATTACKS.Flying(c, fx);
});

// --- Psychic ---
fam('psybeam', (c, fx) => {
  for (let i = 0; i < 6; i++) {
    const k = span(fx.t, i * 0.06, 0.45 + i * 0.06);
    if (k <= 0 || k >= 1) continue;
    const p = travel(fx, k);
    c.strokeStyle = `hsla(${(i * 50 + fx.t * 600) % 360}, 90%, 70%, 0.9)`;
    c.lineWidth = 1.4;
    c.beginPath();
    c.ellipse(p.x, p.y, 3, 6, Math.atan2(fx.to.y - fx.from.y, fx.to.x - fx.from.x), 0, Math.PI * 2);
    c.stroke();
  }
  if (fx.t > 0.5) ATTACKS.Psychic(c, fx);
});

// --- Status moves aimed at the target ---
fam('sing', (c, fx) => {
  for (let i = 0; i < 5; i++) {
    const k = span(fx.t, i * 0.1, 0.6 + i * 0.1);
    if (k <= 0 || k >= 1) continue;
    const p = travel(fx, k, 10);
    c.globalAlpha = Math.sin(Math.PI * k) + 0.3;
    note(c, p.x + Math.sin(k * 12 + i) * 4, p.y + (i - 2) * 3, ['#ff6b9a', '#6bb6ff', '#ffd23a'][i % 3]);
  }
  c.globalAlpha = 1;
});
fam('growl roar screech supersonic', (c, fx) => {
  const col = {growl: '#ffffff', roar: '#ffd27a', screech: '#ff8a8a', supersonic: '#bfe3ff'}[fx.move as 'growl'] ?? '#ffffff';
  soundWaves(c, fx, col, fx.move === 'screech');
});
fam('lovelykiss', (c, fx) => {
  const k = span(fx.t, 0, 0.6);
  const p = travel(fx, k, 12);
  heart(c, p.x, p.y, 3 + k * 3);
  if (fx.t > 0.6) for (let i = 0; i < 4; i++) {
    const rise = span(fx.t, 0.6, 1);
    c.globalAlpha = 1 - rise;
    heart(c, fx.to.x + (i - 1.5) * 8, fx.to.y - rise * 18, 2);
  }
  c.globalAlpha = 1;
});
fam('hypnosis kinesis', (c, fx) => {
  const k = win(fx.t, 0, 1);
  c.strokeStyle = fx.move === 'kinesis' ? 'rgba(200,200,220,0.9)' : 'rgba(255,120,220,0.9)';
  c.lineWidth = 1;
  c.globalAlpha = k;
  c.beginPath();
  for (let s = 0; s < 60; s++) { // a hypnotic spiral
    const a = s * 0.35 + fx.t * 12;
    const r = s * 0.35;
    c.lineTo(fx.to.x + Math.cos(a) * r, fx.to.y + Math.sin(a) * r * 0.75);
  }
  c.stroke();
  c.globalAlpha = 1;
});
fam('glare leer', (c, fx) => {
  const k = win(fx.t, 0, 1);
  const at = fx.move === 'leer' ? fx.from : fx.to;
  for (const dx of [-5, 5]) {
    c.globalAlpha = k;
    c.fillStyle = fx.move === 'glare' ? '#ffe14a' : '#ffffff';
    c.beginPath();
    c.ellipse(at.x + dx, at.y - 10, 3.5, 2 * k + 0.3, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#c0202a';
    c.beginPath();
    c.arc(at.x + dx, at.y - 10, 1.1 * k, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
  if (fx.move === 'glare' && fx.t > 0.4) electricRing(c, fx.to, span(fx.t, 0.4, 1));
});
fam('tailwhip', (c, fx) => {
  for (let i = 0; i < 3; i++) {
    c.globalAlpha = win(fx.t, 0, 1) * (1 - i * 0.3);
    c.strokeStyle = '#ffffff';
    c.lineWidth = 1.2;
    c.beginPath();
    const a = Math.sin(fx.t * 30) * 0.8;
    c.arc(fx.from.x, fx.from.y + 6, 12 + i * 3, a - 0.6, a + 0.6);
    c.stroke();
  }
  c.globalAlpha = 1;
});
fam('thunderwave', (c, fx) => {
  const k = span(fx.t, 0, 0.4);
  if (k < 1) { const p = travel(fx, k); glowBall(c, p.x, p.y, 4, '#ffffff', 'rgba(255,230,60,0)'); }
  else electricRing(c, fx.to, span(fx.t, 0.4, 1));
});
fam('disable', (c, fx) => {
  const k = win(fx.t, 0, 1);
  c.globalAlpha = k;
  c.strokeStyle = '#ff3b3b';
  c.lineWidth = 2.5;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(fx.to.x - 8, fx.to.y - 8);
  c.lineTo(fx.to.x + 8, fx.to.y + 8);
  c.moveTo(fx.to.x + 8, fx.to.y - 8);
  c.lineTo(fx.to.x - 8, fx.to.y + 8);
  c.stroke();
  c.globalAlpha = 1;
});
fam('transform mimic conversion', (c, fx) => shimmer(c, fx.move === 'mimic' ? fx.to : fx.from, fx.t));
fam('flash', (c, fx) => sparkles(c, fx.to, fx.t, '#ffffff', 10, 22));

// --- Moves the user does to itself ---
fam('recover softboiled', (c, fx) => {
  sparkles(c, fx.from, fx.t, '#b8ffb0', 12, 18);
  for (let i = 0; i < 3; i++) {
    const r = 26 * (1 - ((fx.t * 1.5 + i / 3) % 1));
    c.globalAlpha = (1 - r / 26) * win(fx.t, 0, 1);
    c.strokeStyle = '#9fff8a';
    c.lineWidth = 1;
    c.beginPath();
    c.ellipse(fx.from.x, fx.from.y, r, r * 0.7, 0, 0, Math.PI * 2);
    c.stroke();
  }
  c.globalAlpha = 1;
});
fam('rest', (c, fx) => {
  for (let i = 0; i < 3; i++) {
    const k = (fx.t * 1.2 + i / 3) % 1;
    c.globalAlpha = Math.sin(Math.PI * k);
    c.font = `800 ${5 + k * 4}px Nunito, sans-serif`;
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#3a4a7a';
    c.lineWidth = 1;
    c.strokeText('Z', fx.from.x + 6 + k * 12, fx.from.y - 10 - k * 16);
    c.fillText('Z', fx.from.x + 6 + k * 12, fx.from.y - 10 - k * 16);
  }
  c.globalAlpha = 1;
  sparkles(c, fx.from, fx.t, '#b8ffb0', 6, 16);
});
fam('reflect', (c, fx) => wall(c, fx, '255,190,120'));
fam('lightscreen', (c, fx) => wall(c, fx, '255,240,140'));
fam('barrier', (c, fx) => wall(c, fx, '180,210,255'));
fam('agility', (c, fx) => { speedLines(c, fx.from, fx.t); speedLines(c, P(fx.from.x, fx.from.y + 4), fx.t + 0.3, '#bfe3ff'); });
fam('harden withdraw defensecurl acidarmor sharpen', (c, fx) => {
  const rgb = fx.move === 'acidarmor' ? '200,110,240' : fx.move === 'withdraw' ? '120,190,255' : '230,230,240';
  const k = win(fx.t, 0, 1);
  c.globalAlpha = k;
  glowBall(c, fx.from.x, fx.from.y, 20, `rgba(${rgb},0.05)`, `rgba(${rgb},0.55)`);
  c.strokeStyle = `rgb(${rgb})`;
  c.lineWidth = 1.2;
  c.beginPath();
  c.ellipse(fx.from.x, fx.from.y, 20, 17, 0, 0, Math.PI * 2);
  c.stroke();
  c.globalAlpha = 1;
  sparkles(c, fx.from, fx.t, '#ffffff', 5, 18);
});
fam('swordsdance', (c, fx) => {
  for (let i = 0; i < 4; i++) {
    const a = fx.t * 9 + (i / 4) * Math.PI * 2;
    c.save();
    c.globalAlpha = win(fx.t, 0, 1);
    c.translate(fx.from.x + Math.cos(a) * 16, fx.from.y + Math.sin(a) * 6 - 4);
    c.rotate(a);
    c.fillStyle = '#e8eef5';
    c.strokeStyle = '#5a6a7a';
    c.lineWidth = 0.4;
    c.beginPath();
    c.moveTo(0, -9);
    c.lineTo(1.4, -2);
    c.lineTo(-1.4, -2);
    c.closePath();
    c.fill();
    c.stroke();
    c.fillStyle = '#c99a3a';
    c.fillRect(-2.5, -2, 5, 1);
    c.fillRect(-0.6, -1, 1.2, 3);
    c.restore();
  }
  c.globalAlpha = 1;
});
fam('meditate growth focusenergy amnesia', (c, fx) => {
  const rgb = {meditate: '255,130,200', growth: '140,230,90', focusenergy: '255,150,50', amnesia: '120,190,255'}[fx.move as 'growth'] ?? '255,255,255';
  aura(c, fx.from, fx.t, rgb);
});
fam('minimize doubleteam', (c, fx) => {
  const k = win(fx.t, 0, 1);
  for (let i = 0; i < 4; i++) {
    const off = Math.sin(fx.t * 20 + i * 1.6) * 18 * k;
    c.globalAlpha = 0.35 * k;
    glowBall(c, fx.from.x + off, fx.from.y, 14, 'rgba(255,255,255,0.8)', 'rgba(255,255,255,0)');
  }
  c.globalAlpha = 1;
});
fam('substitute', (c, fx) => cloud(c, fx.from, fx.t, '235,235,235', 1));
fam('splash', (c, fx) => {
  for (let i = 0; i < 8; i++) {
    const k = (fx.t * 2 + rnd(i)) % 1;
    c.globalAlpha = win(fx.t, 0, 1);
    c.fillStyle = '#9fd0ff';
    c.beginPath();
    c.arc(fx.from.x + (rnd(i, 1) - 0.5) * 30, fx.from.y + 12 - Math.sin(Math.PI * k) * 18, 1.4, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
});
fam('teleport', (c, fx) => {
  const k = win(fx.t, 0, 1);
  c.globalAlpha = k;
  const grad = c.createLinearGradient(fx.from.x - 10, 0, fx.from.x + 10, 0);
  grad.addColorStop(0, 'rgba(255,150,230,0)');
  grad.addColorStop(0.5, 'rgba(255,230,255,0.9)');
  grad.addColorStop(1, 'rgba(255,150,230,0)');
  c.fillStyle = grad;
  c.fillRect(fx.from.x - 10, 0, 20, fx.from.y + 16);
  c.globalAlpha = 1;
});
fam('metronome mirrormove', (c, fx) => {
  // A wagging finger above the user.
  c.save();
  c.translate(fx.from.x, fx.from.y - 18);
  c.rotate(Math.sin(fx.t * 25) * 0.5);
  c.globalAlpha = win(fx.t, 0, 1);
  c.fillStyle = '#f3d2a8';
  c.strokeStyle = '#5a3a28';
  c.lineWidth = 0.5;
  c.beginPath();
  c.roundRect(-1.5, -10, 3, 10, 1.5);
  c.fill();
  c.stroke();
  c.restore();
  c.globalAlpha = 1;
  sparkles(c, P(fx.from.x, fx.from.y - 22), fx.t, '#fff27a', 4, 8);
});

// --- Moves from later games (extra TMs) ---
fam('dragonclaw', (c, fx) => claws(c, fx.to, span(fx.t, 0.15, 1), '#b49bff', 3));
fam('xscissor', (c, fx) => claws(c, fx.to, span(fx.t, 0.15, 1), '#c6ec6a', 2));
fam('crosschop', (c, fx) => claws(c, fx.to, span(fx.t, 0.15, 1), '#ffd27a', 2));
fam('dragonbreath dragonpulse signalbeam', (c, fx) => {
  const k = span(fx.t, 0, 0.6), fade = 1 - span(fx.t, 0.75, 1);
  const [outer, inner, w] = fx.move === 'signalbeam' ? ['rgba(120,255,160,0.8)', '#fff6a8', 5]
    : fx.move === 'dragonpulse' ? ['rgba(110,80,255,0.85)', '#e6dcff', 8] : ['rgba(150,110,255,0.7)', '#ffffff', 5];
  c.globalAlpha = fade;
  beam(c, fx.from, fx.to, k, w as number, outer as string, inner as string, fx.move === 'dragonbreath' ? 2 : 0);
  if (k >= 1) glowBall(c, fx.to.x, fx.to.y, 12 * win(fx.t, 0.55, 1) + 4, inner as string, 'rgba(90,60,255,0)');
  c.globalAlpha = 1;
});
fam('shadowball mudshot', (c, fx) => {
  const shadow = fx.move === 'shadowball';
  const k = span(fx.t, 0, 0.55);
  if (k < 1) { const p = travel(fx, k, 6); glowBall(c, p.x, p.y, shadow ? 9 : 6, shadow ? '#5a2a7a' : '#8a5a2a', shadow ? 'rgba(40,0,60,0)' : 'rgba(90,60,20,0)'); return; }
  const h = span(fx.t, 0.55, 1);
  c.globalAlpha = 1 - h;
  glowBall(c, fx.to.x, fx.to.y, 8 + h * 18, shadow ? 'rgba(110,40,160,0.9)' : 'rgba(140,100,50,0.9)', 'rgba(20,0,40,0)');
  c.globalAlpha = 1;
});
// Same look as an older move.
for (const [id, like] of [['twister', 'gust'], ['outrage', 'thrash'], ['shadowpunch', 'megapunch'], ['megahorn', 'hornattack'], ['bonerush', 'bonemerang'],
  ['earthpower', 'earthquake'], ['heatwave', 'flamethrower'], ['icywind', 'blizzard'], ['aerialace', 'wingattack'], ['poisonjab', 'poisonsting']] as const) {
  MOVE_FX[id] = (c, fx) => MOVE_FX[like](c, fx);
}
// Rock Tomb, Stone Edge, Ancient Power and Spark use their type's animation (falling rocks / sparks).

/** True if this move has its own animation. */
export const hasMoveFx = (move: string) => move in MOVE_FX;

/** How many frames a move's animation lasts. */
export function fxFrames(move?: string): number {
  if (move === 'explosion' || move === 'selfdestruct') return 70;
  if (move === 'hyperbeam' || move === 'solarbeam' || move === 'surf' || move === 'thunder' || move === 'blizzard' || move === 'earthquake') return 56;
  return FX_FRAMES;
}

const SHAKE: Record<string, number> = {
  explosion: 4, selfdestruct: 3, earthquake: 3, fissure: 3, hyperbeam: 2, megakick: 2, highjumpkick: 2, bodyslam: 2,
  doubleedge: 2, takedown: 1.5, skullbash: 2, seismictoss: 2, submission: 2, thunder: 1.5, eggbomb: 1.5, guillotine: 2,
  horndrill: 2, strength: 2, megapunch: 1.5, stomp: 1.5, rockslide: 1.5, slam: 1.5, crabhammer: 1.5,
};

function moveShake(fx: Fx): number | null {
  const amp = SHAKE[fx.move ?? ''];
  if (amp === undefined) return null;
  const start = fx.move === 'explosion' || fx.move === 'selfdestruct' ? 0.15 : 0.45;
  if (fx.t < start) return 0;
  const k = (fx.t - start) / (1 - start);
  return Math.sin(k * 70) * amp * (1 - k);
}

function moveOverlay(fx: Fx): string | null {
  const t = fx.t;
  switch (fx.move) {
    case 'explosion': case 'selfdestruct': {
      const f = win(t, 0.12, 0.45);
      return f ? `rgba(255,250,235,${0.85 * f})` : '';
    }
    case 'flash': return `rgba(255,255,255,${0.9 * win(t, 0, 0.7)})`;
    case 'hyperbeam': return t > 0.3 ? `rgba(255,200,120,${0.25 * win(t, 0.3, 1)})` : '';
    case 'solarbeam': return `rgba(255,250,200,${0.3 * win(t, 0, 1)})`;
    case 'thunder': return t > 0.25 && Math.floor(t * 30) % 3 === 0 ? 'rgba(255,250,170,0.45)' : 'rgba(20,20,40,0.25)';
    case 'blizzard': return `rgba(200,235,255,${0.35 * win(t, 0, 1)})`;
    case 'nightshade': return `rgba(30,0,50,${0.45 * win(t, 0, 1)})`;
    case 'smokescreen': return `rgba(30,30,30,${0.25 * win(t, 0.4, 1)})`;
    case 'haze': return `rgba(120,120,140,${0.3 * win(t, 0, 1)})`;
    case 'mist': return `rgba(230,245,255,${0.3 * win(t, 0, 1)})`;
    case 'hypnosis': return `rgba(255,120,220,${0.12 * win(t, 0, 1)})`;
    default: return null;
  }
}
