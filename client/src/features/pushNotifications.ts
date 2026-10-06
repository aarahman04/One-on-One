// Push notifications. Two transports behind one API:
//   • Web PWA  → Web Push / VAPID + the service worker (unchanged from before).
//   • Native (Capacitor / Android) → FCM via @capacitor/push-notifications.
// ChatPage only ever calls the four exported functions; it never knows which
// transport is live. The plugin is dynamic-imported so it stays out of the web
// bundle's initial load (same pattern as native Google sign-in).
import { Capacitor } from '@capacitor/core'
import { authedFetch } from '../services/apiClient'
import { getSession } from '../services/authService'

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
    // "On" = OS permission granted AND we hold an uploaded token AND the user
    // hasn't switched it off. The plugin exposes no "is registered" query, so the
    // token is tracked locally (cleared on sign-out / unsubscribe).
    try {
      if (localStorage.getItem(NATIVE_TOKEN_KEY) === null || localStorage.getItem(OPT_OUT_KEY) === '1') return false
      const { PushNotifications } = await import('@capacitor/push-notifications')
      return (await PushNotifications.checkPermissions()).receive === 'granted'
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
//
// Lifecycle: initNativePush() runs at app start / on sign-in. It creates the
// "messages" channel, attaches ONE permanent `registration` listener (so a
// rotated FCM token is always re-sent to the backend), and — if notification
// permission is granted (or can be asked once) and the user hasn't turned
// notifications off — registers and POSTs the token on EVERY launch. The menu
// toggle reuses the same registration path. clearPushOnSignOut() removes the
// server token before the session is dropped.

type PushPlugin = typeof import('@capacitor/push-notifications').PushNotifications

let pluginPromise: Promise<PushPlugin> | null = null
function getPlugin(): Promise<PushPlugin> {
  pluginPromise ??= import('@capacitor/push-notifications').then((m) => m.PushNotifications)
  return pluginPromise
}

const OPT_OUT_KEY = 'nativePushOptOut' // user explicitly turned notifications off on this device
const PROMPTED_KEY = 'nativePushPrompted' // we already asked for permission once automatically

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function lsSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* private mode */
  }
}

async function postNativeToken(token: string): Promise<void> {
  // Never go through authedFetch without a session: it would trigger the 401
  // handler (sign-out + reload) — a token event can arrive while signed out.
  if (!(await getSession())) throw new Error('not signed in')
  const res = await authedFetch('/api/push/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  // Status included on purpose: a 404 here means the backend is deployed
  // without the Stage 4 routes, which is otherwise indistinguishable from a
  // real save failure.
  if (!res.ok) throw new Error(`failed to save token (${res.status})`)
  lsSet(NATIVE_TOKEN_KEY, token)
}

interface TokenWaiter {
  resolve: (upload: Promise<void>) => void
  reject: (err: Error) => void
}
let tokenWaiters: TokenWaiter[] = []

let setupPromise: Promise<void> | null = null
function ensureNativeSetup(): Promise<void> {
  setupPromise ??= (async () => {
    const PN = await getPlugin()
    await PN.createChannel({
      id: MESSAGES_CHANNEL,
      name: 'Messages',
      description: 'New messages and missed calls',
      importance: 5,
      visibility: 1,
    })
    // Await the listener handles BEFORE register() — Capacitor doesn't buffer an
    // event fired before its JS listener is attached.
    await PN.addListener('registration', (t) => {
      const upload = postNativeToken(t.value)
      upload.catch((err) => console.warn('push: token upload failed', err))
      for (const w of tokenWaiters.splice(0)) w.resolve(upload)
    })
    await PN.addListener('registrationError', (e) => {
      const err = new Error(typeof e?.error === 'string' ? e.error : 'registration failed')
      console.warn('push: registration error', err.message)
      for (const w of tokenWaiters.splice(0)) w.reject(err)
    })
    // Tapping a notification relaunches the singleTask MainActivity and boot
    // state re-resolves the screen, so there is nothing to route here. A
    // foreground receipt needs no extra notification — the socket has already
    // delivered the message live.
    await PN.addListener('pushNotificationReceived', () => {})
    await PN.addListener('pushNotificationActionPerformed', () => {})
  })().catch((err) => {
    setupPromise = null // retry next time
    throw err
  })
  return setupPromise
}

// register() re-emits `registration` with the current token each call; resolves
// once that token has been uploaded to the backend.
async function registerNative(): Promise<void> {
  await ensureNativeSetup()
  const PN = await getPlugin()
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('registration timed out')), 10000)
    tokenWaiters.push({
      resolve: (upload) => {
        clearTimeout(timer)
        upload.then(resolve, reject)
      },
      reject: (err) => {
        clearTimeout(timer)
        reject(err)
      },
    })
  })
  done.catch(() => {}) // callers that don't await (launch path) must not leak an unhandled rejection
  await PN.register()
  return done
}

