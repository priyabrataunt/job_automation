// Service Worker for push notifications
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}
  const title = data.title || 'Job Tracker'
  const options = {
    body: data.body || 'New jobs available!',
    icon: '/vite.svg',
    badge: '/vite.svg',
    data: { url: data.url || '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(clients.openWindow(url))
})
