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

export interface CurrentConnection {
  id: string
  status: ConnectionStatus
  myUserId: string
  isRequester: boolean
  otherNickname: string | null
  otherConnectionCode: string
  leaveRequestedByMe: boolean | null
  leaveRequestedAt: string | null
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
  const [{ data: member }, { data: otherUser }] = await Promise.all([
    supabaseAdmin
      .from('connection_members')
      .select('nickname')
      .eq('connection_id', data.id)
      .eq('user_id', otherUserId)
      .maybeSingle(),
    supabaseAdmin.from('users').select('connection_code').eq('id', otherUserId).single(),
  ])

  return {
    id: data.id,
    status: data.status,
    myUserId: userId,
    isRequester: data.user_a_id === userId,
    otherNickname: member?.nickname ?? null,
    otherConnectionCode: otherUser?.connection_code ?? '',
    leaveRequestedByMe: data.leave_requested_by ? data.leave_requested_by === userId : null,
    leaveRequestedAt: data.leave_requested_at,
  }
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
