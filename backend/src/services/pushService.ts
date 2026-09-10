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

interface FcmTokenRow {
  id: string
  token: string
}

export async function saveToken(userId: string, token: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('push_tokens')
    .upsert({ user_id: userId, token, platform: 'android' }, { onConflict: 'token' })
  if (error) throw error
}

export async function removeToken(token: string): Promise<void> {
  const { error } = await supabaseAdmin.from('push_tokens').delete().eq('token', token)
  if (error) throw error
}

// Sends a payload to every FCM token the user has registered; prunes any token
// FCM reports as UNREGISTERED / INVALID_ARGUMENT (mirrors the 404/410 pruning
// on the web-push side).
async function sendFcmToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!fcmConfigured) return

  const { data, error } = await supabaseAdmin.from('push_tokens').select('id, token').eq('user_id', userId)
  if (error) throw error
  const rows = (data ?? []) as FcmTokenRow[]
  if (!rows.length) return

  const accessToken = await getFcmAccessToken()
  const url = `https://fcm.googleapis.com/v1/projects/${serviceAccount!.project_id}/messages:send`

  await Promise.all(
    rows.map(async (row) => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: row.token,
              notification: { title: payload.title, body: payload.body },
              android: {
                priority: 'high',
                notification: {
                  channel_id: 'messages',
                  notification_priority: payload.urgent ? 'PRIORITY_MAX' : 'PRIORITY_DEFAULT',
                },
              },
              data: { urgent: payload.urgent ? 'true' : 'false' },
            },
          }),
        })
        if (res.ok) {
          console.log(`fcm: sent to ${row.token.slice(0, 12)}…`)
          return
        }
        const errBody = (await res.json().catch(() => ({}))) as { error?: { status?: string } }
        const status = errBody.error?.status
        if (res.status === 404 || status === 'UNREGISTERED' || status === 'INVALID_ARGUMENT' || res.status === 400) {
          await supabaseAdmin.from('push_tokens').delete().eq('id', row.id)
          console.log(`fcm: pruned dead token ${row.id} (status ${res.status} ${status ?? ''})`)
        } else {
          console.error(`fcm: send failed (status ${res.status} ${status ?? ''})`)
        }
      } catch (err) {
        console.error('fcm: send error:', err instanceof Error ? err.message : err)
      }
    }),
  )
}

interface PushPayload {
  title: string
  body: string
  // Set for /alarm sends only — tells the service worker to show a more
  // intrusive notification (requireInteraction + vibrate + renotify).
  // Real platform limits apply: no OS-level DND bypass exists for web push,
  // and iOS PWA ignores vibrate/custom-sound entirely (see sw.js).
  urgent?: boolean
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
