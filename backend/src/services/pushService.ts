import crypto from 'node:crypto'
import webPush from 'web-push'
import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { ConnectionError } from '../utils/connectionError.js'

// A push endpoint is a URL the server will POST to on every message. Without a
// check, a client can point it at an internal address (169.254.169.254,
// localhost:6379, …) and turn message delivery into a blind SSRF. Restrict to
// the real browser-push services.
const ALLOWED_PUSH_HOSTS = [
  /(^|\.)googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /(^|\.)push\.apple\.com$/,
]

function assertValidPushEndpoint(raw: string): void {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ConnectionError(400, 'invalid push endpoint')
  }
  if (url.protocol !== 'https:') throw new ConnectionError(400, 'push endpoint must be https')
  if (!ALLOWED_PUSH_HOSTS.some((re) => re.test(url.hostname))) {
    throw new ConnectionError(400, 'unsupported push endpoint')
  }
}

const publicKey = process.env.VAPID_PUBLIC_KEY
const privateKey = process.env.VAPID_PRIVATE_KEY
const subject = process.env.VAPID_SUBJECT

// Push is optional infrastructure: if the keys aren't set (e.g. local dev),
// silently no-op rather than crash the server on every message send.
const configured = !!(publicKey && privateKey && subject)
if (configured) {
  webPush.setVapidDetails(subject!, publicKey!, privateKey!)
} else {
  console.warn('VAPID keys not set — push notifications disabled')
}

// --- FCM HTTP v1 (native / Android build) ------------------------------------
// The web PWA keeps web-push/VAPID above; the Capacitor app registers an FCM
// token instead. Same "unconfigured ⇒ warn and no-op" stance: no service
// account set (local dev, or web-only deploys) means FCM sends are skipped, not
// errors. Auth is a Firebase service-account JSON held in FIREBASE_SERVICE_ACCOUNT
// (the whole JSON as one env var — never a file in the repo).
interface ServiceAccount {
  client_email: string
  private_key: string
  project_id: string
}

let serviceAccount: ServiceAccount | null = null
try {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (raw) {
    const parsed = JSON.parse(raw) as ServiceAccount
    if (parsed.client_email && parsed.private_key && parsed.project_id) {
      // A double-escaped env var leaves literal "\n" pairs in the PEM, which
      // makes crypto.createSign().sign() fail with an opaque error on every
      // send. Normalising here is cheap and a no-op for a correctly-stored key.
      serviceAccount = { ...parsed, private_key: parsed.private_key.replace(/\\n/g, '\n') }
    } else {
      console.warn('FIREBASE_SERVICE_ACCOUNT set but missing client_email/private_key/project_id — FCM disabled')
    }
  }
} catch {
  console.warn('FIREBASE_SERVICE_ACCOUNT is not valid JSON — FCM disabled')
}
const fcmConfigured = !!serviceAccount
// Logged either way: the deploy log is the only place to confirm the env var
// actually parsed, since a misconfigured FCM otherwise fails silently.
if (fcmConfigured) console.log(`fcm: configured for project ${serviceAccount!.project_id}`)
else console.warn('FIREBASE_SERVICE_ACCOUNT not usable — FCM (native) push disabled')

let cachedToken: { value: string; expiresAt: number } | null = null

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

