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

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.ready
}

export async function isPushSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false
  const reg = await getRegistration()
  const sub = await reg.pushManager.getSubscription()
  return !!sub
}

export async function subscribeToPush(): Promise<void> {
  if (!VAPID_PUBLIC_KEY) throw new Error('push not configured')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('permission denied')

  const reg = await getRegistration()
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
  if (!res.ok) throw new Error('failed to save subscription')
}

export async function unsubscribeFromPush(): Promise<void> {
  const reg = await getRegistration()
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
