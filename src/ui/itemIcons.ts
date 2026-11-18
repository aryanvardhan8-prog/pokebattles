// Item pictures for the bag, drawn as vector art (no image files needed).
// Each icon is drawn in a 16×16 box and scaled to the size asked for.

type Ctx = CanvasRenderingContext2D;

const OUTLINE = '#2a2e3a';

/** Spray bottle (the potions): grey nozzle, coloured body, white label. */
function spray(c: Ctx, body: string, band: string, label = '#ffffff') {
  c.fillStyle = '#9aa3b2'; // trigger and nozzle
  c.beginPath();
  c.roundRect(6, 0.8, 4, 3, 0.8);
  c.fill();
  c.stroke();
  c.fillRect(9.5, 1.6, 2.6, 1.2);
  c.fillStyle = '#d6dbe4';
  c.beginPath();
  c.roundRect(5, 3.4, 6, 2, 0.6);
  c.fill();
  c.stroke();
  c.fillStyle = body;
  c.beginPath();
  c.roundRect(3.2, 5.2, 9.6, 10, 2.4);
  c.fill();
  c.stroke();
  c.fillStyle = band;
  c.fillRect(3.7, 11.6, 8.6, 1.4);
  c.fillStyle = label;
  c.beginPath();
  c.roundRect(5, 7.2, 6, 3.6, 0.8);
  c.fill();
  shine(c, 4.6, 6.4, 7);
}

/** Small medicine bottle (status cures): cork, coloured liquid. */
function bottle(c: Ctx, liquid: string, cap = '#c99a5a') {
  c.fillStyle = cap;
  c.beginPath();
  c.roundRect(6, 1, 4, 3, 0.8);
  c.fill();
  c.stroke();
  c.fillStyle = 'rgba(235,245,255,0.95)';
  c.beginPath();
  c.moveTo(6.4, 4);
  c.lineTo(9.6, 4);
  c.lineTo(9.6, 6);
  c.quadraticCurveTo(13.5, 7.5, 13.2, 11.5);
  c.quadraticCurveTo(13, 15.2, 8, 15.2);
  c.quadraticCurveTo(3, 15.2, 2.8, 11.5);
  c.quadraticCurveTo(2.5, 7.5, 6.4, 6);
  c.closePath();
  c.fill();
  c.stroke();
  c.save();
  c.clip();
  c.fillStyle = liquid;
  c.fillRect(0, 9, 16, 8);
  c.restore();
  shine(c, 4.4, 8.2, 4.5);
}

/** Wide jar (Ether / Elixer). */
function jar(c: Ctx, liquid: string, lid: string) {
  c.fillStyle = lid;
  c.beginPath();
  c.roundRect(3.4, 1.5, 9.2, 3.2, 1);
  c.fill();
  c.stroke();
  c.fillStyle = 'rgba(235,245,255,0.95)';
  c.beginPath();
  c.roundRect(2.6, 4.6, 10.8, 10.6, 2.6);
  c.fill();
  c.stroke();
  c.save();
  c.clip();
  c.fillStyle = liquid;
  c.fillRect(0, 7.5, 16, 9);
  c.restore();
  c.fillStyle = 'rgba(255,255,255,0.85)';
  for (const [x, y] of [[6, 10], [9.5, 12.5], [8, 9]]) {
    c.beginPath();
    c.arc(x, y, 0.8, 0, Math.PI * 2);
    c.fill();
  }
  shine(c, 4, 6, 7);
}

function shine(c: Ctx, x: number, y: number, h: number) {
  c.strokeStyle = 'rgba(255,255,255,0.75)';
  c.lineWidth = 0.9;
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x, y + h);
  c.stroke();
  c.strokeStyle = OUTLINE;
  c.lineWidth = 0.7;
}

function cross(c: Ctx, x: number, y: number, s: number, color: string) {
  c.fillStyle = color;
  c.fillRect(x - s / 2, y - s / 6, s, s / 3);
  c.fillRect(x - s / 6, y - s / 2, s / 3, s);
}

