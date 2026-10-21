import { setTimeout as delay } from 'node:timers/promises'
import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { ENDED_RETENTION_MS, isLiveStatus, otherMemberId } from '../utils/connections.js'
import { RAISE_EXCEPTION } from '../utils/pgErrors.js'
import { getConnectionForMember, memberOrFilter } from './connectionAccess.js'
import { ConnectionError } from '../utils/connectionError.js'
import { deleteConnectionAttachments } from './attachmentService.js'
import { forceEndCall } from './callService.js'
import { addBlock, isBlockedBetween } from './blockService.js'
import { avatarIds } from './avatarService.js'
import { sendToUser } from './pushService.js'

// Re-exported for the many call sites that import it from here.
export { ConnectionError }

type ConnectionStatus = 'pending' | 'active' | 'leave_pending' | 'terminated' | 'declined' | 'ended'

interface ConnectionRow {
  id: string
  user_a_id: string
  user_b_id: string
  status: ConnectionStatus
  created_at: string
}

async function findUserByConnectionCode(code: string): Promise<{ id: string } | null> {
  const { data, error } = await supabaseAdmin.from('users').select('id').eq('connection_code', code).maybeSingle()
  if (error) throw error
  return data
}

async function hasActiveOrPendingConnection(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('connections')
    .select('id')
    .in('status', ['pending', 'active', 'leave_pending'])
    .or(memberOrFilter(userId))
    .limit(1)
  if (error) throw error
  return (data?.length ?? 0) > 0
}

export async function requestConnection(requesterUserId: string, targetCode: string): Promise<ConnectionRow> {
  // One generic failure for "can't connect to that code" so the response can't
  // be used to enumerate which codes are real users or who is already paired.
  // The specific reason is logged, not returned.
  const cannotConnect = new ConnectionError(404, "couldn't send a request to that connection ID")

  if (await hasActiveOrPendingConnection(requesterUserId)) {
    throw new ConnectionError(409, 'you already have an active or pending connection')
  }

  const target = await findUserByConnectionCode(targetCode)
  if (!target) {
    console.warn('requestConnection: unknown code')
    throw cannotConnect
  }
  if (target.id === requesterUserId) throw new ConnectionError(400, "that's your own connection ID")
  if (await isBlockedBetween(requesterUserId, target.id)) {
    // Either direction — the blocker or the blocked user. Same generic failure
    // as an unknown code so neither side can probe the block's existence.
    console.warn('requestConnection: blocked pair')
    throw cannotConnect
  }
  if (await hasActiveOrPendingConnection(target.id)) {
    console.warn('requestConnection: target already has a live connection')
    throw cannotConnect
  }

  const { data, error } = await supabaseAdmin
    .from('connections')
    .insert({ user_a_id: requesterUserId, user_b_id: target.id, status: 'pending' })
    .select()
    .single()

  if (error) {
    if (error.code === RAISE_EXCEPTION) {
      // Migration 033's trigger backstop caught a blocked pair (race between
      // the isBlockedBetween check above and this insert, or a caller that
      // skipped it) — same generic, enumeration-safe failure as an unknown
      // code, never a message distinguishable from migration 016's guard.
      if (error.message?.includes('connection blocked between this pair')) throw cannotConnect
      throw new ConnectionError(409, 'connection already exists')
    }
    throw error
  }

  const { error: memberError } = await supabaseAdmin.from('connection_members').insert([
    { connection_id: data.id, user_id: requesterUserId },
    { connection_id: data.id, user_id: target.id },
  ])
  if (memberError) {
    // The connection row is already committed; without both member rows the
    // leave/nickname/current-connection paths break. Roll it back.
    await supabaseAdmin.from('connections').delete().eq('id', data.id)
    throw memberError
  }

  await purgeEndedForPartner(requesterUserId)
  return data
}

