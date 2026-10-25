/* Zigga · service worker: recibe notificaciones push y abre la ficha al tocarlas. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Zigga', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Zigga', {
    body: d.body || '', icon: d.icon || '/icon-192.png', badge: '/icon-192.png', tag: d.tag, renotify: !!d.tag,
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = all.find((c) => c.url.startsWith(self.location.origin));
    if (same) { await same.focus(); if ('navigate' in same) { try { await same.navigate(url); } catch { /* algunos navegadores no lo permiten */ } } return; }
    await self.clients.openWindow(url);
  })());
});
