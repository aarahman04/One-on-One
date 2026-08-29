import webPush from 'web-push'
import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { ConnectionError } from './connectionService.js'

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

export function assertValidPushEndpoint(raw: string): void {
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

export interface PushPayload {
  title: string
  body: string
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

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('push_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('endpoint', endpoint)
  if (error) throw error
}

// Sends to every device the user has subscribed on; prunes any subscription
// the push service reports as gone (410) or not found (404) so dead rows
// don't accumulate.
export async function sendToUser(userId: string, payload: PushPayload): Promise<void> {
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
