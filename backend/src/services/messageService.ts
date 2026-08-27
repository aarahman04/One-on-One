import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { ConnectionError } from './connectionService.js'

export type MessageType = 'text' | 'letter'

const LETTER_APPEARANCES = ['dawn', 'botanical']

export interface Message {
  id: string
  senderId: string
  content: string
  createdAt: string
  type: MessageType
  payload: unknown | null
}

interface MessageRow {
  id: string
  sender_id: string
  content: string
  created_at: string
  type: MessageType | null
  payload: unknown | null
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    senderId: row.sender_id,
    content: row.content,
    createdAt: row.created_at,
    type: row.type ?? 'text',
    payload: row.payload ?? null,
  }
}

// Letters carry structured metadata in `payload`; the letter body stays in
// `content` (so length/search/export keep working). Validate like nicknames.
function validateLetterPayload(payload: unknown): { appearance: string; from: string; to: string } {
  const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
  const appearance = String(p.appearance ?? '')
  const from = String(p.from ?? '').trim()
  const to = String(p.to ?? '').trim()
  if (!LETTER_APPEARANCES.includes(appearance)) throw new ConnectionError(400, 'invalid letter appearance')
  if (from.length < 1 || from.length > 40) throw new ConnectionError(400, 'from must be 1-40 characters')
  if (to.length < 1 || to.length > 40) throw new ConnectionError(400, 'to must be 1-40 characters')
  return { appearance, from, to }
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
    .select('id, sender_id, content, created_at, type, payload')
    .eq('connection_id', connectionId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map(toMessage)
}

export async function saveMessage(
  connectionId: string,
  senderId: string,
  content: string,
  type: MessageType = 'text',
  payload: unknown = null,
): Promise<Message> {
  const trimmed = content.trim()
  if (trimmed.length < 1 || trimmed.length > 4000) {
    throw new ConnectionError(400, 'message must be 1-4000 characters')
  }
  if (type !== 'text' && type !== 'letter') throw new ConnectionError(400, 'invalid message type')
  const storedPayload = type === 'letter' ? validateLetterPayload(payload) : null

  await assertMemberOfLiveConnection(connectionId, senderId)

  const { data, error } = await supabaseAdmin
    .from('messages')
    .insert({ connection_id: connectionId, sender_id: senderId, content: trimmed, type, payload: storedPayload })
    .select('id, sender_id, content, created_at, type, payload')
    .single()
  if (error) throw error

  // Sending proves the sender has read everything up to now, so advance their
  // last_read_at (to the DB-issued created_at, avoiding app/DB clock skew). This
  // records reads that the separate markRead call would otherwise miss.
  await supabaseAdmin
    .from('connection_members')
    .update({ last_read_at: data.created_at })
    .eq('connection_id', connectionId)
    .eq('user_id', senderId)

  return toMessage(data)
}
