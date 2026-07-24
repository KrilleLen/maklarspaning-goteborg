const CACHE = 'maklarspaning-v7-3-20260724';
const CORE = [
  './',
  './index.html',
  './styles.css?v=7.3',
  './app.js?v=7.3',
  './manifest.webmanifest?v=7.3',
  './favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './data/app-data.json?v=7.3'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then(hit => hit || caches.match('./index.html')))
  );
});
