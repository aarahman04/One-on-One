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
  const target = await findUserByConnectionCode(targetCode)
  if (!target) throw new ConnectionError(404, 'connection ID not found')
  if (target.id === requesterUserId) throw new ConnectionError(400, "that's your own connection ID")

  if (await hasActiveOrPendingConnection(requesterUserId)) {
    throw new ConnectionError(409, 'you already have an active or pending connection')
  }
  if (await hasActiveOrPendingConnection(target.id)) {
    throw new ConnectionError(409, 'that person already has an active or pending connection')
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

  await supabaseAdmin.from('connection_members').insert([
    { connection_id: data.id, user_id: requesterUserId },
    { connection_id: data.id, user_id: target.id },
  ])

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

export async function acceptConnection(connectionId: string, userId: string): Promise<ConnectionRow> {
  const connection = await getConnectionForMember(connectionId, userId)
  if (connection.status !== 'pending') throw new ConnectionError(409, 'connection is not pending')
  if (connection.user_b_id !== userId) throw new ConnectionError(403, 'only the recipient can accept')

  const { data, error } = await supabaseAdmin
    .from('connections')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', connectionId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function declineConnection(connectionId: string, userId: string): Promise<ConnectionRow> {
  const connection = await getConnectionForMember(connectionId, userId)
  if (connection.status !== 'pending') throw new ConnectionError(409, 'connection is not pending')
  if (connection.user_b_id !== userId) throw new ConnectionError(403, 'only the recipient can decline')

  const { data, error } = await supabaseAdmin
    .from('connections')
    .update({ status: 'declined', updated_at: new Date().toISOString() })
    .eq('id', connectionId)
    .select()
    .single()
  if (error) throw error
  return data
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
  const { data, error } = await supabaseAdmin
    .from('connections')
    .select()
    .in('status', ['pending', 'active', 'leave_pending'])
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const otherUserId = data.user_a_id === userId ? data.user_b_id : data.user_a_id
  const [{ data: members }, { data: otherUser }] = await Promise.all([
    supabaseAdmin
      .from('connection_members')
      .select('user_id, nickname, leave_step, leave_last_step_at, last_read_at')
      .eq('connection_id', data.id),
    supabaseAdmin.from('users').select('connection_code').eq('id', otherUserId).single(),
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
  await getConnectionForMember(connectionId, userId)
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
    .single()
  if (error) throw error
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

  const newStep = mine.leave_step + 1
  const { error } = await supabaseAdmin
    .from('connection_members')
    .update({ leave_step: newStep, leave_last_step_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('connection_id', connectionId)
    .eq('user_id', userId)
  if (error) throw error

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

const ALLOWED_WALLPAPERS = ['off', '1', '2', 'love']

// Wallpaper is shared per-connection (unlike message style/theme, which stay
// per-device localStorage preferences) — either member's choice applies to both.
export async function setWallpaper(connectionId: string, userId: string, wallpaper: string): Promise<void> {
  await getConnectionForMember(connectionId, userId)
  if (!ALLOWED_WALLPAPERS.includes(wallpaper)) throw new ConnectionError(400, 'invalid wallpaper')

  const { error } = await supabaseAdmin
    .from('connections')
    .update({ wallpaper, updated_at: new Date().toISOString() })
    .eq('id', connectionId)
  if (error) throw error
}

export async function setNickname(connectionId: string, userId: string, nickname: string): Promise<void> {
  const connection = await getConnectionForMember(connectionId, userId)

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
