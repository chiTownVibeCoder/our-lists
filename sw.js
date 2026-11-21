// Keeps the app shell available offline. Data always comes live from Supabase.
const CACHE = 'our-lists-v5';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'vendor/supabase.js', 'vendor/Sortable.min.js', 'manifest.webmanifest', 'icons/icon-192.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Network first, fall back to cache when offline
  e.respondWith(
    // 'no-cache' asks the server whether there's a newer copy, so updates arrive right away.
    fetch(e.request, { cache: 'no-cache' }).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