// Mint a short-lived OAuth2 access token from the service-account key via the
// JWT-bearer grant — avoids pulling in googleapis just for this one call.
async function getFcmAccessToken(): Promise<string> {
  const sa = serviceAccount!
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.value

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  )
  const signature = base64url(crypto.createSign('RSA-SHA256').update(`${header}.${claim}`).sign(sa.private_key))
  const assertion = `${header}.${claim}.${signature}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  if (!res.ok) throw new Error(`FCM token exchange failed (${res.status}): ${await res.text()}`)
  const json = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = { value: json.access_token, expiresAt: now + json.expires_in }
  return json.access_token
}

// 'android' = the Capacitor app (keeps today's payloads); 'android-native' =
// the Kotlin app, which gets data-only sends so its FirebaseMessagingService
// always runs (see buildFcmMessage). Migration 035 mirrors this list.
export const PUSH_PLATFORMS = ['android', 'android-native'] as const
export type PushPlatform = (typeof PUSH_PLATFORMS)[number]

interface FcmTokenRow {
  id: string
  token: string
  platform: string
}

export async function saveToken(userId: string, token: string, platform: PushPlatform = 'android'): Promise<void> {
  const { error } = await supabaseAdmin
    .from('push_tokens')
    .upsert({ user_id: userId, token, platform }, { onConflict: 'token' })
  if (error) throw error
}

// FCM HTTP v1 message body for one token. Pure, so the per-platform shape is
// unit-testable. 'android-native' tokens get DATA-ONLY, always high priority,
// whenever the payload carries `native` data (the native app builds its own
// notification, which is also what keeps the high priority from being
// downgraded). Everything else (legacy 'android', or a send with no native
// data such as the missed-call text push) keeps the previous shape.
export function buildFcmMessage(token: string, platform: string, payload: PushPayload): Record<string, unknown> {
  if (platform === 'android-native' && payload.native) {
    return {
      token,
      android: { priority: 'high', ...(payload.nativeTtl ? { ttl: payload.nativeTtl } : {}) },
      data: payload.native,
    }
  }
  // An alarm send carries `payload.data` and goes out data-only (no
  // `notification` block) — a display notification is auto-shown by the OS
  // without ever reaching app code, but an alarm needs AlarmMessagingService
  // to run so it can start the native ring; data-only messages always reach
  // onMessageReceived, foreground, backgrounded or killed.
  const dataOnly = !!payload.data
  return {
    token,
    ...(dataOnly ? {} : { notification: { title: payload.title, body: payload.body } }),
    android: {
      // Alarm sends: raise + cancel are time-critical (high, and worthless
      // after 2 min — same as the ring's auto-clear — so ttl 120s). A plain
      // ack goes to the raiser and shows nothing; a data-only high-priority
      // send that displays nothing gets the app's high priority downgraded,
      // so LEGACY ('android') tokens get normal for it. Native tokens never
      // take this branch: the native app shows its own notification for an
      // ack, so it is sent high (see above). Everything else is high.
      priority: dataOnly && payload.data?.ack === 'true' && payload.data?.cancelled !== 'true' ? 'normal' : 'high',
      ...(dataOnly ? { ttl: '120s' } : {}),
      ...(dataOnly
        ? {}
        : {
            notification: {
              channel_id: 'messages',
              notification_priority: payload.urgent ? 'PRIORITY_MAX' : 'PRIORITY_DEFAULT',
            },
          }),
    },
    data: { urgent: payload.urgent ? 'true' : 'false', ...payload.data },
  }
}

// Scoped to the caller: a token is per-install and unguessable, but unlike a
// web-push endpoint nothing else proves the caller owns it. If the row was
// moved to another account by saveToken's onConflict upsert (same device, new
// login) this deletes nothing — the next FCM send to the now-unregistered
// token prunes it.
export async function removeToken(userId: string, token: string): Promise<void> {
  const { error } = await supabaseAdmin.from('push_tokens').delete().eq('user_id', userId).eq('token', token)
  if (error) throw error
}

// Sends a payload to every FCM token the user has registered; prunes any token
// FCM reports as UNREGISTERED / SENDER_ID_MISMATCH / 404 (mirrors the 404/410 pruning
// on the web-push side).
// Returns how many tokens it attempted (0 when FCM is unconfigured or the user
// has none). `nativeOnly` restricts to 'android-native' tokens (call pushes).
async function sendFcmToUser(userId: string, payload: PushPayload, opts: { nativeOnly?: boolean } = {}): Promise<number> {
  if (!fcmConfigured) {
    console.warn(`fcm: skipped for user ${userId} — FIREBASE_SERVICE_ACCOUNT not usable`)
    return 0
  }

  const { data, error } = await supabaseAdmin.from('push_tokens').select('id, token, platform').eq('user_id', userId)
  if (error) throw error
  const rows = ((data ?? []) as FcmTokenRow[]).filter((r) => !opts.nativeOnly || r.platform === 'android-native')
  if (!rows.length) return 0

  const accessToken = await getFcmAccessToken()
  const url = `https://fcm.googleapis.com/v1/projects/${serviceAccount!.project_id}/messages:send`

  await Promise.all(
    rows.map(async (row) => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: buildFcmMessage(row.token, row.platform, payload) }),
        })
        if (res.ok) {
          console.log(`fcm: sent to ${row.token.slice(0, 12)}…`)
          return
        }
        const errText = await res.text().catch(() => '')
        let status: string | undefined
        try {
          status = (JSON.parse(errText) as { error?: { status?: string } }).error?.status
        } catch {
          /* non-JSON body — logged raw below */
        }
        // Prune only when FCM says the token is permanently dead. A 400 can also
        // mean a malformed payload (our bug) and must not wipe every user's token.
        if (res.status === 404 || status === 'UNREGISTERED' || status === 'SENDER_ID_MISMATCH') {
          await supabaseAdmin.from('push_tokens').delete().eq('id', row.id)
          console.log(`fcm: pruned dead token ${row.id} (status ${res.status} ${status ?? ''})`)
        } else {
          console.error(`fcm: send failed (status ${res.status} ${status ?? ''}) body: ${errText.slice(0, 500)}`)
        }
      } catch (err) {
        console.error('fcm: send error:', err instanceof Error ? err.message : err)
      }
    }),
  )
  return rows.length
}