// Conditional status transition: the UPDATE itself carries the from-state, so
// concurrent accept/accept or accept/decline can't both win or resurrect a
// just-declined row. 0 rows updated = someone else moved it first.
async function transitionStatus(
  connectionId: string,
  from: ConnectionStatus,
  to: ConnectionStatus,
  conflictMessage: string,
): Promise<ConnectionRow> {
  const { data, error } = await supabaseAdmin
    .from('connections')
    .update({ status: to, updated_at: new Date().toISOString() })
    .eq('id', connectionId)
    .eq('status', from)
    .select()
    .maybeSingle()
  if (error) throw error
  if (!data) throw new ConnectionError(409, conflictMessage)
  return data
}

export async function acceptConnection(connectionId: string, userId: string): Promise<ConnectionRow> {
  const connection = await getConnectionForMember(connectionId, userId)
  if (connection.user_b_id !== userId) throw new ConnectionError(403, 'only the recipient can accept')
  // Defense-in-depth: a block landing between request and accept (the request
  // already existed as 'pending' before the block was written, so
  // requestConnection's own isBlockedBetween check never saw it) must not be
  // acceptable. Same generic wording as the block trigger's mapped error.
  if (await isBlockedBetween(userId, otherMemberId(connection, userId))) {
    throw new ConnectionError(409, "couldn't send a request to that connection ID")
  }
  const accepted = await transitionStatus(connectionId, 'pending', 'active', 'connection is no longer pending')
  await purgeEndedForPartner(userId)
  return accepted
}

export async function declineConnection(connectionId: string, userId: string): Promise<ConnectionRow> {
  const connection = await getConnectionForMember(connectionId, userId)
  if (connection.user_b_id !== userId) throw new ConnectionError(403, 'only the recipient can decline')
  return transitionStatus(connectionId, 'pending', 'declined', 'connection is no longer pending')
}

// The requester withdrawing their own outbound request (mistyped code, no
// response). Without this a stale pending row blocks both users forever.
export async function cancelRequest(connectionId: string, userId: string): Promise<ConnectionRow> {
  const connection = await getConnectionForMember(connectionId, userId)
  if (connection.user_a_id !== userId) throw new ConnectionError(403, 'only the requester can cancel')
  return transitionStatus(connectionId, 'pending', 'declined', 'connection is no longer pending')
}

// The old 5-step / 24h leave countdown (Stage E) is gone — leaving is instant
// (leaveConnection). The step fields stay in CurrentConnection so Android
// 2.0.5 keeps parsing; migration 039 reset them to 0 / null.
const LEAVE_STEPS_TOTAL = 5
const LEAVE_STEP_INTERVAL_MS = 24 * 60 * 60 * 1000

interface MemberLeaveRow {
  user_id: string
  nickname: string | null
  leave_step: number
  leave_last_step_at: string | null
  last_read_at: string | null
  last_delivered_at?: string | null
}

function canAdvance(lastStepAt: string | null): boolean {
  if (!lastStepAt) return true
  return Date.now() - new Date(lastStepAt).getTime() >= LEAVE_STEP_INTERVAL_MS
}

interface CurrentConnection {
  id: string
  status: ConnectionStatus
  myUserId: string
  isRequester: boolean
  otherNickname: string | null
  // What the other member calls me (the nickname they set, stored on my row).
  myNickname: string | null
  otherConnectionCode: string
  myLeaveStep: number
  otherLeaveStep: number
  daysRemaining: number | null
  bothLeaving: boolean
  canAdvanceLeave: boolean
  otherLastReadAt: string | null
  otherLastDeliveredAt: string | null
  wallpaper: string
  messageStyle: string
  pinnedMessageId: string | null
  pinnedBy: string | null
  pinnedAt: string | null
  // Opaque ids of the current profile photos (change on replace); null = none or not live.
  myAvatarId: string | null
  otherAvatarId: string | null
  // Set only for status 'ended' (shown to the partner, never the leaver).
  endedBy: string | null
  endedAt: string | null
  purgeAt: string | null
}

