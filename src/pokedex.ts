// Developer reference page: every Pokémon in the game with its sprites, base stats and moves.
// Open at /pokedex.html while `npm run dev` is running. Not part of the public build.

import {SPECIES, MOVES, LEARNSETS, LEVEL_MOVES} from './engine/data';
import {WEAK_SPECIES} from './engine/daily';
import {redUrl} from './ui/gfx';
import {loadAni, aniFrame, aniUrl, type Ani} from './ui/ani';

const TYPE_COLORS: Record<string, string> = {
  Normal: '#a8a878', Fire: '#f08030', Water: '#6890f0', Grass: '#78c850', Electric: '#d8b800', Ice: '#78c8c8',
  Fighting: '#c03028', Poison: '#a040a0', Ground: '#c8a048', Flying: '#a890f0', Psychic: '#f85888',
  Bug: '#a8b820', Rock: '#b8a038', Ghost: '#705898', Dragon: '#7038f8',
};
const STATS = [['hp', 'HP'], ['atk', 'Attack'], ['def', 'Defense'], ['spc', 'Special'], ['spe', 'Speed']] as const;

const mons = Object.entries(SPECIES).map(([id, s]) => {
  const total = s.base.hp + s.base.atk + s.base.def + s.base.spc + s.base.spe;
  return {id, ...s, total};
});

const moveChip = (id: string) => {
  const m = MOVES[id];
  const power = m.power > 1 ? m.power : m.ohko ? 'KO' : '–';
  return `<span class="mv" style="border-left:4px solid ${TYPE_COLORS[m.type] ?? '#999'}" title="${m.type} · power ${power} · acc ${m.acc ?? '–'} · ${m.pp} PP">${m.name} <b>${power}</b></span>`;
};

function card(m: (typeof mons)[number]) {
  const natural = LEVEL_MOVES[m.id];
  const tms = LEARNSETS[m.id].filter(x => !natural.includes(x));
  const bars = STATS.map(([k, label]) => {
    const v = m.base[k];
    const hue = Math.min(120, v * 0.9);
    return `<tr><td>${label}</td><td><div class="bar"><i style="width:${Math.min(100, (v / 160) * 100)}%;background:hsl(${hue} 70% 45%)"></i></div></td><td class="v">${v}</td></tr>`;
  }).join('');
  return `<article class="card">
    <div class="top">
      <canvas class="front" data-id="${m.id}" data-side="front" width="224" height="224" aria-label="${m.name} front"></canvas>
      <canvas class="back" data-id="${m.id}" data-side="back" width="128" height="128" aria-label="${m.name} back"></canvas>
    </div>
    <p class="name"><span class="num">#${String(m.num).padStart(3, '0')}</span> ${m.name} <span class="num">${m.height} m</span></p>
    <div class="types">${m.types.map(t => `<span class="type" style="background:${TYPE_COLORS[t]}">${t}</span>`).join('')}
      ${WEAK_SPECIES.has(m.id) ? '<span class="tag" title="Fewer than 2 attacking moves: appears less often, max 1 per team">rare pick</span>' : ''}</div>
    <table>${bars}<tr><td>Total</td><td></td><td class="v"><b>${m.total}</b></td></tr></table>
    <details><summary>Level-up moves (${natural.length})</summary><div class="moves">${natural.map(moveChip).join('')}</div></details>
    <details><summary>TM / HM moves (${tms.length})</summary><div class="moves">${tms.map(moveChip).join('')}</div></details>
  </article>`;
}

const q = document.getElementById('q') as HTMLInputElement;
const typeSel = document.getElementById('type') as HTMLSelectElement;
const sortSel = document.getElementById('sort') as HTMLSelectElement;
Object.keys(TYPE_COLORS).forEach(t => typeSel.add(new Option(t, t)));

function render() {
  const text = q.value.trim().toUpperCase();
  const type = typeSel.value;
  const key = sortSel.value;
  const list = mons
    .filter(m => !type || m.types.includes(type))
    .filter(m => !text || m.name.includes(text) || m.types.some(t => t.toUpperCase().includes(text))
      || LEARNSETS[m.id].some(id => MOVES[id].name.includes(text)))
    .sort((a, b) => key === 'num' ? a.num - b.num : key === 'height' ? a.height - b.height : key === 'total' ? b.total - a.total : b.base[key as 'hp'] - a.base[key as 'hp']);
  document.getElementById('grid')!.innerHTML = list.map(card).join('');
  document.getElementById('count')!.textContent = `${list.length} of 151`;
  void drawSprites();
}

/** Animated 3D models, same files the game uses. Kept at their real relative sizes. */
const anis = new Map<HTMLCanvasElement, Ani>();
async function drawSprites() {
  anis.clear();
  const canvases = [...document.querySelectorAll<HTMLCanvasElement>('#grid canvas')];
  await Promise.all(canvases.map(async cv => {
    const ani = await loadAni(aniUrl(cv.dataset.id!, cv.dataset.side === 'back'));
    if (ani) anis.set(cv, ani);
  }));
}
function animate() {
  const now = performance.now();
  for (const [cv, ani] of anis) {
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const k = Math.min(1.1, cv.width / ani.width, cv.height / ani.height);
    const w = ani.width * k, h = ani.height * k;
    ctx.drawImage(aniFrame(ani, now), (cv.width - w) / 2, cv.height - h, w, h);
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

[q, typeSel, sortSel].forEach(el => el.addEventListener('input', render));
render();

// The rest of the game's graphics.
const other: [string, string, number][] = [
  [redUrl, 'Red (trainer, battle intro)', 2],
  ['icons/icon-192.png', 'App icon', 1],
  ['icons/og.png', 'Link preview image', 0.3],
];
document.getElementById('other')!.innerHTML = other.map(([src, label, scale]) =>
  `<figure><img src="${src}" style="zoom:${scale}" alt=""><figcaption>${label}</figcaption></figure>`).join('')
  + '<figure><figcaption style="max-width:220px">Island tiles, the player and Red on the island, menus, HP bars and Pokéballs are drawn by the game\'s code (src/ui/island.ts, gfx.ts), not image files.</figcaption></figure>';
