// The Elite Four rooms (FireRed layout, drawn smooth like the island, "dramatic lighting" style):
// back wall with gold lights and an arched door, tiled floor in the room's colours, a white court with a
// two-colour circle, three themed pillars on each side, entrance at the bottom. 160×144 game pixels.

import type {Gfx} from './gfx';

export type RoomKey = 'lorelei' | 'bruno' | 'agatha' | 'lance' | 'blue';
interface Theme { floor: [string, string]; ring: [string, string]; pillar: 'ice' | 'stone' | 'tube' | 'horn' | 'lamp'; fx: 'snow' | 'dust' | 'wisp' | 'ember' | 'spark'; wall: [string, string] }

const THEMES: Record<RoomKey, Theme> = {
  lorelei: {floor: ['#9fd0f4', '#78ade0'], ring: ['#b7a3e6', '#9fd8cf'], pillar: 'ice', fx: 'snow', wall: ['#b8744a', '#8a5232']},
  bruno: {floor: ['#e3d27a', '#c4b052'], ring: ['#7cc47a', '#eeeeee'], pillar: 'stone', fx: 'dust', wall: ['#b8744a', '#8a5232']},
  agatha: {floor: ['#b996e2', '#956bcc'], ring: ['#e57d72', '#ecd47a'], pillar: 'tube', fx: 'wisp', wall: ['#b8744a', '#8a5232']},
  lance: {floor: ['#6cc2b2', '#4a9e90'], ring: ['#e0607e', '#8a6fd0'], pillar: 'horn', fx: 'ember', wall: ['#b8744a', '#8a5232']},
  blue: {floor: ['#d3dde6', '#aebccb'], ring: ['#f0d27a', '#d3dde6'], pillar: 'lamp', fx: 'spark', wall: ['#8a5fd0', '#5b3aa0']},
};

/** Rooms are walkable 10×9 tile maps (16 px tiles): # wall · . floor · P pillar. */
export const ROOM_MAP = [
  '##########',
  '##########',
  '#P......P#',
  '#........#',
  '#P......P#',
  '#........#',
  '#P......P#',
  '#........#',
  '####..####',
];
export const ROOM_FOE = {x: 4, y: 3};
export const ROOM_PLAYER = {x: 4, y: 8};

