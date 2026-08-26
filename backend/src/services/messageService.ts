import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { ConnectionError } from './connectionService.js'

export interface Message {
  id: string
  senderId: string
  content: string
  createdAt: string
}

interface MessageRow {
  id: string
  sender_id: string
  content: string
  created_at: string
}

function toMessage(row: MessageRow): Message {
  return { id: row.id, senderId: row.sender_id, content: row.content, createdAt: row.created_at }
}

// Never trust the client for connection/sender/state (spec §20). Every
// message write re-verifies membership and that the connection is live.
async function assertMemberOfLiveConnection(connectionId: string, userId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('connections')
    .select('status, user_a_id, user_b_id')
    .eq('id', connectionId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new ConnectionError(404, 'connection not found')
  if (data.user_a_id !== userId && data.user_b_id !== userId) {
    throw new ConnectionError(403, 'not a member of this connection')
  }
  if (data.status !== 'active' && data.status !== 'leave_pending') {
    throw new ConnectionError(409, 'connection is not active')
  }
}

export async function getHistory(connectionId: string, userId: string): Promise<Message[]> {
  await assertMemberOfLiveConnection(connectionId, userId)

  const { data, error } = await supabaseAdmin
    .from('messages')
    .select('id, sender_id, content, created_at')
    .eq('connection_id', connectionId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map(toMessage)
}

export async function saveMessage(connectionId: string, senderId: string, content: string): Promise<Message> {
  const trimmed = content.trim()
  if (trimmed.length < 1 || trimmed.length > 4000) {
    throw new ConnectionError(400, 'message must be 1-4000 characters')
  }
  await assertMemberOfLiveConnection(connectionId, senderId)

  const { data, error } = await supabaseAdmin
    .from('messages')
    .insert({ connection_id: connectionId, sender_id: senderId, content: trimmed })
    .select('id, sender_id, content, created_at')
    .single()
  if (error) throw error
  return toMessage(data)
}
