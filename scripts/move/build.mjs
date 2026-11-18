// Builds the "we've moved" hand-off for the OLD sites: move-live/ (→ dailybattles) and move-dev/ (→ dailybattles-dev).
// Drag move-live onto pokebattles1 and move-dev onto pokebattles-dev on Netlify. Every old link (any path) forwards
// instantly to the same path on the new site, carrying this browser's saved game data (#move=...).
import fs from 'node:fs';
const page = target => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>DailyBattles</title><meta name="robots" content="noindex">
<meta property="og:title" content="DailyBattles"><meta property="og:description" content="A new Pokémon battle every day. Can you beat Red?">
<meta property="og:image" content="${target}icons/og.jpg"><meta name="twitter:card" content="summary_large_image">
<style>html,body{margin:0;background:#f4f4f6}</style></head><body>
<script>
(function () {
  var target = ${JSON.stringify(target.replace(/\/$/, ''))} + location.pathname + location.search;
  var data = {};
  try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('pokebattles') === 0) data[k] = localStorage.getItem(k); } } catch (e) {}
  var json = JSON.stringify(data);
  function b64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, ''); }
  function go(hash) { location.replace(target + (hash ? '#move=' + hash : '')); }
  if (json === '{}') return go('');
  var plain = new TextEncoder().encode(json);
  if (!window.CompressionStream) return go('p' + b64(plain));
  new Response(new Blob([plain]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()
    .then(function (buf) { go('z' + b64(new Uint8Array(buf))); })
    .catch(function () { go('p' + b64(plain)); });
})();
</script>
<noscript><a href="${target}">DailyBattles has moved: tap here</a></noscript>
</body></html>
`;
for (const [dir, target] of [['move-live', 'https://dailybattles.netlify.app/'], ['move-dev', 'https://dailybattles-dev.netlify.app/']]) {
  fs.rmSync(dir, {recursive: true, force: true});
  fs.mkdirSync(dir);
  fs.writeFileSync(`${dir}/index.html`, page(target));
  fs.writeFileSync(`${dir}/_redirects`, '/*  /index.html  200\n');
  // Old service workers (cached game) are replaced by one that just forwards, so installed home-screen apps move too.
  fs.writeFileSync(`${dir}/sw.js`, "self.addEventListener('install', () => self.skipWaiting());\nself.addEventListener('activate', e => e.waitUntil(self.registration.unregister().then(() => self.clients.matchAll()).then(cs => cs.forEach(c => c.navigate(c.url)))));\n");
}
console.log('built move-live/ and move-dev/');
