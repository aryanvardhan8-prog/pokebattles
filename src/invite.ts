// Invite extras: a QR code of your invite link (friends nearby scan it with their camera)
// and a picture card to send with the link.

import qrcode from 'qrcode-generator';
import {inviteLink} from './profile';
import {currentUser} from './account';
import {flag} from './countries';

/** The QR code as crisp SVG markup (dark modules on white, with a quiet border). */
export function qrSvg(text: string, px = 200): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), q = 2, size = n + q * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  return `<svg class="qr" viewBox="0 0 ${size} ${size}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="QR code for your invite link"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#111114"/></svg>`;
}

// (QR codes are only shown on screen now; the shared card no longer needs one.)
export function drawQr(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), cell = size / n;
  c.fillStyle = '#111114';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) {
    if (qr.isDark(r, k)) c.fillRect(Math.floor(x + k * cell), Math.floor(y + r * cell), Math.ceil(cell), Math.ceil(cell));
  }
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

/** A 1080×1350 challenge card (good for chats and stories): "NAME challenged you to a battle!",
 *  two Pokémon facing off across a VS badge on the Poké Ball band. */
export async function inviteCard(): Promise<Blob | null> {
  const user = currentUser();
  if (!user) return null;
  await document.fonts.ready;
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  const display = '"Plus Jakarta Sans", "Nunito", sans-serif';
  const base = import.meta.env.BASE_URL;
  const [left, right] = await Promise.all([loadImg(`${base}sprites/ani/charizard.gif`), loadImg(`${base}sprites/ani/blastoise.gif`)]);

  c.fillStyle = '#f4f4f6';
  c.fillRect(0, 0, W, H);

  // Poké Ball card: red top, black band, white bottom.
  const cx = 70, cy = 70, cw = W - 140, ch = H - 140, band = 700;
  c.save();
  c.shadowColor = 'rgba(17,17,20,0.25)';
  c.shadowBlur = 60;
  c.shadowOffsetY = 24;
  roundRect(c, cx, cy, cw, ch, 56);
  c.fillStyle = '#fff';
  c.fill();
  c.restore();
  c.save();
  roundRect(c, cx, cy, cw, ch, 56);
  c.clip();
  const red = c.createLinearGradient(0, cy, 0, band);
  red.addColorStop(0, '#ef3e3a');
  red.addColorStop(1, '#e3262e');
  c.fillStyle = red;
  c.fillRect(cx, cy, cw, band - cy);
  c.fillStyle = '#111114';
  c.fillRect(cx, band - 12, cw, 24);
  c.strokeStyle = 'rgba(255,255,255,0.12)';
  c.lineWidth = 40;
  c.beginPath();
  c.arc(cx + cw - 40, cy + 60, 210, 0, Math.PI * 2);
  c.stroke();
  c.restore();

  // Headline.
  c.fillStyle = '#fff';
  c.textBaseline = 'alphabetic';
  c.font = `800 44px ${display}`;
  c.fillText('DAILYBATTLES', cx + 70, cy + 110);
  c.font = `800 100px ${display}`;
  c.fillText(`${user.username}${user.country ? ' ' + flag(user.country) : ''}`, cx + 70, cy + 270, cw - 140);
  c.font = `800 66px ${display}`;
  c.fillText('challenged you', cx + 70, cy + 365, cw - 140);
  c.fillText('to a battle!', cx + 70, cy + 445, cw - 140);
  c.font = `700 36px "Nunito", sans-serif`;
  c.fillStyle = 'rgba(255,255,255,0.9)';
  c.fillText('Pick your team. Battle head to head.', cx + 70, cy + 515);

  // Two Pokémon facing off, with a VS badge on the band.
  const ground = H - 210;
  // Heights chosen so both look their real size (Charizard's picture has lots of empty wing/tail space).
  const draw = (img: HTMLImageElement | null, x: number, flip: boolean, h: number) => {
    if (!img) return;
    const w = (img.width / img.height) * h;
    c.save();
    c.fillStyle = 'rgba(0,0,0,0.1)';
    c.beginPath();
    c.ellipse(x, ground + 6, w * 0.38, 22, 0, 0, Math.PI * 2);
    c.fill();
    c.imageSmoothingEnabled = false;
    if (flip) { c.translate(x * 2, 0); c.scale(-1, 1); }
    c.drawImage(img, x - w / 2, ground - h, w, h);
    c.restore();
  };
  draw(left, cx + 240, true, 420);
  draw(right, cx + cw - 220, false, 310);
  c.save();
  c.beginPath();
  c.arc(W / 2, band, 92, 0, Math.PI * 2);
  c.fillStyle = '#fff';
  c.fill();
  c.lineWidth = 22;
  c.strokeStyle = '#111114';
  c.stroke();
  c.fillStyle = '#e3262e';
  c.textAlign = 'center';
  c.font = `800 70px ${display}`;
  c.fillText('VS', W / 2, band + 25);
  c.restore();

  c.fillStyle = '#111114';
  c.textAlign = 'center';
  c.font = `800 40px ${display}`;
  c.fillText('Tap the link to accept the challenge', W / 2, H - 120);
  return new Promise(res => cv.toBlob(b => res(b), 'image/png'));
}

/** Shares the invite: on phones with the picture card attached; on laptops the link is copied. */
export async function shareInvite(): Promise<string> {
  const link = inviteLink();
  const text = `${currentUser()?.username ?? 'A friend'} challenged you to a battle on DailyBattles! Accept here: ${link}`;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      const blob = await inviteCard();
      const file = blob ? new File([blob], 'pokebattles-challenge.png', {type: 'image/png'}) : null;
      if (file && navigator.canShare?.({files: [file]})) await navigator.share({files: [file], text});
      else await navigator.share({text});
      return 'Shared!';
    }
    await navigator.clipboard.writeText(link);
    return 'Link copied!';
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'Invite friends';
    return 'Copy failed: try the Friends page';
  }
}

/** Saves the picture card as a file (laptops). */
export async function downloadInviteCard() {
  const blob = await inviteCard();
  if (!blob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pokebattles-challenge.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
