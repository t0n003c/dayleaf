// Dayleaf service worker: cache the app shell so the PWA opens instantly
// (and offline), while always going to the network for API calls.
// Stable cache name (never version-bumped again). Old `dayleaf-v*` caches are
// cleaned up once on upgrade; going forward assets just accumulate here, which
// is what lets a cached shell always find its (content-hashed) bundle even
// across updates — no blank, no purge-induced 404.
const CACHE = 'dayleaf-app';

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title || 'Dayleaf 🍃', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

self.addEventListener('install', (event) => {
  // Precache the freshly-deployed shell + chrome so the very next launch paints
  // instantly from cache (these go to the network directly, not via fetch()).
  event.waitUntil(
    caches.open(CACHE).then((c) =>
      c.addAll(['/', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png'])
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // One-time cleanup of the old versioned caches. CACHE itself is never purged
  // again, so content-hashed assets from older shells survive — a cached shell
  // can always resolve its bundle, even right after an update.
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  // Manifest: network-first so splash/theme changes propagate (it's tiny);
  // fall back to cache offline.
  if (url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Navigations: stale-while-revalidate. The cached shell paints INSTANTLY (no
  // launch-latency flash). In the background we refresh '/' AND precache the
  // hashed assets that fresh shell references — so the cached shell is always
  // self-sufficient and can never point at a bundle that's missing from both
  // cache and server (the blank-after-update bug). Old assets are never purged.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('/').then((cached) => {
        const network = fetch(event.request)
          .then(async (res) => {
            try {
              const cache = await caches.open(CACHE);
              await cache.put('/', res.clone());
              const html = await res.clone().text();
              const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
              await Promise.all(
                assets.map((u) =>
                  fetch(u).then((r) => (r.ok ? cache.put(u, r) : null)).catch(() => {})
                )
              );
            } catch {}
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Everything else (content-hashed assets, icons): cache-first, immutable.
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((res) => {
          if (res.ok && url.origin === location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, copy));
          }
          return res;
        })
    )
  );
});
