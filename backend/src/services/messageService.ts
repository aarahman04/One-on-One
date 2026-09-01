import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { ConnectionError } from './connectionService.js'
import { getConnectionForMember, type MemberConnection } from './connectionAccess.js'
import { getReactionsForMessages, type ReactionSummary } from './reactionService.js'
import { isAllowedMime, maxBytesFor, type AttachmentKind } from './attachmentService.js'

export type MessageType = 'text' | 'letter' | 'voice' | 'image' | 'file'

const MESSAGE_TYPES: MessageType[] = ['text', 'letter', 'voice', 'image', 'file']
export function isMessageType(x: unknown): x is MessageType {
  return MESSAGE_TYPES.includes(x as MessageType)
}

const LETTER_APPEARANCES = ['dawn', 'botanical']
const MEDIA_TYPES: AttachmentKind[] = ['voice', 'image', 'file']

export interface Message {
  id: string
  senderId: string
  content: string
  createdAt: string
  type: MessageType
  payload: unknown | null
  replyTo: string | null
  reactions: ReactionSummary[]
}

interface MessageRow {
  id: string
  sender_id: string
  content: string
  created_at: string
  type: MessageType | null
  payload: unknown | null
  reply_to: string | null
}

function toMessage(row: MessageRow, reactions: ReactionSummary[] = []): Message {
  return {
    id: row.id,
    senderId: row.sender_id,
    content: row.content,
    createdAt: row.created_at,
    type: row.type ?? 'text',
    payload: row.payload ?? null,
    replyTo: row.reply_to ?? null,
    reactions,
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

// Media messages carry the uploaded object's path/mime/size in `payload` plus
// a type-specific field (dimensions/duration/name). The path must live under
// this connection's own attachment prefix — never trust a client-supplied
// path into another connection's files (spec §20).
function validateMediaPayload(connectionId: string, kind: AttachmentKind, payload: unknown): Record<string, unknown> {
  const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>

  const path = String(p.path ?? '')
  if (!path.startsWith(`${connectionId}/`)) throw new ConnectionError(400, 'invalid attachment path')

  const mime = String(p.mime ?? '')
  if (!isAllowedMime(kind, mime)) throw new ConnectionError(400, 'invalid attachment type')

  const size = Number(p.size)
  if (!Number.isFinite(size) || size < 1 || size > maxBytesFor(kind)) {
    throw new ConnectionError(400, 'invalid attachment size')
  }

  if (kind === 'image') {
    const width = Number(p.width)
    const height = Number(p.height)
    if (!Number.isInteger(width) || width < 1 || width > 20000) throw new ConnectionError(400, 'invalid image width')
    if (!Number.isInteger(height) || height < 1 || height > 20000) throw new ConnectionError(400, 'invalid image height')
    return { path, mime, size, width, height }
  }

  if (kind === 'voice') {
    const duration = Number(p.duration)
    if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) {
      throw new ConnectionError(400, 'invalid voice duration')
    }
    return { path, mime, size, duration }
  }

  const name = String(p.name ?? '').trim()
  if (name.length < 1 || name.length > 255) throw new ConnectionError(400, 'invalid file name')
  return { path, mime, size, name }
}

const HISTORY_PAGE_SIZE = 50

// Paginated newest-first (then reversed for display). Without a limit, PostgREST's
// row cap silently returned the OLDEST 1000 messages once a chat grew past that,
// hiding everything recent. `before` is a created_at cursor for "load older".
export async function getHistory(
  connectionId: string,
  userId: string,
  before?: string,
): Promise<Message[]> {
  await getConnectionForMember(connectionId, userId, { requireLive: true })

  let query = supabaseAdmin
    .from('messages')
    .select('id, sender_id, content, created_at, type, payload, reply_to')
    .eq('connection_id', connectionId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_PAGE_SIZE)
  if (before) query = query.lt('created_at', before)

  const { data, error } = await query
  if (error) throw error

  const rows = (data ?? []).reverse()
  const reactionsByMessage = await getReactionsForMessages(rows.map((r) => r.id))
  return rows.map((row) => toMessage(row, reactionsByMessage.get(row.id) ?? []))
}

// A reply target must be a real message in the SAME connection — never trust
// a client-supplied id (spec §20).
async function assertReplyTargetInConnection(connectionId: string, replyTo: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('messages')
    .select('id')
    .eq('id', replyTo)
    .eq('connection_id', connectionId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new ConnectionError(400, 'reply target not found in this connection')
}

// The connection is passed in already resolved + membership/live-checked by the
// caller (socketServer's getLiveConnectionForUser), so this doesn't re-fetch it.
export async function saveMessage(
  connection: MemberConnection,
  senderId: string,
  content: string,
  type: MessageType = 'text',
  payload: unknown = null,
  replyTo: string | null = null,
): Promise<Message> {
  if (!isMessageType(type)) throw new ConnectionError(400, 'invalid message type')
  const isMedia = (MEDIA_TYPES as string[]).includes(type)

  // Media messages carry an optional caption — content can be empty. Text and
  // letters still require actual content.
  const trimmed = content.trim()
  if (isMedia) {
    if (trimmed.length > 4000) throw new ConnectionError(400, 'caption must be at most 4000 characters')
  } else if (trimmed.length < 1 || trimmed.length > 4000) {
    throw new ConnectionError(400, 'message must be 1-4000 characters')
  }

  const storedPayload = isMedia
    ? validateMediaPayload(connection.id, type as AttachmentKind, payload)
    : type === 'letter'
      ? validateLetterPayload(payload)
      : null

  if (replyTo) await assertReplyTargetInConnection(connection.id, replyTo)

  const { data, error } = await supabaseAdmin
    .from('messages')
    .insert({
      connection_id: connection.id,
      sender_id: senderId,
      content: trimmed,
      type,
      payload: storedPayload,
      reply_to: replyTo,
    })
    .select('id, sender_id, content, created_at, type, payload, reply_to')
    .single()
  if (error) throw error

  // Sending proves the sender has read everything up to now, so advance their
  // last_read_at (to the DB-issued created_at, avoiding app/DB clock skew). This
  // records reads that the separate markRead call would otherwise miss.
  const { error: readError } = await supabaseAdmin
    .from('connection_members')
    .update({ last_read_at: data.created_at })
    .eq('connection_id', connection.id)
    .eq('user_id', senderId)
  if (readError) console.error('saveMessage: failed to bump sender last_read_at', readError)

  return toMessage(data)
}
