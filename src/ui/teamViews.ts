// Party list, stats pages and item info, shared by the island and the battle.

import type {BMon} from '../engine/battle';
import {SPECIES, MOVES} from '../engine/data';
import {Gfx, C, sizedSprite, iconSprite, textWidth, wrap} from './gfx';
import {drawItemIcon, itemKind} from './itemIcons';
import {getAni, aniFrame, aniUrl} from './ani';

export const TYPE_COLORS: Record<string, string> = {
  Normal: '#9a9a7a', Fire: '#ee7a30', Water: '#5b8df0', Grass: '#5fb94a', Electric: '#e8b500', Ice: '#5cc3c3',
  Fighting: '#c03028', Poison: '#9d43a0', Ground: '#c9a047', Flying: '#8f7fe8', Psychic: '#f0567f',
  Bug: '#97ab1e', Rock: '#b09a3a', Ghost: '#6a5294', Dragon: '#6a3ff0', '???': '#7d8a99',
};

// Official type badges (Pokémon Scarlet/Violet style), loaded once.
const TYPE_BADGES: Record<string, HTMLImageElement> = {};
for (const t of Object.keys(TYPE_COLORS)) {
  if (t === '???') continue;
  const img = new Image();
  img.src = `${import.meta.env.BASE_URL}types/${t}.png`;
  TYPE_BADGES[t] = img;
}
const badge = (type: string) => {
  const img = TYPE_BADGES[type] ?? TYPE_BADGES.Normal;
  return img && img.complete && img.naturalWidth ? img : null;
};

/** Official type badge (symbol + name), h game pixels tall. Returns its width. */
export function typePill(g: Gfx, x: number, y: number, type: string, h = 8): number {
  const img = badge(type);
  const w = h * 5;
  if (img) {
    g.ctx.save();
    g.ctx.imageSmoothingEnabled = true;
    g.ctx.imageSmoothingQuality = 'high';
    g.image(img, x, y, w, h);
    g.ctx.restore();
  } else {
    g.pill(x, y, w, h, TYPE_COLORS[type] ?? '#888', h / 2.5);
    g.smallText(type.toUpperCase(), x + 3, y + h * 0.15, '#ffffff', h * 0.7);
  }
  return w;
}

/** Just the official type symbol, in its coloured circle. */
export function typeIcon(g: Gfx, x: number, y: number, size: number, type: string) {
  const img = badge(type);
  const c = g.ctx;
  c.save();
  c.beginPath();
  c.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  c.clip();
  if (img) {
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    // The symbol is centred at about (30, 20) in the 200×40 badge (~30px wide): crop a square around it
    // (on the badge's own colour) and show it in a circle.
    c.fillStyle = TYPE_COLORS[type] ?? '#888';
    c.fillRect(x, y, size, size);
    c.drawImage(img, 12, 2, 36, 36, x, y, size, size);
  } else {
    c.fillStyle = TYPE_COLORS[type] ?? '#888';
    c.fillRect(x, y, size, size);
  }
  c.restore();
}

export const STATUS_LABEL: Record<string, string> = {slp: 'SLP', psn: 'PSN', brn: 'BRN', frz: 'FRZ', par: 'PAR'};

export const FIXED_POWER: Record<string, string> = {
  seismictoss: '=LV', nightshade: '=LV', sonicboom: '20HP', dragonrage: '40HP',
  superfang: '1/2', psywave: '???', counter: 'x2', bide: 'x2',
};

export function powerLabel(id: string): string {
  const m = MOVES[id];
  return FIXED_POWER[id] ?? (m.ohko ? 'KO' : m.power > 1 ? String(m.power) : '-');
}

