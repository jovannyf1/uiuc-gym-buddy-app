const CACHE = 'gym-buddy-static-v2';
const STATIC_FILES = ['/icon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('gym-buddy-static-') && key !== CACHE).map(key => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // HTML must always come from the network. An old page can reference a bundle
  // removed by a deployment, leaving the entire app blank.
  if (request.mode === 'navigate') return;
  if (url.pathname.startsWith('/assets/') || STATIC_FILES.includes(url.pathname)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      // The app's HTML fallback may return 200 for a missing asset. Never cache
      // that HTML under a JavaScript or CSS URL.
      if (response.ok && !response.headers.get('content-type')?.includes('text/html')) {
        caches.open(CACHE).then(cache => cache.put(request, response.clone())).catch(() => {});
      }
      return response;
    })));
  }
});
