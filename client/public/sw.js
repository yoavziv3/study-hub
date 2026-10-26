// Service worker for the cloud site: the app opens instantly and pages you've visited work offline.
// Code and icons: cache first (they don't change). Slide images, course data and the account: network first,
// falling back to the last copy when offline. Sign-in, admin and calendar requests are never cached.
const VERSION = 'v2';
const SHELL = `shell-${VERSION}`;
const STATIC = `static-${VERSION}`;
const DATA = `data-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, STATIC, DATA].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const networkFirst = async (req, cacheName) => {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw new Error('offline');
  }
};

const cacheFirst = async (req) => {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (/^\/api\/(auth|admin|cal)\//.test(url.pathname)) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(async () => (await caches.match('/')) || Response.error()));
  } else if (url.pathname.startsWith('/assets/') || /\.(png|svg|woff2?)$/.test(url.pathname)) {
    e.respondWith(cacheFirst(req));
  } else if (url.pathname.startsWith('/data/') || url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/')) {
    // /files/ (slide images and decks on the Mac) can change when a lesson's file is replaced, so not cache first.
    e.respondWith(networkFirst(req, DATA));
  }
});

// Phone notifications (Web Push from the cloud – see cloud/lib/notify.js): { title, body, url, tag }.
self.addEventListener('push', (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { body: e.data?.text() || '' };
  }
  e.waitUntil(
    self.registration.showNotification(data.title || 'IEMprove', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag,
      lang: 'he',
      dir: 'rtl',
      data: { url: data.url || '/' },
    })
  );
});

// Tapping a notification opens its page – in the site's open window if there is one.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || '/', location.origin);
  const url = target.origin === location.origin ? target.href : location.origin;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).origin === location.origin);
    if (win) {
      await win.focus();
      return win.navigate(url).catch(() => self.clients.openWindow(url));
    }
    return self.clients.openWindow(url);
  })());
});

// Signing out clears everything personal that was cached on this device.
self.addEventListener('message', (e) => {
  if (e.data === 'clear-data') e.waitUntil(caches.delete(DATA));
});
