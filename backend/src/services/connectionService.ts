import { supabaseAdmin } from '../database/supabaseAdmin.js'

export class ConnectionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

type ConnectionStatus = 'pending' | 'active' | 'leave_pending' | 'terminated' | 'declined'

interface ConnectionRow {
  id: string
  user_a_id: string
  user_b_id: string
  status: ConnectionStatus
  leave_requested_by: string | null
  leave_requested_at: string | null
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
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
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
    if (error.code === 'P0001') throw new ConnectionError(409, 'connection already exists')
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

  return data
}

async function getConnectionForMember(connectionId: string, userId: string): Promise<ConnectionRow> {
  const { data, error } = await supabaseAdmin.from('connections').select().eq('id', connectionId).maybeSingle()
  if (error) throw error
  if (!data) throw new ConnectionError(404, 'connection not found')
  if (data.user_a_id !== userId && data.user_b_id !== userId) {
    throw new ConnectionError(403, 'not a member of this connection')
  }
  return data
}

// A member-scoped read that also requires the connection to be live — for
// writes that make no sense on a pending/declined/terminated connection.
async function getLiveConnectionForMember(connectionId: string, userId: string): Promise<ConnectionRow> {
  const connection = await getConnectionForMember(connectionId, userId)
  if (connection.status !== 'active' && connection.status !== 'leave_pending') {
    throw new ConnectionError(409, 'connection is not active')
  }
  return connection
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
  return transitionStatus(connectionId, 'pending', 'active', 'connection is no longer pending')
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

// Stage E leave model (overrides spec §25 auto-expire): 5 deliberate steps, one per 24h,
// solo-completable — reaching step 5 terminates on its own. See docs/PROGRESS.md.
const LEAVE_STEPS_TOTAL = 5
const LEAVE_STEP_INTERVAL_MS = 24 * 60 * 60 * 1000

interface MemberLeaveRow {
  user_id: string
  nickname: string | null
  leave_step: number
  leave_last_step_at: string | null
  last_read_at: string | null
}

function canAdvance(lastStepAt: string | null): boolean {
  if (!lastStepAt) return true
  return Date.now() - new Date(lastStepAt).getTime() >= LEAVE_STEP_INTERVAL_MS
}

export interface CurrentConnection {
  id: string
  status: ConnectionStatus
  myUserId: string
  isRequester: boolean
  otherNickname: string | null
  otherConnectionCode: string
  myLeaveStep: number
  otherLeaveStep: number
  daysRemaining: number | null
  bothLeaving: boolean
  canAdvanceLeave: boolean
  otherLastReadAt: string | null
  wallpaper: string
}

export async function getCurrentConnection(userId: string): Promise<CurrentConnection | null> {
  // Tolerate >1 row defensively: a race past the single-active guard (see
  // migration 016) must not turn every request into a PGRST116 500 and lock
  // the user out. Newest wins.
  const { data: connRows, error } = await supabaseAdmin
    .from('connections')
    .select()
    .in('status', ['pending', 'active', 'leave_pending'])
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
    .order('updated_at', { ascending: false })
    .limit(1)
  if (error) throw error
  const data = connRows?.[0]
  if (!data) return null

  const otherUserId = data.user_a_id === userId ? data.user_b_id : data.user_a_id
  const [{ data: members }, { data: otherUser }] = await Promise.all([
    supabaseAdmin
      .from('connection_members')
      .select('user_id, nickname, leave_step, leave_last_step_at, last_read_at')
      .eq('connection_id', data.id),
    supabaseAdmin.from('users').select('connection_code').eq('id', otherUserId).maybeSingle(),
  ])

  const rows = (members ?? []) as MemberLeaveRow[]
  const mine = rows.find((m) => m.user_id === userId)
  const other = rows.find((m) => m.user_id === otherUserId)
  const myLeaveStep = mine?.leave_step ?? 0
  const otherLeaveStep = other?.leave_step ?? 0

  return {
    id: data.id,
    status: data.status,
    myUserId: userId,
    isRequester: data.user_a_id === userId,
    otherNickname: other?.nickname ?? null,
    otherConnectionCode: otherUser?.connection_code ?? '',
    myLeaveStep,
    otherLeaveStep,
    daysRemaining: myLeaveStep > 0 ? LEAVE_STEPS_TOTAL - myLeaveStep : null,
    bothLeaving: myLeaveStep > 0 && otherLeaveStep > 0,
    canAdvanceLeave: canAdvance(mine?.leave_last_step_at ?? null),
    otherLastReadAt: other?.last_read_at ?? null,
    wallpaper: data.wallpaper ?? 'off',
  }
}

// Mark the conversation read up to now for this member (drives the other
// member's "Seen" indicator). Connection state, not a message — kept off Transport.
export async function markRead(connectionId: string, userId: string): Promise<void> {
  await getLiveConnectionForMember(connectionId, userId)
  const { error } = await supabaseAdmin
    .from('connection_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('connection_id', connectionId)
    .eq('user_id', userId)
  if (error) throw error
}

async function getMemberLeave(connectionId: string, userId: string): Promise<MemberLeaveRow> {
  const { data, error } = await supabaseAdmin
    .from('connection_members')
    .select('user_id, nickname, leave_step, leave_last_step_at, last_read_at')
    .eq('connection_id', connectionId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new ConnectionError(404, 'connection membership not found')
  return data as MemberLeaveRow
}

// Termination deletes the whole conversation — the data belongs to the
// participants (they can export first). connection_members + messages cascade
// off the connection FK (on delete cascade), so one delete clears everything.
async function terminate(connectionId: string): Promise<void> {
  const { error } = await supabaseAdmin.from('connections').delete().eq('id', connectionId)
  if (error) throw error
}

export interface LeaveResult {
  status: ConnectionStatus
  myLeaveStep: number
  daysRemaining: number | null
  bothLeaving: boolean
  terminated: boolean
}

// Advance MY leave countdown by one step (gated to once per 24h). Reaching the
// final step terminates the connection solo — no agreement from the other member.
export async function advanceLeave(connectionId: string, userId: string): Promise<LeaveResult> {
  const connection = await getConnectionForMember(connectionId, userId)
  if (connection.status !== 'active' && connection.status !== 'leave_pending') {
    throw new ConnectionError(409, 'connection is not active')
  }

  const mine = await getMemberLeave(connectionId, userId)
  if (!canAdvance(mine.leave_last_step_at)) {
    throw new ConnectionError(429, 'you can advance the countdown once every 24 hours')
  }

  // Conditional update: pin the from-step and re-assert the 24h gate in the
  // WHERE clause so two parallel requests can't both advance / both bypass the
  // cooldown from stale reads. 0 rows = another request got there first.
  const newStep = mine.leave_step + 1
  const cutoff = new Date(Date.now() - LEAVE_STEP_INTERVAL_MS).toISOString()
  const { data: updated, error } = await supabaseAdmin
    .from('connection_members')
    .update({ leave_step: newStep, leave_last_step_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('connection_id', connectionId)
    .eq('user_id', userId)
    .eq('leave_step', mine.leave_step)
    .or(`leave_last_step_at.is.null,leave_last_step_at.lt.${cutoff}`)
    .select('user_id')
    .maybeSingle()
  if (error) throw error
  if (!updated) throw new ConnectionError(429, 'the countdown was already advanced')

  if (newStep >= LEAVE_STEPS_TOTAL) {
    await terminate(connectionId)
    return { status: 'terminated', myLeaveStep: newStep, daysRemaining: 0, bothLeaving: false, terminated: true }
  }

  if (connection.status !== 'leave_pending') {
    const { error: statusError } = await supabaseAdmin
      .from('connections')
      .update({ status: 'leave_pending', updated_at: new Date().toISOString() })
      .eq('id', connectionId)
    if (statusError) throw statusError
  }

  const other = await getMemberLeave(connectionId, userId === connection.user_a_id ? connection.user_b_id : connection.user_a_id)
  return {
    status: 'leave_pending',
    myLeaveStep: newStep,
    daysRemaining: LEAVE_STEPS_TOTAL - newStep,
    bothLeaving: newStep > 0 && other.leave_step > 0,
    terminated: false,
  }
}

// Cancel MY leave countdown. If neither member is leaving anymore, connection returns to active.
export async function cancelLeave(connectionId: string, userId: string): Promise<LeaveResult> {
  const connection = await getConnectionForMember(connectionId, userId)
  if (connection.status !== 'leave_pending') throw new ConnectionError(409, 'no leave in progress')

  const { error } = await supabaseAdmin
    .from('connection_members')
    .update({ leave_step: 0, leave_last_step_at: null, updated_at: new Date().toISOString() })
    .eq('connection_id', connectionId)
    .eq('user_id', userId)
  if (error) throw error

  const otherUserId = userId === connection.user_a_id ? connection.user_b_id : connection.user_a_id
  const other = await getMemberLeave(connectionId, otherUserId)
  let status: ConnectionStatus = 'leave_pending'
  if (other.leave_step === 0) {
    const { error: statusError } = await supabaseAdmin
      .from('connections')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', connectionId)
    if (statusError) throw statusError
    status = 'active'
  }

  return { status, myLeaveStep: 0, daysRemaining: null, bothLeaving: false, terminated: false }
}

// Mutual fast-path: when BOTH members are leaving, either can end immediately,
// skipping the remaining days. Requires both steps > 0.
export async function confirmEndLeave(connectionId: string, userId: string): Promise<LeaveResult> {
  const connection = await getConnectionForMember(connectionId, userId)
  if (connection.status !== 'leave_pending') throw new ConnectionError(409, 'no leave in progress')

  const otherUserId = userId === connection.user_a_id ? connection.user_b_id : connection.user_a_id
  const [mine, other] = await Promise.all([
    getMemberLeave(connectionId, userId),
    getMemberLeave(connectionId, otherUserId),
  ])
  if (mine.leave_step === 0 || other.leave_step === 0) {
    throw new ConnectionError(409, 'both members must be leaving to end immediately')
  }

  await terminate(connectionId)
  return { status: 'terminated', myLeaveStep: mine.leave_step, daysRemaining: 0, bothLeaving: true, terminated: true }
}

const ALLOWED_WALLPAPERS = ['off', '1', 'love', 'samurai']

// Wallpaper is shared per-connection (unlike message style/theme, which stay
// per-device localStorage preferences) — either member's choice applies to both.
export async function setWallpaper(connectionId: string, userId: string, wallpaper: string): Promise<void> {
  await getLiveConnectionForMember(connectionId, userId)
  if (!ALLOWED_WALLPAPERS.includes(wallpaper)) throw new ConnectionError(400, 'invalid wallpaper')

  const { error } = await supabaseAdmin
    .from('connections')
    .update({ wallpaper, updated_at: new Date().toISOString() })
    .eq('id', connectionId)
  if (error) throw error
}

export async function setNickname(connectionId: string, userId: string, nickname: string): Promise<void> {
  const connection = await getLiveConnectionForMember(connectionId, userId)

  const trimmed = nickname.trim()
  if (trimmed.length < 1 || trimmed.length > 40) {
    throw new ConnectionError(400, 'nickname must be 1-40 characters')
  }

  // Nicknames are local (spec §11): this sets what I call the OTHER person,
  // stored on their member row — not a name I give myself.
  const otherUserId = connection.user_a_id === userId ? connection.user_b_id : connection.user_a_id

  const { error } = await supabaseAdmin
    .from('connection_members')
    .update({ nickname: trimmed, updated_at: new Date().toISOString() })
    .eq('connection_id', connectionId)
    .eq('user_id', otherUserId)
  if (error) throw error
}
