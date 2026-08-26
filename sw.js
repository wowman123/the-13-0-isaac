/**
 * Offline support.
 *
 * The shell and the data are small and always needed, so they are precached.
 * The ~180 sprites are not: fetching them all during install would make the
 * first load crawl on a phone, so they are cached as they are actually seen.
 *
 * Bump CACHE when shipping — it is what evicts the previous version.
 */

const CACHE = 'the-13-0-v5';

const SHELL = [
  './',
  './index.html',
  './404.html',
  './manifest.webmanifest',
  './assets/style.css',
  './assets/app.js',
  './src/engine.js',
  './src/ratings.js',
  './src/synergy.js',
  './src/draft.js',
  './src/stats.js',
  './src/advanced.js',
  './data/items.json',
  './data/bosses.json',
  './data/config.json',
  './data/synergies.json',
  './data/transformations.json',
  './data/item-stats.json',
  './data/characters.json',
  './assets/fonts/upheaval.woff2',
  './assets/room-frame.png',
  './assets/room-floor.png',
  './assets/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Individually, so one 404 cannot fail the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Cache-first: for things that never change without a filename change. */
async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) (await caches.open(CACHE)).put(request, res.clone());
  return res;
}

/** Network-first: for things that should be fresh when there is a network. */
async function networkFirst(request, fallback) {
  try {
    const res = await fetch(request);
    if (res.ok) (await caches.open(CACHE)).put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await caches.match(request) ?? (fallback && await caches.match(fallback));
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: prefer the network so a deploy is picked up, but fall back to
  // the cached shell so the app opens with no connection at all.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }

  // Sprites, fonts and room art are immutable in practice.
  if (/\/(sprites|fonts)\/|room-(frame|floor)\.png$|icon-.*\.png$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else — code and data — should be fresh when it can be.
  event.respondWith(networkFirst(request));
});