export const ITEM_INFO: Record<string, string> = {
  'POTION': 'Heals 20 HP.',
  'SUPER POTION': 'Heals 50 HP.',
  'HYPER POTION': 'Heals 200 HP.',
  'MAX POTION': 'Heals all HP.',
  'FULL RESTORE': 'Heals all HP and status.',
  'REVIVE': 'Revives a fainted POKÉMON to half HP.',
  'FULL HEAL': 'Cures any status.',
  'ANTIDOTE': 'Cures poison.',
  'PARLYZ HEAL': 'Cures paralysis.',
  'AWAKENING': 'Wakes a sleeping POKÉMON.',
  'BURN HEAL': 'Cures a burn.',
  'ICE HEAL': 'Thaws a frozen POKÉMON.',
  'X ATTACK': 'Raises ATTACK in battle.',
  'X DEFEND': 'Raises DEFENSE in battle.',
  'X SPEED': 'Raises SPEED in battle.',
  'X SPECIAL': 'Raises SPECIAL in battle.',
  'X ACCURACY': 'Your moves always hit.',
  'GUARD SPEC.': 'Stops stat drops.',
  'DIRE HIT': 'Pumps up! (Gen 1 bug: lowers crits)',
  'ETHER': 'Restores 10 PP of one move.',
  'ELIXER': 'Restores 10 PP of all moves.',
};

function ballIcon(g: Gfx, x: number, y: number, active: boolean) {
  g.rect(x + 1, y, 4, 1, C.ink);
  g.rect(x, y + 1, 6, 4, active ? C.hpRed : C.ink);
  g.rect(x + 1, y + 5, 4, 1, C.ink);
  g.rect(x + 1, y + 3, 4, 1, C.bg);
}

/** Gen 1 party list (top 12 tile rows), with a mini picture of each Pokémon.
 *  The highlighted one hops, like the Gen 1 menu icons. */
export function drawPartyRows(g: Gfx, team: BMon[], cursor: number, active: number | null, hollow = false,
  sprite: (species: string) => HTMLCanvasElement | null = () => null, frame = 0) {
  team.forEach((m, i) => {
    const y = i * 16;
    const selected = i === cursor;
    // One rounded card per Pokémon; the selected one is gold, the one in battle has a blue stripe.
    g.panel(9, y + 0.5, 150, 15, {
      fill: selected ? '#fff3c4' : m.hp === 0 ? '#eceef2' : '#ffffff',
      accent: i === active ? C.accentBlue : undefined,
      radius: 3,
    });
    const ani = getAni(aniUrl(m.species));
    const pic = ani ? ani.first : sprite(m.species);
    if (pic) {
      const hop = selected && !hollow && m.hp > 0 && Math.floor(frame / 8) % 2 === 0 ? -1 : 0;
      g.image(iconSprite(pic, `${ani ? 'ani' : 'gb'}icon:${m.species}`), 13, y + hop, 15, 15);
    } else {
      ballIcon(g, 17, y + 4, i === active);
    }
    g.text(SPECIES[m.species].name, 31, y + 1, m.hp === 0 ? C.light : C.ink);
    const tag = m.hp === 0 ? 'FNT' : m.status ? STATUS_LABEL[m.status] : `Lv${m.level}`;
    g.textRight(tag, 155, y + 1, m.hp === 0 ? C.hpRed : m.status ? C.accentRed : C.ink);
    g.hpBar(44, y + 9.5, m.hp, m.maxHp, 64);
    g.textRight(`${m.hp}/${m.maxHp}`, 155, y + 8);
    if (selected) (hollow ? g.hollowCursor(0, y + 4) : g.cursor(0, y + 4));
  });
}

export const STATS_PAGES = 2;

const STAT_COLORS: Record<string, string> = {ATTACK: '#ee7a30', DEFENSE: '#e8b500', SPEED: '#f0567f', SPECIAL: '#5b8df0'};

