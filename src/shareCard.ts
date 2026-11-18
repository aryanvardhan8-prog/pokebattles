// Picture cards for sharing results (1080×1350, good for chats and stories): the daily Red battle and
// the Elite Four run. On phones they're attached to the share sheet; on laptops they're saved as a file.

import {SPECIES} from './engine/data';
import {SUPABASE_URL, SUPABASE_KEY} from './config';

export interface CardInfo {
  theme: 'red' | 'elite';
  eyebrow: string; // "DAY #7 · HARD"
  title: string; // "Victory!"
  sub: string; // "Beat Red with 4 of 6 left"
  facts: [string, string][]; // [value, label]
  team: {species: string; hp: number}[];
  rooms?: boolean[]; // Elite Four: rooms won (5)
  user?: string;
}

const loadImg = (src: string) => new Promise<HTMLImageElement | null>(res => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = () => res(null);
  img.src = src;
});

export async function resultCard(d: CardInfo): Promise<Blob | null> {
  await document.fonts.ready;
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  const display = '"Plus Jakarta Sans", "Nunito", sans-serif';
  const body = '"Nunito", sans-serif';
  const base = import.meta.env.BASE_URL;
  const [c1, c2] = d.theme === 'elite' ? ['#7b4fe0', '#4a2a9a'] : ['#ef3e3a', '#c41e25'];
  const pics = await Promise.all(d.team.map(m => loadImg(`${base}sprites/ani/${m.species}.gif`)));
  const trainer = await loadImg(`${base}sprites/trainers/${d.theme === 'elite' ? 'e4-blue' : 'red-hd'}.png`);

  c.fillStyle = '#f4f4f6';
  c.fillRect(0, 0, W, H);
  // Card with a coloured top.
  const x0 = 60, y0 = 60, w = W - 120, h = H - 120, top = 560;
  c.save();
  c.shadowColor = 'rgba(17,17,20,0.22)';
  c.shadowBlur = 50;
  c.shadowOffsetY = 20;
  c.beginPath(); c.roundRect(x0, y0, w, h, 56); c.fillStyle = '#fff'; c.fill();
  c.restore();
  c.save();
  c.beginPath(); c.roundRect(x0, y0, w, h, 56); c.clip();
  const g = c.createLinearGradient(0, y0, 0, top);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  c.fillStyle = g;
  c.fillRect(x0, y0, w, top - y0);
  c.strokeStyle = 'rgba(255,255,255,0.1)';
  c.lineWidth = 40;
  c.beginPath(); c.arc(x0 + w - 60, y0 + 80, 220, 0, Math.PI * 2); c.stroke();
  if (trainer) { // the opponent, faded on the right
    const th = 420, tw = (trainer.width / trainer.height) * th;
    c.globalAlpha = 0.28;
    c.imageSmoothingEnabled = false;
    c.drawImage(trainer, x0 + w - tw - 30, top - th, tw, th);
    c.globalAlpha = 1;
  }
  c.restore();

  c.fillStyle = '#fff';
  c.font = `800 40px ${display}`;
  c.fillText('DAILY', x0 + 64, y0 + 100);
  const dw = c.measureText('DAILY').width;
  c.fillStyle = 'rgba(255,255,255,0.7)';
  c.fillText('BATTLES', x0 + 64 + dw, y0 + 100);
  c.fillStyle = 'rgba(255,255,255,0.85)';
  c.font = `900 30px ${body}`;
  c.fillText(d.eyebrow.toUpperCase(), x0 + 64, y0 + 170);
  c.fillStyle = '#fff';
  c.font = `800 128px ${display}`;
  c.fillText(d.title, x0 + 60, y0 + 300, w - 140);
  c.font = `800 40px ${body}`;
  c.fillText(d.sub, x0 + 64, y0 + 370, w - 140);
  if (d.user) { c.font = `700 32px ${body}`; c.fillStyle = 'rgba(255,255,255,0.85)'; c.fillText(d.user, x0 + 64, y0 + 430, w - 140); }

  // Elite Four: five room dots.
  if (d.rooms) {
    const names = ['Lorelei', 'Bruno', 'Agatha', 'Lance', 'Blue'];
    names.forEach((n, i) => {
      const cx = x0 + 120 + i * 185, cy = top + 70;
      c.beginPath(); c.arc(cx, cy, 34, 0, Math.PI * 2);
      c.fillStyle = d.rooms![i] ? '#1f8a4c' : i === d.rooms!.length ? '#e3262e' : '#e2e2e8';
      c.fill();
      c.fillStyle = '#fff'; c.textAlign = 'center'; c.font = `900 34px ${body}`;
      c.fillText(d.rooms![i] ? '✓' : i === d.rooms!.length ? '✕' : '', cx, cy + 12);
      c.fillStyle = '#44444f'; c.font = `800 26px ${body}`;
      c.fillText(n, cx, cy + 74);
      c.textAlign = 'left';
    });
  }

  // Facts row.
  const fy = d.rooms ? top + 190 : top + 70;
  const fw = (w - 128) / d.facts.length;
  d.facts.forEach(([v, l], i) => {
    const fx = x0 + 64 + i * fw;
    c.fillStyle = '#f4f4f6';
    c.beginPath(); c.roundRect(fx + 6, fy, fw - 12, 150, 28); c.fill();
    c.fillStyle = '#14141a'; c.textAlign = 'center';
    c.font = `800 64px ${display}`;
    c.fillText(v, fx + fw / 2, fy + 82);
    c.fillStyle = '#6a6a78'; c.font = `900 24px ${body}`;
    c.fillText(l.toUpperCase(), fx + fw / 2, fy + 124);
    c.textAlign = 'left';
  });

  // The team: six pictures with HP bars.
  const ty = fy + (d.rooms ? 172 : 190), cell = (w - 128) / 6;
  d.team.slice(0, 6).forEach((m, i) => {
    const cx = x0 + 64 + i * cell + cell / 2;
    const img = pics[i];
    c.save();
    if (m.hp === 0) c.globalAlpha = 0.35;
    if (img) {
      const s = Math.min(130 / img.width, 130 / img.height, 2.2);
      c.imageSmoothingEnabled = false;
      c.drawImage(img, cx - (img.width * s) / 2, ty + 140 - img.height * s, img.width * s, img.height * s);
    }
    c.restore();
    c.fillStyle = '#e2e2e8';
    c.beginPath(); c.roundRect(cx - 55, ty + 160, 110, 14, 7); c.fill();
    c.fillStyle = m.hp === 0 ? '#e2e2e8' : m.hp > 50 ? '#1f8a4c' : m.hp > 20 ? '#e0a100' : '#e3262e';
    c.beginPath(); c.roundRect(cx - 55, ty + 160, Math.max(0, 110 * (m.hp / 100)), 14, 7); c.fill();
    c.fillStyle = '#44444f'; c.textAlign = 'center'; c.font = `800 22px ${body}`;
    c.fillText(m.hp === 0 ? 'Fainted' : (SPECIES[m.species]?.name ?? m.species).slice(0, 10), cx, ty + 208);
    c.textAlign = 'left';
  });

  c.fillStyle = '#14141a';
  c.textAlign = 'center';
  c.font = `800 38px ${display}`;
  c.fillText(d.theme === 'elite' ? 'Can you beat the Elite Four?' : 'Can you beat Red?', W / 2, H - 150);
  c.fillStyle = '#6a6a78';
  c.font = `800 30px ${body}`;
  c.fillText(location.host || 'dailybattles.netlify.app', W / 2, H - 104);
  return new Promise(res => cv.toBlob(b => res(b), 'image/png'));
}