interface CurrentConnectionRow {
  id: string
  status: ConnectionStatus
  user_a_id: string
  user_b_id: string
  wallpaper: string | null
  message_style: string | null
  pinned_message_id: string | null
  pinned_by: string | null
  pinned_at: string | null
  ended_at: string | null
  ended_by: string | null
  connection_members: MemberLeaveRow[]
}

const CURRENT_SELECT =
  'id, status, user_a_id, user_b_id, wallpaper, message_style, pinned_message_id, pinned_by, pinned_at, ended_at, ended_by, ' +
  'connection_members(user_id, nickname, leave_step, leave_last_step_at, last_read_at, last_delivered_at)'

function purgeAtFor(endedAt: string): string {
  return new Date(new Date(endedAt).getTime() + ENDED_RETENTION_MS).toISOString()
}

export async function getCurrentConnection(userId: string): Promise<CurrentConnection | null> {
  // One query: the connection plus its two member rows (embedded). Tolerate >1
  // connection row defensively — a race past the single-active guard (migration
  // 016) must not 500 every request and lock the user out. Newest wins.
  const { data: connRows, error } = await supabaseAdmin
    .from('connections')
    .select(CURRENT_SELECT)
    .in('status', ['pending', 'active', 'leave_pending'])
    .or(memberOrFilter(userId))
    .order('updated_at', { ascending: false })
    .limit(1)
  if (error) throw error
  let data = (connRows?.[0] as unknown as CurrentConnectionRow | undefined) ?? null
  if (!data) {
    // Nothing live: the partner of a connection the OTHER member left still
    // gets it (read-only) until they acknowledge or the 7 days run out. The
    // leaver never matches (ended_by = them) and sees "no connection".
    const { data: endedRows, error: endedError } = await supabaseAdmin
      .from('connections')
      .select(CURRENT_SELECT)
      .eq('status', 'ended')
      .neq('ended_by', userId)
      .gt('ended_at', new Date(Date.now() - ENDED_RETENTION_MS).toISOString())
      .or(memberOrFilter(userId))
      .order('ended_at', { ascending: false })
      .limit(1)
    if (endedError) throw endedError
    data = (endedRows?.[0] as unknown as CurrentConnectionRow | undefined) ?? null
  }
  if (!data) return null

  const otherUserId = otherMemberId(data, userId)
  const rows = data.connection_members ?? []
  const mine = rows.find((m) => m.user_id === userId)
  const other = rows.find((m) => m.user_id === otherUserId)
  const myLeaveStep = mine?.leave_step ?? 0
  const otherLeaveStep = other?.leave_step ?? 0

  // The other member's connection code is only rendered on the pending-request
  // screen — the active-chat poll (every ~4s) never reads it, so skip the users
  // lookup unless we're actually pending.
  let otherConnectionCode = ''
  if (data.status === 'pending') {
    const { data: otherUser } = await supabaseAdmin
      .from('users')
      .select('connection_code')
      .eq('id', otherUserId)
      .maybeSingle()
    otherConnectionCode = otherUser?.connection_code ?? ''
  }

  const avatars = isLiveStatus(data.status) ? await avatarIds(userId, otherUserId) : { mine: null, other: null }

  return {
    id: data.id,
    status: data.status,
    myUserId: userId,
    isRequester: data.user_a_id === userId,
    otherNickname: other?.nickname ?? null,
    myNickname: mine?.nickname ?? null,
    otherConnectionCode,
    myLeaveStep,
    otherLeaveStep,
    daysRemaining: myLeaveStep > 0 ? LEAVE_STEPS_TOTAL - myLeaveStep : null,
    bothLeaving: myLeaveStep > 0 && otherLeaveStep > 0,
    canAdvanceLeave: canAdvance(mine?.leave_last_step_at ?? null),
    otherLastReadAt: other?.last_read_at ?? null,
    otherLastDeliveredAt: other?.last_delivered_at ?? null,
    wallpaper: data.wallpaper ?? 'off',
    messageStyle: data.message_style ?? 'bubbles',
    pinnedMessageId: data.pinned_message_id ?? null,
    pinnedBy: data.pinned_by ?? null,
    pinnedAt: data.pinned_at ?? null,
    myAvatarId: avatars.mine,
    otherAvatarId: avatars.other,
    endedBy: data.status === 'ended' ? data.ended_by : null,
    endedAt: data.status === 'ended' ? data.ended_at : null,
    purgeAt: data.status === 'ended' && data.ended_at ? purgeAtFor(data.ended_at) : null,
  }
}

