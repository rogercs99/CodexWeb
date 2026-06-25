// CodexWeb Service Worker — shell cache + offline fallback
const CACHE = 'codexweb-v2-20260625';
const SHELL = ['/'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  if (url.pathname.startsWith('/api/')) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const clone = r.clone();
          caches.open(CACHE).then((c) => c.put('/', clone));
          return r;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  if (/\/assets\/index-[A-Za-z0-9_-]+\.(js|css)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(
        (cached) =>
          cached ||
          fetch(e.request).then((r) => {
            caches.open(CACHE).then((c) => c.put(e.request, r.clone()));
            return r;
          })
      )
    );
  }
});