// Data-only call push (incoming call / call ended) to the user's 'android-native'
// tokens only — the Capacitor app and web have no killed-app call UI. Returns
// the number of native tokens attempted (0 = none registered / FCM off).
export async function sendNativeCallPush(
  userId: string,
  native: Record<string, string>,
  ttl: string,
): Promise<number> {
  try {
    return await sendFcmToUser(userId, { title: '', body: '', native, nativeTtl: ttl }, { nativeOnly: true })
  } catch (err) {
    console.error(`push: native call push failed for user ${userId}:`, err)
    return 0
  }
}

export async function hasNativeToken(userId: string): Promise<boolean> {
  if (!fcmConfigured) return false
  const { data, error } = await supabaseAdmin
    .from('push_tokens')
    .select('id')
    .eq('user_id', userId)
    .eq('platform', 'android-native')
    .limit(1)
  if (error) throw error
  return (data?.length ?? 0) > 0
}

export interface PushPayload {
  title: string
  body: string
  // Set for /alarm sends only — tells the service worker to show a more
  // intrusive notification (requireInteraction + vibrate + renotify).
  // Real platform limits apply: no OS-level DND bypass exists for web push,
  // and iOS PWA ignores vibrate/custom-sound entirely (see sw.js).
  urgent?: boolean
  // Present for /alarm sends on the native (FCM) transport only — routes the
  // message data-only (see sendFcmToUser) so it always reaches
  // AlarmMessagingService.onMessageReceived, backgrounded or killed, instead
  // of an OS-auto-displayed notification. android/AlarmForegroundService
  // reads `type`/`ack` to start or stop the native ring.
  data?: Record<string, string>
  // Data-only payload for 'android-native' FCM tokens (all message types, plus
  // call pushes). All values must be strings. When set, native tokens get ONLY
  // this (high priority, no notification block); other tokens ignore it.
  native?: Record<string, string>
  // FCM ttl (e.g. '30s') for the native send; omitted = FCM default.
  nativeTtl?: string
}

interface SubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

export async function saveSubscription(
  userId: string,
  endpoint: string,
  keys: { p256dh: string; auth: string },
): Promise<void> {
  assertValidPushEndpoint(endpoint)
  const { error } = await supabaseAdmin
    .from('push_subscriptions')
    .upsert({ user_id: userId, endpoint, p256dh: keys.p256dh, auth: keys.auth }, { onConflict: 'endpoint' })
  if (error) throw error
}

// Delete by endpoint alone: onConflict:'endpoint' in saveSubscription can move
// an endpoint to another user's row, and the endpoint is an unguessable
// capability URL, so the browser that owns it may unsubscribe it regardless.
export async function removeSubscription(endpoint: string): Promise<void> {
  const { error } = await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', endpoint)
  if (error) throw error
}

// Sends to every device the user has subscribed on; prunes any subscription
// the push service reports as gone (410) or not found (404) so dead rows
// don't accumulate.
export async function sendToUser(userId: string, payload: PushPayload): Promise<void> {
  // Fan out to whatever the recipient has registered — web-push subscriptions
  // (PWA) and/or FCM tokens (native). Each transport is gated by its own keys.
  // allSettled, not all: both call sites swallow errors in an empty catch, so
  // one transport failing must neither abort the other nor vanish from the logs.
  const results = await Promise.allSettled([
    sendWebPushToUser(userId, payload),
    sendFcmToUser(userId, payload),
  ])
  const names = ['web-push', 'fcm']
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(`push: ${names[i]} failed for user ${userId}:`, result.reason)
    }
  })
}

// Native (FCM) only. Used when the recipient DOES have a live socket: on the
// Capacitor build the WebView keeps its socket alive while backgrounded
// (KeepRunning defaults true), so "online" does not mean "looking at the chat".
// Safe to send unconditionally on native — @capacitor/push-notifications drops
// a notification-message silently while the app is foreground and the FCM SDK
// shows it in the tray otherwise. Web-push is NOT sent here: sw.js always
// shows a notification, so it stays gated on "no live socket" in sendToUser.
export async function sendNativeToUser(userId: string, payload: PushPayload): Promise<void> {
  try {
    await sendFcmToUser(userId, payload)
  } catch (err) {
    console.error(`push: fcm (online path) failed for user ${userId}:`, err)
  }
}

async function sendWebPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!configured) {
    console.warn(`push: skipped for user ${userId} — VAPID keys not configured`)
    return
  }

  const { data, error } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)
  if (error) throw error

  const rows = (data ?? []) as SubscriptionRow[]
  if (!rows.length) {
    console.log(`push: no subscriptions for user ${userId}`)
    return
  }

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webPush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify(payload),
        )
        console.log(`push: sent to ${row.endpoint.slice(0, 60)}…`)
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('id', row.id)
          console.log(`push: pruned dead subscription ${row.id} (status ${statusCode})`)
        } else {
          console.error(`push: send failed (status ${statusCode ?? 'n/a'}):`, err instanceof Error ? err.message : err)
        }
      }
    }),
  )
}