/** Floor, walls, door and court (everything that doesn't stand up). */
export function drawRoomBack(g: Gfx, key: RoomKey, time: number, doorOpen: boolean) {
  const c = g.ctx, th = THEMES[key], W = 160, H = 144;
  c.save();
  c.fillStyle = '#3e2414';
  c.fillRect(0, 0, W, H);
  // Back wall with gold lights.
  const wall = c.createLinearGradient(0, 0, 0, 30);
  wall.addColorStop(0, th.wall[0]);
  wall.addColorStop(1, th.wall[1]);
  c.fillStyle = wall;
  c.fillRect(0, 0, W, 30);
  c.fillStyle = '#f3cf86';
  c.fillRect(0, 28, W, 4);
  for (let x = 12; x < W; x += 22) {
    if (x > 60 && x < 100) continue;
    const pulse = 0.75 + 0.25 * Math.sin(time / 700 + x);
    const lamp = c.createRadialGradient(x, 14, 0, x, 14, 6);
    lamp.addColorStop(0, `rgba(255, 246, 196, ${pulse})`);
    lamp.addColorStop(1, 'rgba(217, 166, 64, 0)');
    c.fillStyle = lamp;
    c.beginPath(); c.arc(x, 14, 6, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff3c0';
    c.beginPath(); c.arc(x, 14, 2.2, 0, Math.PI * 2); c.fill();
  }
  // Arched door (opens once you win).
  c.fillStyle = '#d2552f';
  c.beginPath(); c.roundRect(64, 2, 32, 30, [10, 10, 0, 0]); c.fill();
  c.fillStyle = doorOpen ? '#1c1430' : '#eef6ff';
  c.beginPath(); c.roundRect(69, 8, 22, 24, [7, 7, 0, 0]); c.fill();
  if (!doorOpen) {
    c.strokeStyle = '#b9cde0'; c.lineWidth = 0.6;
    c.beginPath(); c.moveTo(80, 8); c.lineTo(80, 32); c.stroke();
  } else {
    const glow = c.createLinearGradient(0, 8, 0, 32);
    glow.addColorStop(0, 'rgba(255, 240, 180, 0.9)');
    glow.addColorStop(1, 'rgba(255, 240, 180, 0)');
    c.fillStyle = glow;
    c.fillRect(70, 9, 20, 23);
  }
  // Floor tiles.
  const fl = c.createLinearGradient(0, 32, 0, 124);
  fl.addColorStop(0, th.floor[1]);
  fl.addColorStop(1, th.floor[0]);
  c.fillStyle = fl;
  c.fillRect(8, 32, W - 16, 92);
  c.strokeStyle = 'rgba(255, 255, 255, 0.16)'; c.lineWidth = 0.5;
  for (let y = 40; y < 124; y += 8) { c.beginPath(); c.moveTo(8, y); c.lineTo(W - 8, y); c.stroke(); }
  for (let x = 16; x < W - 8; x += 8) { c.beginPath(); c.moveTo(x, 32); c.lineTo(x, 124); c.stroke(); }
  // Side walls with little lit panels.
  c.fillStyle = th.wall[1];
  c.fillRect(0, 32, 8, 92); c.fillRect(W - 8, 32, 8, 92);
  c.fillStyle = 'rgba(255, 255, 255, 0.35)';
  for (let y = 38; y < 120; y += 12) { c.fillRect(2, y, 3, 4); c.fillRect(W - 5, y, 3, 4); }
  // The court and its two-colour circle.
  c.strokeStyle = '#ffffff'; c.lineWidth = 1.2;
  c.beginPath(); c.roundRect(44, 40, 72, 68, 2); c.stroke();
  const cy = 74;
  c.fillStyle = th.ring[0]; c.beginPath(); c.arc(80, cy, 20, Math.PI, 0); c.fill();
  c.fillStyle = th.ring[1]; c.beginPath(); c.arc(80, cy, 20, 0, Math.PI); c.fill();
  c.fillStyle = th.floor[0]; c.beginPath(); c.arc(80, cy, 7, 0, Math.PI * 2); c.fill(); c.stroke();
  c.beginPath(); c.moveTo(44, cy); c.lineTo(116, cy); c.stroke();
  // Front wall with the entrance gap.
  c.fillStyle = wall;
  c.fillRect(0, 124, 64, 20); c.fillRect(96, 124, 64, 20);
  c.fillStyle = '#f3cf86';
  c.fillRect(0, 122, 64, 3); c.fillRect(96, 122, 64, 3);
  c.fillStyle = fl;
  c.fillRect(64, 122, 32, 22);
  c.restore();
}

/** One pillar (drawn with the standing things so people can walk in front of / behind it). */
export function drawPillar(g: Gfx, key: RoomKey, tx: number, ty: number, time: number) {
  const c = g.ctx, th = THEMES[key];
  const x = tx * 16 + 4, base = ty * 16 + 15, y = base - 24;
  c.save();
  c.fillStyle = 'rgba(0, 0, 0, 0.22)';
  c.beginPath(); c.ellipse(x + 4, base, 7, 2.4, 0, 0, Math.PI * 2); c.fill();
  switch (th.pillar) {
    case 'ice': {
      const gr = c.createLinearGradient(x - 2, 0, x + 10, 0);
      gr.addColorStop(0, '#c8ecff'); gr.addColorStop(0.5, '#ffffff'); gr.addColorStop(1, '#93cff2');
      c.fillStyle = gr;
      c.beginPath(); c.moveTo(x, base); c.lineTo(x - 1, y + 6); c.lineTo(x + 3, y); c.lineTo(x + 8, y + 5); c.lineTo(x + 8, base); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 0.6;
      c.beginPath(); c.moveTo(x + 2.5, y + 4); c.lineTo(x + 2.5, base - 2); c.stroke();
      break;
    }
    case 'stone': {
      const gr = c.createLinearGradient(x - 1, 0, x + 9, 0);
      gr.addColorStop(0, '#8f949c'); gr.addColorStop(0.5, '#d4d8de'); gr.addColorStop(1, '#7c8189');
      c.fillStyle = gr;
      for (let k = 0; k < 3; k++) { c.beginPath(); c.roundRect(x - 1, y + k * 8, 10, 7.5, 3); c.fill(); }
      break;
    }
    case 'tube': {
      const gr = c.createLinearGradient(x - 1, 0, x + 9, 0);
      gr.addColorStop(0, '#6a2f9e'); gr.addColorStop(0.5, '#c79aef'); gr.addColorStop(1, '#5e278f');
      c.fillStyle = gr;
      c.beginPath(); c.roundRect(x - 1, y, 10, 24, 5); c.fill();
      const core = c.createLinearGradient(0, y, 0, base);
      core.addColorStop(0, '#fff3a8'); core.addColorStop(1, '#e8b844');
      c.globalAlpha = 0.55 + 0.45 * Math.sin(time / 380 + tx * 3 + ty);
      c.fillStyle = core;
      c.fillRect(x + 2.5, y + 4, 3, 16);
      break;
    }
    case 'horn': {
      c.fillStyle = '#5a6470';
      c.beginPath(); c.roundRect(x - 2, base - 6, 12, 6, 2); c.fill();
      const gr = c.createLinearGradient(x, 0, x + 9, 0);
      gr.addColorStop(0, '#e8e2d2'); gr.addColorStop(1, '#a8a090');
      c.fillStyle = gr;
      c.beginPath(); c.moveTo(x, base - 6); c.quadraticCurveTo(x - 3, y + 4, x + (tx < 5 ? 8 : 0), y); c.quadraticCurveTo(x + 5, y + 10, x + 8, base - 6); c.closePath(); c.fill();
      break;
    }
    case 'lamp': {
      c.fillStyle = '#5b6b80';
      c.fillRect(x + 2, y + 4, 4, 20);
      const glow = c.createRadialGradient(x + 4, y + 3, 0, x + 4, y + 3, 9);
      glow.addColorStop(0, 'rgba(255, 250, 200, 0.95)');
      glow.addColorStop(1, 'rgba(255, 230, 150, 0)');
      c.fillStyle = glow;
      c.beginPath(); c.arc(x + 4, y + 3, 9, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff8d8';
      c.beginPath(); c.arc(x + 4, y + 3, 3, 0, Math.PI * 2); c.fill();
      break;
    }
  }
  c.restore();
}

/** Lighting on top of everything: dark edges, a spotlight on the trainer, floating particles, the name tag. */
export function drawRoomLight(g: Gfx, key: RoomKey, time: number, spot: {x: number; y: number}, tag: string) {
  const c = g.ctx, th = THEMES[key];
  c.save();
  const v = c.createRadialGradient(80, 66, 14, 80, 66, 112);
  v.addColorStop(0, 'rgba(0, 0, 0, 0)');
  v.addColorStop(1, 'rgba(10, 6, 24, 0.55)');
  c.fillStyle = v;
  c.fillRect(0, 0, 160, 144);
  const s = c.createRadialGradient(spot.x, spot.y, 0, spot.x, spot.y, 28);
  s.addColorStop(0, 'rgba(255, 255, 230, 0.38)');
  s.addColorStop(1, 'rgba(255, 255, 230, 0)');
  c.fillStyle = s;
  c.fillRect(spot.x - 30, spot.y - 30, 60, 60);
  const colour = {snow: '#ffffff', dust: '#f3e3b0', wisp: '#d9b8ff', ember: '#ffb070', spark: '#fff6b0'}[th.fx];
  for (let i = 0; i < 16; i++) {
    const ph = (time / 4200 + i / 16) % 1;
    const x = 12 + ((i * 53) % 136) + Math.sin(ph * 6 + i) * 3;
    const rising = th.fx === 'wisp' || th.fx === 'ember' || th.fx === 'spark';
    const y = rising ? 120 - ph * 88 : 32 + ph * 88;
    c.globalAlpha = Math.sin(Math.PI * ph) * 0.8;
    c.fillStyle = colour;
    c.beginPath(); c.arc(x, y, th.fx === 'wisp' ? 1.5 : 0.9, 0, Math.PI * 2); c.fill();
  }
  c.globalAlpha = 1;
  // Floating name tag.
  c.font = '800 6.5px "Nunito", sans-serif';
  const w = c.measureText(tag).width + 14;
  c.fillStyle = 'rgba(20, 16, 36, 0.78)';
  c.beginPath(); c.roundRect(80 - w / 2, 4, w, 12, 6); c.fill();
  c.fillStyle = '#ffffff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(tag, 80, 10.5);
  c.restore();
}

/** Battle backdrop inside an Elite Four room: back wall with gold lights, the room's floor, lit platforms. */
export function drawArenaBackground(g: Gfx, key: RoomKey, time: number) {
  const c = g.ctx, th = THEMES[key], W = 160;
  c.save();
  const wall = c.createLinearGradient(0, 0, 0, 40);
  wall.addColorStop(0, th.wall[1]);
  wall.addColorStop(1, th.wall[0]);
  c.fillStyle = wall;
  c.fillRect(0, 0, W, 40);
  for (let x = 10; x < W; x += 20) {
    const pulse = 0.7 + 0.3 * Math.sin(time / 700 + x);
    const lamp = c.createRadialGradient(x, 14, 0, x, 14, 7);
    lamp.addColorStop(0, `rgba(255, 246, 196, ${pulse})`);
    lamp.addColorStop(1, 'rgba(217, 166, 64, 0)');
    c.fillStyle = lamp;
    c.beginPath(); c.arc(x, 14, 7, 0, Math.PI * 2); c.fill();
  }
  c.fillStyle = '#f3cf86';
  c.fillRect(0, 38, W, 3);
  const fl = c.createLinearGradient(0, 41, 0, 100);
  fl.addColorStop(0, th.floor[1]);
  fl.addColorStop(1, th.floor[0]);
  c.fillStyle = fl;
  c.fillRect(0, 41, W, 59);
  c.strokeStyle = 'rgba(255, 255, 255, 0.15)'; c.lineWidth = 0.5;
  for (let y = 48; y < 100; y += 8) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  for (let x = 0; x < W; x += 10) { c.beginPath(); c.moveTo(80 + (x - 80) * 0.6, 41); c.lineTo(x, 100); c.stroke(); }
  const platform = (cx: number, cy: number, rx: number, ry: number) => {
    c.fillStyle = 'rgba(0, 0, 0, 0.18)';
    c.beginPath(); c.ellipse(cx, cy + 2, rx, ry, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = th.ring[0];
    c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#ffffff'; c.lineWidth = 1;
    c.beginPath(); c.ellipse(cx, cy, rx * 0.7, ry * 0.7, 0, 0, Math.PI * 2); c.stroke();
  };
  platform(122, 60, 34, 7);
  platform(40, 97, 46, 10);
  // Edge darkening, like the room.
  const v = c.createRadialGradient(80, 60, 20, 80, 60, 110);
  v.addColorStop(0, 'rgba(0, 0, 0, 0)');
  v.addColorStop(1, 'rgba(10, 6, 24, 0.4)');
  c.fillStyle = v;
  c.fillRect(0, 0, W, 100);
  c.restore();
}
