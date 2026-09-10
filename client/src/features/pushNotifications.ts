// Push notifications. Two transports behind one API:
//   • Web PWA  → Web Push / VAPID + the service worker (unchanged from before).
//   • Native (Capacitor / Android) → FCM via @capacitor/push-notifications.
// ChatPage only ever calls the four exported functions; it never knows which
// transport is live. The plugin is dynamic-imported so it stays out of the web
// bundle's initial load (same pattern as native Google sign-in).
import { Capacitor } from '@capacitor/core'
import { authedFetch } from '../services/apiClient'

const isNative = Capacitor.isNativePlatform()
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

// Android message-notification channel. Its own channel at high importance —
// NOT the low-importance "calls" channel CallForegroundService owns (that one is
// deliberately quiet because a call plays its own ringtone).
const MESSAGES_CHANNEL = 'messages'
const NATIVE_TOKEN_KEY = 'nativePushToken'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export function isPushSupported(): boolean {
  if (isNative) return true
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
  if (isNative) {
    // We only have a server record if we successfully registered — track that
    // locally; the plugin exposes no "is registered" query.
    try {
      return localStorage.getItem(NATIVE_TOKEN_KEY) !== null
    } catch {
      return false
    }
  }
  const reg = await getRegistration()
  if (!reg) return false
  const sub = await reg.pushManager.getSubscription()
  return !!sub
}

export async function subscribeToPush(): Promise<void> {
  if (isNative) return subscribeNative()

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
  if (isNative) return unsubscribeNative()

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

// --- Native (FCM) -----------------------------------------------------------

async function subscribeNative(): Promise<void> {
  const { PushNotifications } = await import('@capacitor/push-notifications')

  // This is the one runtime prompt for POST_NOTIFICATIONS. Stage 3's
  // CallServicePlugin also *can* request it, but only when a call starts and
  // only if not already granted — so in practice this path owns the prompt and
  // the call path finds it already answered.
  let perm = await PushNotifications.checkPermissions()
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
    perm = await PushNotifications.requestPermissions()
  }
  if (perm.receive !== 'granted') throw new Error('permission denied')

  await PushNotifications.createChannel({
    id: MESSAGES_CHANNEL,
    name: 'Messages',
    description: 'New messages and missed calls',
    importance: 5,
    visibility: 1,
  })

  let settled = false
  let resolveToken: (value: string) => void
  let rejectToken: (reason: Error) => void
  const tokenPromise = new Promise<string>((resolve, reject) => {
    resolveToken = resolve
    rejectToken = reject
  })
  const finish = (fn: () => void): void => {
    if (settled) return
    settled = true
    fn()
  }

  // Await the listener handles BEFORE register() — Capacitor doesn't buffer an
  // event fired before its JS listener is attached, so registering first can
  // lose the token entirely and strand this on the timeout.
  await PushNotifications.addListener('registration', (t) => finish(() => resolveToken(t.value)))
  await PushNotifications.addListener('registrationError', (e) =>
    finish(() => rejectToken(new Error(typeof e?.error === 'string' ? e.error : 'registration failed'))),
  )
  void PushNotifications.register()
  setTimeout(() => finish(() => rejectToken(new Error('registration timed out'))), 10000)
  const token = await tokenPromise

  const res = await authedFetch('/api/push/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  // Status included on purpose: a 404 here means the backend is deployed
  // without the Stage 4 routes, which is otherwise indistinguishable from a
  // real save failure.
  if (!res.ok) throw new Error(`failed to save token (${res.status})`)
  try {
    localStorage.setItem(NATIVE_TOKEN_KEY, token)
  } catch {
    /* private mode — the toggle still worked server-side */
  }
}

async function unsubscribeNative(): Promise<void> {
  const { PushNotifications } = await import('@capacitor/push-notifications')
  let token: string | null = null
  try {
    token = localStorage.getItem(NATIVE_TOKEN_KEY)
  } catch {
    /* ignore */
  }
  await PushNotifications.unregister().catch(() => {})
  if (token) {
    await authedFetch('/api/push/token/unregister', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }).catch(() => {})
  }
  try {
    localStorage.removeItem(NATIVE_TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

// Foreground / tap listeners. Tapping a notification relaunches the singleTask
// MainActivity and boot state re-resolves the screen, so there is nothing to
// route here. A foreground receipt needs no extra notification — the socket has
// already delivered the message live. Registered once, lazily.
if (isNative) {
  void (async () => {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    void PushNotifications.addListener('pushNotificationReceived', () => {
      /* app is open — live delivery already handled it */
    })
    void PushNotifications.addListener('pushNotificationActionPerformed', () => {
      /* singleTask relaunch + boot screen resolution handle navigation */
    })
  })()
}