/** Summary pages: 0 = picture + stats, 1 = moves (type badge, power, accuracy, PP). */
export function drawStatsPage(g: Gfx, m: BMon, page: number, sprite: HTMLCanvasElement | null, frame: number) {
  const sp = SPECIES[m.species];
  const ani = getAni(aniUrl(m.species));
  if (page === 0) {
    // Top card: picture on a little sand platform, name, level, types, HP, status.
    g.panel(4, 4, 152, 66, {accent: C.accentBlue, radius: 5});
    g.pill(9, 9, 52, 56, '#e3eefb', 4);
    g.ctx.save();
    g.ctx.fillStyle = '#f2dfa9';
    g.ctx.beginPath();
    g.ctx.ellipse(35, 58, 20, 4, 0, 0, Math.PI * 2);
    g.ctx.fill();
    g.ctx.restore();
    if (ani) {
      const k = Math.min(0.62, 48 / ani.height, 48 / ani.width);
      const w = ani.width * k, h = ani.height * k;
      g.ctx.save();
      g.ctx.imageSmoothingEnabled = true;
      g.ctx.imageSmoothingQuality = 'high';
      g.image(aniFrame(ani, performance.now()), 35 - w / 2, 59 - h, w, h);
      g.ctx.restore();
    } else if (sprite) {
      g.image(sizedSprite(sprite, sp.height, 48, `stats:${m.species}`), 11, 10, 48, 48);
    }
    g.text(sp.name, 66, 8);
    g.textRight(`Lv${m.level}`, 151, 8);
    g.smallText(`No.${String(sp.num).padStart(3, '0')}`, 66, 17, C.light, 5);
    let tx = 66;
    for (const t of sp.types) tx += typePill(g, tx, 24, t, 8) + 3;
    g.hpBar(80, 38, m.hp, m.maxHp, 70);
    g.textRight(`${m.hp}/${m.maxHp}`, 151, 45);
    const status = m.hp === 0 ? 'FAINTED' : m.status ? STATUS_LABEL[m.status] : 'HEALTHY';
    const sw = g.smallWidth(status, 5.5) + 6;
    g.pill(66, 56, sw, 8, m.hp === 0 || m.status ? C.accentRed : C.hpGreen, 3);
    g.smallText(status, 69, 57.3, '#ffffff', 5.5);

    // Stats card with coloured bars.
    g.panel(4, 74, 152, 66, {radius: 5});
    const rows: [string, number][] = [['ATTACK', m.stats.atk], ['DEFENSE', m.stats.def], ['SPEED', m.stats.spe], ['SPECIAL', m.stats.spc]];
    rows.forEach(([label, val], i) => {
      const y = 81 + i * 14;
      g.smallText(label, 11, y + 0.5, C.ink, 6);
      g.pill(56, y + 1.5, 72, 5, '#e9edf3', 2.5);
      g.pill(56, y + 1.5, Math.max(4, Math.min(72, (val / 260) * 72)), 5, STAT_COLORS[label], 2.5);
      g.textRight(String(val), 151, y);
    });
  } else {
    // Header with a mini picture, then one card per move.
    g.panel(4, 3, 152, 15, {accent: C.accentBlue, radius: 4});
    const pic = ani ? ani.first : sprite;
    if (pic) g.image(iconSprite(pic, `${ani ? 'ani' : 'gb'}icon:${m.species}`), 9, 3, 14, 14);
    g.text(sp.name, 26, 5);
    g.smallText('MOVES', 151 - g.smallWidth('MOVES', 6), 6, C.light, 6);
    m.moves.forEach((id, i) => {
      const mv = MOVES[id];
      const y = 21 + i * 30;
      g.panel(4, y, 152, 27, {accent: TYPE_COLORS[mv.type] ?? '#888', radius: 4});
      g.text(mv.name, 10, y + 3);
      g.smallText('PP', 118, y + 4.5, C.light, 5.5);
      g.textRight(`${m.pp[i]}/${m.maxPp[i]}`, 151, y + 3);
      typePill(g, 10, y + 15, mv.type, 8);
      g.smallText('POWER', 70, y + 16.5, C.light, 5);
      g.smallText(powerLabel(id), 90, y + 15.5, C.ink, 6.5);
      g.smallText('ACC', 114, y + 16.5, C.light, 5);
      g.smallText(mv.acc === null ? '—' : `${mv.acc}`, 127, y + 15.5, C.ink, 6.5);
    });
  }
  if (Math.floor(frame / 30) % 2 === 0) g.downArrow(150, 138.5);
}