// Mark the conversation read up to now for this member (drives the other
// member's "Seen" indicator). Connection state, not a message — kept off Transport.
export type ReceiptPatch = { lastReadAt?: string; lastDeliveredAt?: string }
let receiptEmitter: ((connectionId: string, userId: string, patch: ReceiptPatch) => void) | null = null

// Registered by socketServer so this module needn't import it (circular).
export function setReceiptEmitter(fn: typeof receiptEmitter): void {
  receiptEmitter = fn
}

export async function markRead(connectionId: string, userId: string): Promise<void> {
  await getConnectionForMember(connectionId, userId, { requireLive: true })
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('connection_members')
    .update({ last_read_at: now })
    .eq('connection_id', connectionId)
    .eq('user_id', userId)
  if (error) throw error
  receiptEmitter?.(connectionId, userId, { lastReadAt: now })
}

// Mark messages as delivered to this member as of now (drives the other
// member's "delivered" tick). Bumped when a socket connects/joins a
// connection room and, inline, when a message is sent to an already-live
// recipient — see socketServer.ts. Kept off Transport, same as markRead.
export async function markDelivered(connectionId: string, userId: string): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('connection_members')
    .update({ last_delivered_at: now })
    .eq('connection_id', connectionId)
    .eq('user_id', userId)
  if (error) throw error
  receiptEmitter?.(connectionId, userId, { lastDeliveredAt: now })
}

const RETRY_DELAY_MS = 500

// Storage deletes can hiccup; three tries with a short backoff before giving up.
async function withRetry(fn: () => Promise<void>, attempts = 3): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i >= attempts) throw err
      await delay(RETRY_DELAY_MS * i)
    }
  }
}

// Block-and-end only: the connection row goes first (safety beats tidiness);
// connection_members + messages cascade off its FK. Storage is cleaned after,
// with retries; a leftover object under a dead prefix is unreachable anyway
// (every route checks membership first) and is logged.
async function terminate(connectionId: string): Promise<void> {
  // The connection is the app's authorization unit (spec §20) — a live call
  // has no basis to keep running once it's gone.
  forceEndCall(connectionId)

  const { error } = await supabaseAdmin.from('connections').delete().eq('id', connectionId)
  if (error) throw error

  try {
    await withRetry(() => deleteConnectionAttachments(connectionId))
  } catch (err) {
    console.error(`terminate: failed to clean up attachments for ${connectionId}`, err)
  }
}

// Hard delete of an ended connection: every Storage object (all pages, with
// retries) FIRST, then the row (members/messages cascade). If Storage still
// fails the row survives, so the hourly sweep retries instead of orphaning
// objects nobody could list again.
export async function purgeConnection(connectionId: string): Promise<void> {
  await withRetry(() => deleteConnectionAttachments(connectionId))
  const { error } = await supabaseAdmin.from('connections').delete().eq('id', connectionId)
  if (error) throw error
}

// Starting a new connection implicitly acknowledges any ended one this user
// was left by. Best-effort: the sweep still purges it within 7 days.
async function purgeEndedForPartner(userId: string): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin
      .from('connections')
      .select('id')
      .eq('status', 'ended')
      .neq('ended_by', userId)
      .or(memberOrFilter(userId))
    if (error) throw error
    for (const row of data ?? []) await purgeConnection(row.id)
  } catch (err) {
    console.error('purgeEndedForPartner failed (sweep will retry)', err)
  }
}