let initInFlight: Promise<void> | null = null
export function initNativePush(): Promise<void> {
  if (!isNative) return Promise.resolve()
  initInFlight ??= (async () => {
    try {
      await ensureNativeSetup() // channel exists even before a session does
      if (!(await getSession())) return
      if (lsGet(OPT_OUT_KEY) === '1') return
      const PN = await getPlugin()
      let perm = (await PN.checkPermissions()).receive
      if (perm === 'prompt' || perm === 'prompt-with-rationale') {
        if (lsGet(PROMPTED_KEY) === '1') return // asked once already — the menu toggle is the way back in
        lsSet(PROMPTED_KEY, '1')
        perm = (await PN.requestPermissions()).receive
      }
      if (perm !== 'granted') return
      await registerNative()
    } catch (err) {
      console.warn('push: native init failed', err)
    } finally {
      initInFlight = null
    }
  })()
  return initInFlight
}

async function subscribeNative(): Promise<void> {
  await ensureNativeSetup()
  const PN = await getPlugin()
  // Explicit user action: always allowed to ask (this is also the way back in
  // after the one automatic prompt was dismissed).
  let perm = await PN.checkPermissions()
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
    perm = await PN.requestPermissions()
  }
  if (perm.receive !== 'granted') throw new Error('permission denied')
  lsSet(OPT_OUT_KEY, null)
  await registerNative()
}

async function removeServerToken(): Promise<void> {
  const token = lsGet(NATIVE_TOKEN_KEY)
  if (token && (await getSession())) {
    await authedFetch('/api/push/token/unregister', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }).catch((err) => console.warn('push: token unregister failed', err))
  }
  lsSet(NATIVE_TOKEN_KEY, null)
}

async function unsubscribeNative(): Promise<void> {
  const PN = await getPlugin()
  lsSet(OPT_OUT_KEY, '1')
  await PN.unregister().catch(() => {})
  await removeServerToken()
}

// Called by authService.signOut BEFORE the session is dropped (the delete needs
// auth). Best-effort and bounded: sign-out must never hang on push cleanup.
export async function clearPushOnSignOut(): Promise<void> {
  if (!isNative) return
  try {
    await Promise.race([
      (async () => {
        const PN = await getPlugin()
        await PN.unregister().catch(() => {})
        await removeServerToken()
      })(),
      new Promise<void>((resolve) => setTimeout(resolve, 4000)),
    ])
  } catch (err) {
    console.warn('push: sign-out cleanup failed', err)
  }
  // Local state is per-account: the next login re-evaluates from scratch.
  lsSet(NATIVE_TOKEN_KEY, null)
  lsSet(OPT_OUT_KEY, null)
}

// Menu label from the REAL state (permission + registration), not just a flag.
export async function getNotificationsLabel(): Promise<string> {
  let on = false
  try {
    on = await isPushSubscribed()
  } catch {
    /* treat as off */
  }
  return on ? 'Notifications: On' : 'Notifications: Off'
}
