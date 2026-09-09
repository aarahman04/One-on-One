// Service worker: receives Web Push while the app isn't running, focuses/opens
// the app on notification tap, and serves a minimal offline fallback so the app
// (and the TWA that wraps it) never shows the browser's dino page. Chat itself
// still needs the network for every message — the offline page is a courtesy,
// not offline functionality.

const CACHE = 'oneonone-shell-v1'
const OFFLINE_URL = '/offline.html'
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// Network-first for navigations; fall back to the cached offline page when the
// network is unreachable. Everything else (API, assets, sockets) is left alone.
self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.mode !== 'navigate') return
  event.respondWith(
    fetch(request).catch(() => caches.match(OFFLINE_URL, { ignoreSearch: true })),
  )
})

self.addEventListener('push', (event) => {
  let data = { title: 'One on One', body: 'You have a new message.' }
  try {
    if (event.data) data = event.data.json()
  } catch {
    /* keep the default */
  }

  // /alarm sends set urgent — ask for a more insistent notification. This is
  // still an ordinary web push under the hood: no platform lets a page bypass
  // OS-level Do Not Disturb, and iOS ignores vibrate/custom sound entirely.
  // Android Chrome honors requireInteraction + vibrate + renotify.
  const options = data.urgent
    ? {
        body: data.body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        requireInteraction: true,
        renotify: true,
        tag: 'alarm',
        vibrate: [300, 150, 300, 150, 300, 150, 300],
      }
    : {
        body: data.body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
      }

  event.waitUntil(self.registration.showNotification(data.title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if ('focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow('/')
    }),
  )
})
