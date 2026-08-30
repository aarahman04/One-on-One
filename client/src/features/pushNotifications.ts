// Web Push: lets a message reach the other person even when their app is
// fully closed (iOS requires the site be Added to Home Screen for this to
// work at all — Apple's rule, not ours). Requires VITE_VAPID_PUBLIC_KEY.
import { authedFetch } from '../services/apiClient'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && !!VAPID_PUBLIC_KEY
}

// navigator.serviceWorker.ready never resolves if registration failed (missing
// /sw.js, bad MIME, http:) — race it with a timeout so the caller (and the
// "Notifications" menu click) doesn't hang forever.
async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
  ])
}

export async function isPushSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false
  const reg = await getRegistration()
  if (!reg) return false
  const sub = await reg.pushManager.getSubscription()
  return !!sub
}

export async function subscribeToPush(): Promise<void> {
  if (!VAPID_PUBLIC_KEY) throw new Error('push not configured')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('permission denied')

  const reg = await getRegistration()
  if (!reg) throw new Error('notifications are not available right now')
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
  })
  const json = sub.toJSON()
  const res = await authedFetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  })
  if (!res.ok) {
    // Don't leave a browser subscription with no server record — the UI would
    // show "on" while nothing gets delivered.
    await sub.unsubscribe().catch(() => {})
    throw new Error('failed to save subscription')
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  const reg = await getRegistration()
  if (!reg) return
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  await authedFetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {})
}
