// Offline support: sprites and icons come from the cache; everything else tries the
// network first (so new versions show up), falling back to the cache when offline.
const CACHE = 'pokebattles-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const staticAsset = ['/sprites/', '/icons/', '/types/', '/assets/'].some(d => url.pathname.includes(d)); // /assets/ files have a new name every update
  e.respondWith(caches.open(CACHE).then(async cache => {
    if (staticAsset) {
      const hit = await cache.match(e.request);
      if (hit) return hit;
    }
    try {
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch {
      return (await cache.match(e.request)) ?? Response.error();
    }
  }));
});

// Phone notifications (friend challenges, daily island, streak reminders). Sent by the Supabase "push" functions.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {body: e.data && e.data.text()}; }
  e.waitUntil(self.registration.showNotification(d.title || 'DailyBattles', {
    body: d.body || '', tag: d.tag, data: {url: d.url || '/'},
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    // Remember the tap, so a freshly opened app can find it even if the phone opens the home page.
    try { await (await caches.open('pb-notif')).put('/tapped', new Response(JSON.stringify({url, at: Date.now()}))); } catch (_) { /* ignore */ }
    const wins = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    const open = wins.find(w => w.url.startsWith(self.location.origin));
    if (open) {
      // Already open: bring it forward and tell the page which battle to open (no reload needed).
      try { await open.focus(); } catch (_) { /* ignore */ }
      open.postMessage({type: 'open', url});
      try { await (await caches.open('pb-notif')).delete('/tapped'); } catch (_) { /* ignore */ }
      return;
    }
    return self.clients.openWindow(url);
  })());
});
