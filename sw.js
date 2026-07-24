const VERSION = 'maklarspaning-self-destruct-v7-2';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(clients.map(client => client.navigate('./latest.html?v=7.2')));
    await self.registration.unregister();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method === 'GET') {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
  }
});
