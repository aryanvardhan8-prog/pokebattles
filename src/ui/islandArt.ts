// Detailed island scenery: sea, beach, dock, grass, rocks and tall palm trees.
// Drawn with smooth shapes (the canvas runs at full device sharpness), in game-pixel coordinates.

import type {Gfx} from './gfx';

type Map = string[];

const isLandChar = (ch: string | undefined) => !!ch && ch !== 'w' && ch !== 'd';

/** Small repeatable "random" numbers so decoration stays put between frames. */
function hash(x: number, y: number, n: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + n * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

export function drawSea(g: Gfx, time: number) {
  const c = g.ctx;
  const sea = c.createLinearGradient(0, 0, 0, 144);
  sea.addColorStop(0, '#2a7fc4');
  sea.addColorStop(1, '#3f9fdc');
  c.fillStyle = sea;
  c.fillRect(0, 0, 160, 144);
  // Gentle wave crests drifting sideways.
  c.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  c.lineWidth = 0.7;
  c.lineCap = 'round';
  for (let row = 0; row < 16; row++) {
    const y = 4 + row * 9;
    const drift = (time / 90 + row * 13) % 32;
    for (let x = -32 + drift; x < 170; x += 32) {
      const bob = Math.sin(time / 600 + row + x / 20) * 0.6;
      c.beginPath();
      c.moveTo(x, y + bob);
      c.quadraticCurveTo(x + 4, y - 1.6 + bob, x + 8, y + bob);
      c.stroke();
    }
  }
}

/** Sand with a rounded coastline, wet edge and foam. */
export function drawLand(g: Gfx, map: Map, time: number) {
  const c = g.ctx;
  const land = (x: number, y: number) => y >= 0 && y < map.length && x >= 0 && x < 10 && isLandChar(map[y][x]);
  const tiles: [number, number][] = [];
  map.forEach((row, y) => [...row].forEach((ch, x) => { if (isLandChar(ch)) tiles.push([x, y]); }));

  const radii = (x: number, y: number, r: number) => [
    !land(x - 1, y) && !land(x, y - 1) ? r : 0,
    !land(x + 1, y) && !land(x, y - 1) ? r : 0,
    !land(x + 1, y) && !land(x, y + 1) ? r : 0,
    !land(x - 1, y) && !land(x, y + 1) ? r : 0,
  ];
  const shape = (x: number, y: number, grow: number, r: number) => {
    c.beginPath();
    const rr = radii(x, y, r);
    if (c.roundRect) c.roundRect(x * 16 - grow, y * 16 - grow, 16 + grow * 2, 16 + grow * 2, rr);
    else c.rect(x * 16 - grow, y * 16 - grow, 16 + grow * 2, 16 + grow * 2);
    c.fill();
  };

  // 1) foam (breathes slightly), 2) shallow water tint, 3) wet sand, 4) dry sand.
  const foam = 2.2 + Math.sin(time / 500) * 0.5;
  c.fillStyle = 'rgba(120, 200, 240, 0.55)';
  tiles.forEach(([x, y]) => shape(x, y, foam + 2.5, 9));
  c.fillStyle = 'rgba(255, 255, 255, 0.9)';
  tiles.forEach(([x, y]) => shape(x, y, foam, 7));
  c.fillStyle = '#dcbf83';
  tiles.forEach(([x, y]) => shape(x, y, 0.8, 6));
  const sand = c.createLinearGradient(0, 0, 0, 144);
  sand.addColorStop(0, '#f8e7b6');
  sand.addColorStop(1, '#efd398');
  c.fillStyle = sand;
  tiles.forEach(([x, y]) => shape(x, y, 0.35, 5));

  // Texture: tiny grains and darker specks.
  tiles.forEach(([x, y]) => {
    for (let i = 0; i < 6; i++) {
      const px = x * 16 + 1 + hash(x, y, i) * 14, py = y * 16 + 1 + hash(y, x, i + 9) * 14;
      c.fillStyle = i % 3 === 0 ? 'rgba(255, 255, 255, 0.7)' : 'rgba(170, 125, 60, 0.35)';
      c.fillRect(px, py, 0.8, 0.8);
    }
  });
}

/** Shells and a starfish lying on the sand. */
export function drawDecor(g: Gfx) {
  const c = g.ctx;
  // starfish
  const star = (cx: number, cy: number, r: number, rot: number) => {
    c.save();
    c.translate(cx, cy);
    c.rotate(rot);
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const rr = i % 2 === 0 ? r : r * 0.45;
      c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    c.closePath();
    c.fillStyle = '#f08a4b';
    c.fill();
    c.strokeStyle = '#c4602a';
    c.lineWidth = 0.4;
    c.stroke();
    c.fillStyle = '#ffd2a8';
    c.beginPath();
    c.arc(0, 0, r * 0.25, 0, Math.PI * 2);
    c.fill();
    c.restore();
  };
  star(105, 101, 3, 0.3);
  // shells
  const shell = (cx: number, cy: number) => {
    c.fillStyle = '#fff3e8';
    c.beginPath();
    c.arc(cx, cy, 2, Math.PI, 0);
    c.lineTo(cx, cy + 1.2);
    c.closePath();
    c.fill();
    c.strokeStyle = '#e0b8a0';
    c.lineWidth = 0.35;
    for (let i = -1; i <= 1; i++) {
      c.beginPath();
      c.moveTo(cx, cy + 1);
      c.lineTo(cx + i * 1.6, cy - 1.6);
      c.stroke();
    }
  };
  shell(38, 70);
  shell(132, 86);
  shell(70, 28);
}

/** Wooden dock over the water, on tile (x, y). */
export function drawDock(g: Gfx, x: number, y: number, isEnd: boolean) {
  const c = g.ctx;
  const X = x * 16, Y = y * 16;
  c.fillStyle = 'rgba(10, 40, 80, 0.25)'; // shadow on the water
  c.fillRect(X + 3, Y + 2, 12, 16);
  for (let i = 0; i < 4; i++) {
    const py = Y + i * 4;
    const wood = c.createLinearGradient(0, py, 0, py + 3.4);
    wood.addColorStop(0, '#c98c55');
    wood.addColorStop(1, '#9c6236');
    c.fillStyle = wood;
    c.fillRect(X + 1.5, py + 0.3, 13, 3.4);
    c.fillStyle = 'rgba(70, 40, 15, 0.5)'; // nail heads
    c.fillRect(X + 3, py + 1.6, 0.7, 0.7);
    c.fillRect(X + 12.3, py + 1.6, 0.7, 0.7);
  }
  c.fillStyle = '#5c3a1c'; // posts
  c.fillRect(X + 0.5, Y, 1.6, 16 + (isEnd ? 3 : 0));
  c.fillRect(X + 13.9, Y, 1.6, 16 + (isEnd ? 3 : 0));
}

/** A tuft of beach grass that sways a little. */
export function drawGrass(g: Gfx, x: number, y: number, time: number) {
  const c = g.ctx;
  const tufts: [number, number][] = [[4, 11], [10, 13], [7, 6], [12, 7]];
  tufts.forEach(([tx, ty], k) => {
    const bx = x * 16 + tx, by = y * 16 + ty;
    const sway = Math.sin(time / 700 + k + x) * 0.8;
    for (let i = -2; i <= 2; i++) {
      const h = 4.5 - Math.abs(i) * 0.6;
      c.strokeStyle = i % 2 === 0 ? '#4fa63a' : '#76c556';
      c.lineWidth = 0.9;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(bx + i * 0.7, by);
      c.quadraticCurveTo(bx + i * 1.2 + sway * 0.5, by - h * 0.6, bx + i * 1.8 + sway, by - h);
      c.stroke();
    }
  });
}

/** A rounded, shaded boulder standing on tile (x, y). */
export function drawRock(g: Gfx, x: number, y: number) {
  const c = g.ctx;
  const cx = x * 16 + 8, by = y * 16 + 14;
  c.fillStyle = 'rgba(80, 60, 30, 0.25)';
  c.beginPath();
  c.ellipse(cx + 1, by, 8, 2.2, 0, 0, Math.PI * 2);
  c.fill();
  const rock = c.createLinearGradient(cx - 6, by - 11, cx + 6, by);
  rock.addColorStop(0, '#c9ccd2');
  rock.addColorStop(1, '#7d828c');
  c.fillStyle = rock;
  c.beginPath();
  c.moveTo(cx - 7, by);
  c.bezierCurveTo(cx - 8, by - 6, cx - 4, by - 11, cx + 1, by - 10.5);
  c.bezierCurveTo(cx + 6, by - 10, cx + 8, by - 5, cx + 7, by);
  c.closePath();
  c.fill();
  c.strokeStyle = '#5b606a';
  c.lineWidth = 0.6;
  c.stroke();
  c.fillStyle = 'rgba(255, 255, 255, 0.45)';
  c.beginPath();
  c.ellipse(cx - 2, by - 7.5, 2.6, 1.3, -0.4, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(60, 64, 72, 0.6)';
  c.lineWidth = 0.4;
  c.beginPath();
  c.moveTo(cx + 2, by - 9);
  c.lineTo(cx + 3.5, by - 5);
  c.lineTo(cx + 2.5, by - 2);
  c.stroke();
}

/**
 * A tall palm tree whose trunk stands on tile (x, y). About twice a trainer's height.
 * Drawn in the depth-sorted pass so characters can walk behind its leaves.
 */
export function drawPalm(g: Gfx, x: number, y: number, time: number, lean = 1) {
  const c = g.ctx;
  const bx = x * 16 + 8, by = y * 16 + 14;
  const height = 40;
  const topX = bx + 6 * lean, topY = by - height;

  // Shadow on the sand (trunk + canopy blob).
  c.fillStyle = 'rgba(90, 65, 25, 0.22)';
  c.beginPath();
  c.ellipse(bx + 7, by + 0.5, 13, 3.2, 0, 0, Math.PI * 2);
  c.fill();

  // Curved, segmented trunk (thick at the bottom).
  const ctrlX = bx + 1 * lean, ctrlY = by - height * 0.55;
  const point = (t: number) => ({
    x: (1 - t) ** 2 * bx + 2 * (1 - t) * t * ctrlX + t ** 2 * topX,
    y: (1 - t) ** 2 * by + 2 * (1 - t) * t * ctrlY + t ** 2 * topY,
  });
  for (let i = 0; i < 12; i++) {
    const t0 = i / 12, t1 = (i + 1) / 12;
    const p0 = point(t0), p1 = point(t1);
    const w = 3.6 - t0 * 1.5;
    const bark = c.createLinearGradient(p0.x - w, 0, p0.x + w, 0);
    bark.addColorStop(0, '#7a4e26');
    bark.addColorStop(0.5, '#b07a45');
    bark.addColorStop(1, '#6b421f');
    c.fillStyle = bark;
    c.beginPath();
    c.moveTo(p0.x - w, p0.y);
    c.lineTo(p1.x - w + 0.3, p1.y);
    c.lineTo(p1.x + w - 0.3, p1.y);
    c.lineTo(p0.x + w, p0.y);
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(70, 40, 15, 0.55)'; // ring between segments
    c.lineWidth = 0.4;
    c.beginPath();
    c.moveTo(p1.x - w + 0.3, p1.y);
    c.quadraticCurveTo(p1.x, p1.y + 0.8, p1.x + w - 0.3, p1.y);
    c.stroke();
  }

  // Coconuts.
  for (const [dx, dy] of [[-1.8, 1.5], [1.6, 1.8], [0, 3]]) {
    c.fillStyle = '#5e3b1c';
    c.beginPath();
    c.arc(topX + dx, topY + dy, 1.6, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(255, 255, 255, 0.25)';
    c.beginPath();
    c.arc(topX + dx - 0.5, topY + dy - 0.5, 0.5, 0, Math.PI * 2);
    c.fill();
  }

  // Fronds: long drooping leaves radiating from the crown, swaying slightly.
  const sway = Math.sin(time / 900 + x) * 0.05;
  const fronds = [-3.05, -2.6, -2.15, -1.75, -1.4, -1.0, -0.55, -0.1, 0.35];
  fronds.forEach((base, i) => {
    const a = base + sway;
    const len = 16 + (i % 3) * 3;
    const droop = 7 + (i % 2) * 2;
    const ex = topX + Math.cos(a) * len, ey = topY + Math.sin(a) * len * 0.55 + droop;
    const mx = topX + Math.cos(a) * len * 0.5, my = topY + Math.sin(a) * len * 0.55 - 3;
    const nx = -Math.sin(a), ny = Math.cos(a);
    const leaf = c.createLinearGradient(topX, topY, ex, ey);
    leaf.addColorStop(0, '#2f8a3b');
    leaf.addColorStop(1, '#6cc757');
    c.fillStyle = leaf;
    c.beginPath();
    c.moveTo(topX, topY);
    c.quadraticCurveTo(mx + nx * 5, my + ny * 5, ex, ey);
    c.quadraticCurveTo(mx - nx * 2.2, my - ny * 2.2 + 2.5, topX, topY + 1.5);
    c.closePath();
    c.fill();
    c.strokeStyle = '#1f6a2c'; // midrib
    c.lineWidth = 0.5;
    c.beginPath();
    c.moveTo(topX, topY);
    c.quadraticCurveTo(mx + nx * 1, my + ny * 1, ex, ey);
    c.stroke();
  });
  // Bright highlight on the top leaves.
  c.fillStyle = 'rgba(190, 240, 150, 0.35)';
  c.beginPath();
  c.ellipse(topX, topY - 2, 6, 2, 0, 0, Math.PI * 2);
  c.fill();
}
