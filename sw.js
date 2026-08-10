const CACHE = 'transform-v3';
const BASE = '/100-days';
const SHELL = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/css/style.css',
  BASE + '/css/screen.css',
  BASE + '/js/main.js',
  BASE + '/js/screen.js',
  BASE + '/js/videoExport.js',
  BASE + '/js/tutorial.js',
  BASE + '/manifest.json',
  BASE + '/icons/icon-192.png',
  BASE + '/icons/icon-512.png',
  BASE + '/icons/icon-180.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return res;
    }))
  );
});

// Show a notification from the SW (called via postMessage from the app)
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SHOW_NOTIFICATION') {
    const { title, body } = e.data;
    self.registration.showNotification(title, {
      body,
      icon: BASE + '/icons/icon-192.png',
      badge: BASE + '/icons/icon-192.png',
      tag: 'daily-reminder',
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url: BASE + '/' }
    });
  }
});

// Tap notification → open / focus the app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || BASE + '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(BASE));
      if (existing) return existing.focus();
      return clients.openWindow(target);
    })
  );
});

// Push event (for future server-sent push notifications)
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || '100 · Transformation Tracker', {
      body: data.body || "Time for today's progress photo 📸",
      icon: BASE + '/icons/icon-192.png',
      badge: BASE + '/icons/icon-192.png',
      tag: 'daily-reminder',
      data: { url: BASE + '/' }
    })
  );
});