/** Bold letter on an icon. */
function letter(c: Ctx, ch: string, x: number, y: number, color: string, size = 4.2) {
  c.font = `900 ${size}px Nunito, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.fillStyle = color;
  c.fillText(ch, x, y + 0.3 + 0.2413 * size);
}

const X_COLORS: Record<string, string> = {
  'X ATTACK': '#e8553a', 'X DEFEND': '#e8b500', 'X SPEED': '#f0567f', 'X SPECIAL': '#5b8df0', 'X ACCURACY': '#4fb06a',
};

/** Draws an item's picture with its top-left at (x, y), `size` game pixels square. */
export function drawItemIcon(c: Ctx, item: string, x: number, y: number, size: number) {
  c.save();
  c.translate(x, y);
  c.scale(size / 16, size / 16);
  c.imageSmoothingEnabled = true;
  c.strokeStyle = OUTLINE;
  c.lineWidth = 0.7;
  c.lineJoin = 'round';
  switch (item) {
    case 'POTION': spray(c, '#9b5fd6', '#6b3aa6'); cross(c, 8, 9, 3, '#9b5fd6'); break;
    case 'SUPER POTION': spray(c, '#f2c230', '#c98f10'); cross(c, 8, 9, 3, '#e8553a'); break;
    case 'HYPER POTION': spray(c, '#ef5f9a', '#b8306a'); cross(c, 8, 9, 3, '#ef5f9a'); break;
    case 'MAX POTION': spray(c, '#4f8fe8', '#2a5fb0'); cross(c, 8, 9, 3, '#4f8fe8'); break;
    case 'FULL RESTORE': spray(c, '#f2c230', '#4fb06a'); cross(c, 8, 9, 3, '#4fb06a'); break;
    case 'FULL HEAL': spray(c, '#f6e27a', '#d8b830', '#fff8d8'); letter(c, '+', 8, 9, '#e8553a', 5); break;
    case 'GUARD SPEC.': { // spray with a shield on the label
      spray(c, '#4fc0b0', '#2a8a7a');
      c.fillStyle = '#2a8a7a';
      c.beginPath();
      c.moveTo(6.2, 7.6);
      c.lineTo(9.8, 7.6);
      c.lineTo(9.8, 9);
      c.quadraticCurveTo(9.6, 10.4, 8, 10.8);
      c.quadraticCurveTo(6.4, 10.4, 6.2, 9);
      c.closePath();
      c.fill();
      break;
    }
    case 'DIRE HIT': { // spray with a target on the label
      spray(c, '#e8553a', '#a8301a');
      for (const [r, col] of [[1.7, '#e8553a'], [1, '#ffffff'], [0.45, '#e8553a']] as const) {
        c.fillStyle = col;
        c.beginPath();
        c.arc(8, 9, r, 0, Math.PI * 2);
        c.fill();
      }
      break;
    }
    case 'ANTIDOTE': bottle(c, '#a24bc9'); break;
    case 'PARLYZ HEAL': bottle(c, '#f2c230'); break;
    case 'AWAKENING': bottle(c, '#4f8fe8'); break;
    case 'BURN HEAL': bottle(c, '#e8553a'); break;
    case 'ICE HEAL': bottle(c, '#8fdcf0'); break;
    case 'ETHER': jar(c, '#5bb0f0', '#2a5fb0'); break;
    case 'ELIXER': jar(c, '#f07ab8', '#b8306a'); break;
    case 'REVIVE': { // the golden diamond crystal
      c.fillStyle = '#f6d23a';
      c.beginPath();
      c.moveTo(8, 1.5);
      c.lineTo(14, 8);
      c.lineTo(8, 14.5);
      c.lineTo(2, 8);
      c.closePath();
      c.fill();
      c.stroke();
      c.fillStyle = '#fff3a0';
      c.beginPath();
      c.moveTo(8, 4);
      c.lineTo(11, 8);
      c.lineTo(8, 12);
      c.lineTo(5, 8);
      c.closePath();
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.9)';
      c.beginPath();
      c.moveTo(6.2, 6.4);
      c.lineTo(7.4, 5.2);
      c.lineTo(7.4, 7.6);
      c.closePath();
      c.fill();
      break;
    }
    default: {
      const col = X_COLORS[item];
      if (col) { // X items: a bottle with a big X on a coloured label
        bottle(c, col, '#9aa3b2');
        c.fillStyle = '#ffffff';
        c.beginPath();
        c.arc(8, 11.4, 2.6, 0, Math.PI * 2);
        c.fill();
        letter(c, 'X', 8, 11.4, col, 4.4);
      } else { // unknown: a Poké Ball
        c.fillStyle = '#ffffff';
        c.beginPath();
        c.arc(8, 8, 6.5, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#e8553a';
        c.beginPath();
        c.arc(8, 8, 6.5, Math.PI, 0);
        c.fill();
        c.beginPath();
        c.arc(8, 8, 6.5, 0, Math.PI * 2);
        c.stroke();
      }
    }
  }
  c.restore();
}

/** What kind of item it is, shown as a little tag. */
export function itemKind(item: string): {label: string; color: string} {
  if (item.includes('POTION') || item === 'FULL RESTORE') return {label: 'HEAL HP', color: '#4fb06a'};
  if (item === 'REVIVE') return {label: 'REVIVE', color: '#d8a010'};
  if (item === 'ETHER' || item === 'ELIXER') return {label: 'PP', color: '#5b8df0'};
  if (item.startsWith('X ') || item === 'GUARD SPEC.' || item === 'DIRE HIT') return {label: 'BATTLE', color: '#e8553a'};
  return {label: 'CURE', color: '#a24bc9'};
}
