/* Credentials Manager service worker: makes the app fully offline. It never sees vault data (that lives in IndexedDB). */
const VERSION = '947b5cf01d9ab678';
const CACHE = 'credmgr-' + VERSION;
const FILES = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'lib/argon2.min.js', 'lib/eff-wordlist.js',
  'js/crypto.js', 'js/store.js', 'js/app.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('credmgr-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Cache-first: the app runs from the pinned, cached build even when offline.
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});