/** Uploads the picture (card function) and returns a short link to it on this site: /c/<id>.png. */
async function uploadCard(blob: Blob, title: string, text: string): Promise<string | null> {
  try {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const res = await fetch(`${SUPABASE_URL}/functions/v1/card`, {
      method: 'POST', headers: {apikey: SUPABASE_KEY, 'Content-Type': 'application/json'},
      body: JSON.stringify({png: btoa(bin), title, text, site: location.origin}),
    });
    if (!res.ok) return null;
    const {id} = await res.json();
    return `${location.origin}/c/${id}.png`;
  } catch { return null; }
}

/** Phones: the share sheet with the picture attached. Laptops (or no file sharing): uploads the picture and
 *  copies the message with a link to it (chat apps show the picture from the link). */
export async function shareCard(card: CardInfo, text: string): Promise<string> {
  const blob = await resultCard(card);
  if (!blob) return 'Could not make the picture.';
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      const file = new File([blob], 'dailybattles.png', {type: 'image/png'});
      if (navigator.canShare?.({files: [file]})) { await navigator.share({files: [file], text}); return 'Shared!'; }
    }
    const link = await uploadCard(blob, card.title, card.sub);
    const msg = link ? `${text}\n${link}` : text;
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({text: msg}); return 'Shared!'; }
    await navigator.clipboard.writeText(msg);
    return link ? 'Copied! Paste it in any chat: the link shows your picture.' : 'Copied the text (the picture couldn’t be uploaded).';
  } catch (e) {
    return (e as Error).name === 'AbortError' ? '' : 'Could not share. Try again.';
  }
}
