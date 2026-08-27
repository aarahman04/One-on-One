import webPush from 'web-push'
import { supabaseAdmin } from '../database/supabaseAdmin.js'

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
  if (!configured) return

  const { data, error } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)
  if (error) throw error

  const rows = (data ?? []) as SubscriptionRow[]
  if (!rows.length) return

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webPush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify(payload),
        )
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('id', row.id)
        }
      }
    }),
  )
}
