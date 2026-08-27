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

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon.svg',
      badge: '/icon.svg',
    }),
  )
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
