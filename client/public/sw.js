// Minimal service worker: exists only to receive Web Push events while the
// app itself isn't running, and to focus/open the app on notification tap.
// No offline caching — that's a separate concern this app doesn't need yet.

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
        icon: '/icon.svg',
        badge: '/icon.svg',
        requireInteraction: true,
        renotify: true,
        tag: 'alarm',
        vibrate: [300, 150, 300, 150, 300, 150, 300],
      }
    : {
        body: data.body,
        icon: '/icon.svg',
        badge: '/icon.svg',
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