interface LeaveResult {
  status: ConnectionStatus
  // Legacy countdown fields, kept so Android 2.0.5 still parses the response.
  myLeaveStep: number
  daysRemaining: number | null
  bothLeaving: boolean
  terminated: boolean
  endedAt: string
  purgeAt: string
}

// Instant leave: one tap ends the connection for both. The leaver's access
// stops now and they (and the partner) can start a new connection at once —
// 'ended' isn't a live status, so migration 016's guards ignore it. The
// partner keeps read-only history until acknowledge-end or ended_at + 7 days.
export async function leaveConnection(connectionId: string, userId: string): Promise<LeaveResult> {
  const connection = await getConnectionForMember(connectionId, userId, { requireLive: true })
  const endedAt = new Date().toISOString()
  // Conditional on still-live status: a double tap, or both members leaving at
  // once, ends it exactly once; the loser gets 409 and is the partner.
  const { data, error } = await supabaseAdmin
    .from('connections')
    .update({ status: 'ended', ended_at: endedAt, ended_by: userId, updated_at: endedAt })
    .eq('id', connectionId)
    .in('status', ['active', 'leave_pending'])
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new ConnectionError(409, 'connection is not active')

  // Same reason as terminate(): no call outlives the connection.
  forceEndCall(connectionId)
  void notifyPartnerLeft(connection, userId)
  return {
    status: 'ended',
    myLeaveStep: LEAVE_STEPS_TOTAL,
    daysRemaining: 0,
    bothLeaving: false,
    terminated: true,
    endedAt,
    purgeAt: purgeAtFor(endedAt),
  }
}

// Push to the partner. The title uses what the partner calls the leaver —
// stored on the leaver's own member row (nicknames are local, spec §11).
async function notifyPartnerLeft(
  connection: { id: string; user_a_id: string; user_b_id: string },
  leaverId: string,
): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from('connection_members')
      .select('nickname')
      .eq('connection_id', connection.id)
      .eq('user_id', leaverId)
      .maybeSingle()
    const title = `${data?.nickname || 'Your connection'} left the connection`
    const body = 'Open One on One to save your conversation.'
    await sendToUser(otherMemberId(connection, leaverId), {
      title,
      body,
      native: { type: 'connection_left', connectionId: connection.id, title, body },
    })
  } catch (err) {
    console.error(`leave: partner push failed for ${connection.id}`, err)
  }
}

// The partner is done with the read-only history (saved or not): purge now.
export async function acknowledgeEnd(connectionId: string, userId: string): Promise<void> {
  const connection = await getConnectionForMember(connectionId, userId)
  if (connection.status !== 'ended') throw new ConnectionError(409, 'connection has not ended')
  if (connection.ended_by === userId) throw new ConnectionError(403, 'only the other member can acknowledge')
  await purgeConnection(connectionId)
}

// Purge every ended connection past its 7-day window. Overlap-guarded so a
// slow run (big Storage prefixes) never runs twice at once; one failing
// connection is logged and retried next run without blocking the others.
const SWEEP_INTERVAL_MS = 60 * 60 * 1000
let sweeping = false
export async function sweepEndedConnections(now = Date.now()): Promise<number> {
  if (sweeping) return 0
  sweeping = true
  try {
    const { data, error } = await supabaseAdmin
      .from('connections')
      .select('id')
      .eq('status', 'ended')
      .lte('ended_at', new Date(now - ENDED_RETENTION_MS).toISOString())
      .limit(500)
    if (error) throw error
    let purged = 0
    for (const row of data ?? []) {
      try {
        await purgeConnection(row.id)
        purged++
      } catch (err) {
        console.error(`sweep: purge failed for ${row.id} (retrying next run)`, err)
      }
    }
    if (purged) console.log(`sweep: purged ${purged} ended connection(s)`)
    return purged
  } finally {
    sweeping = false
  }
}

