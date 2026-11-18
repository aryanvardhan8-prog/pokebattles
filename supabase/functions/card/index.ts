// Supabase Edge Function: stores a share-card picture so it can be shared as a link.
// POST {png: base64, title, text} → {id}. Files: public bucket "cards": {id}.png (the picture) and {id}.html
// (a tiny page with link-preview tags that opens the game). The site's /c/{id} shows that page (Netlify proxy).

import {createClient} from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {...cors, 'Content-Type': 'application/json'}});
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]!));
let ready = false;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: cors});
  if (req.method !== 'POST') return json({error: 'POST only'}, 405);
  let b: {png?: string; title?: string; text?: string; site?: string};
  try { b = await req.json(); } catch { return json({error: 'Bad request.'}, 400); }
  const png = String(b.png ?? '');
  if (!/^[A-Za-z0-9+/=]+$/.test(png) || png.length > 2_000_000) return json({error: 'Bad picture.'}, 400);
  if (!ready) {
    const {data} = await db.storage.getBucket('cards');
    if (!data) await db.storage.createBucket('cards', {public: true});
    ready = true;
  }
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const bytes = Uint8Array.from(atob(png), ch => ch.charCodeAt(0));
  if (bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return json({error: 'Bad picture.'}, 400);
  const pub = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/cards/${id}.png`;
  const site = /^https:\/\/[a-z0-9.-]+$/.test(String(b.site ?? '')) ? b.site! : 'https://dailybattles.netlify.app';
  const title = esc(String(b.title ?? 'DailyBattles').slice(0, 100)), text = esc(String(b.text ?? '').slice(0, 200));
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<meta property="og:type" content="website"><meta property="og:site_name" content="DailyBattles">
<meta property="og:title" content="${title}"><meta property="og:description" content="${text}">
<meta property="og:image" content="${pub}"><meta property="og:image:width" content="1080"><meta property="og:image:height" content="1350">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${pub}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=${site}/">
</head><body style="margin:0;background:#f4f4f6;text-align:center;font-family:sans-serif"><a href="${site}/"><img src="${pub}" style="max-width:100%;width:540px"><p>Play DailyBattles</p></a></body></html>`;
  const up1 = await db.storage.from('cards').upload(`${id}.png`, bytes, {contentType: 'image/png', cacheControl: '31536000'});
  const up2 = await db.storage.from('cards').upload(`${id}.html`, new Blob([html], {type: 'text/html'}), {contentType: 'text/html', cacheControl: '31536000'});
  if (up1.error || up2.error) return json({error: 'Could not save.'}, 500);
  return json({id, image: pub});
});