/** Bag list box (overlay). Returns the row y positions for tap targets. */
/** Rows of the bag shown at once. */
export const BAG_ROWS = 6;

/**
 * The bag: one rounded card per item (picture, name, how many), CANCEL last,
 * and a detail card at the bottom with a big picture and what the item does.
 * Returns the visible rows (card tops) so screens can make them tappable.
 */
export function drawBagList(g: Gfx, bag: Record<string, number>, cursor: number, scroll: number, frame: number, cancelLabel = 'CANCEL'): {i: number; y: number}[] {
  const items = [...Object.keys(bag), cancelLabel];
  const rows: {i: number; y: number}[] = [];
  const c = g.ctx;
  g.clear();
  for (let row = 0; row < BAG_ROWS; row++) {
    const i = scroll + row;
    if (i >= items.length) break;
    const y = row * 16;
    const selected = i === cursor;
    const item = items[i];
    const isCancel = i === items.length - 1;
    g.panel(9, y + 0.5, 150, 15, {fill: selected ? '#fff3c4' : '#ffffff', radius: 3, accent: isCancel ? undefined : itemKind(item).color});
    if (isCancel) {
      g.text(item, 31, y + 4, C.light);
    } else {
      const hop = selected && Math.floor(frame / 8) % 2 === 0 ? -1 : 0;
      drawItemIcon(c, item, 14, y + 1.5 + hop, 12);
      g.text(item, 31, y + 4);
      const count = `x${bag[item]}`;
      const w = textWidth(count) + 6;
      g.pill(155 - w, y + 3.5, w, 9, '#e3eefb', 4.5);
      g.textRight(count, 152, y + 4);
    }
    if (selected) g.cursor(0, y + 4);
    rows.push({i, y});
  }
  if (scroll + BAG_ROWS < items.length && Math.floor(frame / 30) % 2 === 0) g.downArrow(150, 92);
  if (scroll > 0 && Math.floor(frame / 30) % 2 === 0) { // up arrow
    c.save();
    c.fillStyle = C.accentRed;
    c.beginPath();
    c.moveTo(150, 1);
    c.lineTo(154, 5);
    c.lineTo(146, 5);
    c.closePath();
    c.fill();
    c.restore();
  }

  // Detail card for the highlighted item.
  const item = items[cursor];
  const isCancel = cursor === items.length - 1;
  g.panel(2, 98, 156, 44, {accent: isCancel ? C.light : itemKind(item).color, radius: 5});
  if (isCancel) {
    g.text(cancelLabel === 'CLOSE' ? 'Back to the island.' : 'Back to the battle menu.', 10, 116);
    return rows;
  }
  c.save();
  c.fillStyle = '#e3eefb';
  c.beginPath();
  c.arc(24, 120, 15, 0, Math.PI * 2);
  c.fill();
  c.restore();
  drawItemIcon(c, item, 12, 108 + Math.sin(frame / 12) * 0.8, 24);
  g.text(item, 44, 102);
  const kind = itemKind(item);
  const kw = textWidth(kind.label) * 0.75 + 6;
  g.pill(154 - kw, 102.5, kw, 8, kind.color, 4);
  g.smallText(kind.label, 157 - kw, 103.6, '#ffffff', 5.6);
  wrap(ITEM_INFO[item] ?? '', 108).slice(0, 2).forEach((l, k) => g.text(l, 44, 114 + k * 11, '#4a5068'));
  return rows;
}