// Once at startup, then hourly. unref'd so it never keeps the process alive.
export function startEndedConnectionSweeper(): void {
  const run = (): void => {
    sweepEndedConnections().catch((err) => console.error('sweep failed', err))
  }
  run()
  setInterval(run, SWEEP_INTERVAL_MS).unref()
}

// "Block & end" (Play UGC safety): end the connection immediately — no 5-step
// countdown, no agreement from the other member — and record a permanent block
// so the pair can never send each other a request again (checked in
// requestConnection). The block is written first so the safety guarantee holds
// even if the terminate step hiccups. Returns the blocked user's id.
export async function blockAndTerminate(connectionId: string, userId: string): Promise<string> {
  const connection = await getConnectionForMember(connectionId, userId, { requireLive: true })
  const blockedUserId = otherMemberId(connection, userId)
  await addBlock(userId, blockedUserId)
  await terminate(connectionId)
  return blockedUserId
}

const ALLOWED_WALLPAPERS = ['off', 'love', 'samurai']
const ALLOWED_STYLES = ['line', 'bubbles']

// Wallpaper is shared per-connection (unlike theme, which stays a per-device
// localStorage preference) — either member's choice applies to both. Returns
// whether the value actually changed, so the caller (routes/connections.ts)
// can skip emitting a chat notice on a no-op re-select of the current value.
export async function setWallpaper(connectionId: string, userId: string, wallpaper: string): Promise<boolean> {
  await getConnectionForMember(connectionId, userId, { requireLive: true })
  if (!ALLOWED_WALLPAPERS.includes(wallpaper)) throw new ConnectionError(400, 'invalid wallpaper')

  const { data: current, error: selectError } = await supabaseAdmin
    .from('connections')
    .select('wallpaper')
    .eq('id', connectionId)
    .maybeSingle()
  if (selectError) throw selectError
  if ((current?.wallpaper ?? 'off') === wallpaper) return false

  const { error } = await supabaseAdmin
    .from('connections')
    .update({ wallpaper, updated_at: new Date().toISOString() })
    .eq('id', connectionId)
  if (error) throw error
  return true
}

// Message style (bubbles/line) is shared per-connection, same model as
// wallpaper above — either member's choice applies to both. Theme stays a
// per-device localStorage preference. Same changed/unchanged return as
// setWallpaper.
export async function setMessageStyle(connectionId: string, userId: string, style: string): Promise<boolean> {
  await getConnectionForMember(connectionId, userId, { requireLive: true })
  if (!ALLOWED_STYLES.includes(style)) throw new ConnectionError(400, 'invalid message style')

  const { data: current, error: selectError } = await supabaseAdmin
    .from('connections')
    .select('message_style')
    .eq('id', connectionId)
    .maybeSingle()
  if (selectError) throw selectError
  if ((current?.message_style ?? 'bubbles') === style) return false

  const { error } = await supabaseAdmin
    .from('connections')
    .update({ message_style: style, updated_at: new Date().toISOString() })
    .eq('id', connectionId)
  if (error) throw error
  return true
}

export async function setNickname(connectionId: string, userId: string, nickname: string): Promise<void> {
  const connection = await getConnectionForMember(connectionId, userId, { requireLive: true })

  const trimmed = nickname.trim()
  if (trimmed.length < 1 || trimmed.length > 40) {
    throw new ConnectionError(400, 'nickname must be 1-40 characters')
  }

  // Nicknames are local (spec §11): this sets what I call the OTHER person,
  // stored on their member row — not a name I give myself.
  const otherUserId = otherMemberId(connection, userId)

  const { error } = await supabaseAdmin
    .from('connection_members')
    .update({ nickname: trimmed, updated_at: new Date().toISOString() })
    .eq('connection_id', connectionId)
    .eq('user_id', otherUserId)
  if (error) throw error
}
