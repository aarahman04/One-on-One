import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { ConnectionError } from './connectionService.js'
import { getConnectionForMember } from './connectionAccess.js'
import { getReactionsForMessages, type ReactionSummary } from './reactionService.js'
import { isAllowedMime, maxBytesFor, type AttachmentKind } from './attachmentService.js'
import { encrypt, decrypt, isEncrypted } from './crypto.js'

export type MessageType = 'text' | 'letter' | 'voice' | 'image' | 'file' | 'ask' | 'countdown' | 'checkin' | 'thisorthat' | 'alarm' | 'call'

const MESSAGE_TYPES: MessageType[] = ['text', 'letter', 'voice', 'image', 'file', 'ask', 'countdown', 'checkin', 'thisorthat', 'alarm', 'call']
export function isMessageType(x: unknown): x is MessageType {
  return MESSAGE_TYPES.includes(x as MessageType)
}

const LETTER_APPEARANCES = ['dawn', 'botanical']
const MEDIA_TYPES: AttachmentKind[] = ['voice', 'image', 'file']
const CHECKIN_MOODS = ['great', 'good', 'okay', 'down', 'struggling']

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

// content and payload are encrypted at rest (Option C — see
// docs/DECISIONS-encryption-at-rest.md). Reads decrypt before serving. Rows
// written before the Chunk 4 backfill are still plaintext, so anything that
// isn't a ciphertext envelope passes through unchanged during the rollout.
function decryptContent(value: string): string {
  return isEncrypted(value) ? decrypt(value) : value
}

// Encrypted payloads are stored as the jsonb envelope `{ enc: "v1:…" }`; legacy
// plaintext payloads are the raw object (or null) and pass through untouched.
function decryptPayload(payload: unknown): unknown {
  if (
    payload !== null &&
    typeof payload === 'object' &&
    typeof (payload as { enc?: unknown }).enc === 'string'
  ) {
    return JSON.parse(decrypt((payload as { enc: string }).enc))
  }
  return payload
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

// Countdown, check-in, and ask carry no separate "body" concept the way letter
// does, so `content` holds each one's own primary display string (label /
// note / question) while `payload` holds the full structured data. This
// batch (3) only adds structural validation for the three new types; ask's
// reply-linked reveal semantics land with the /ask feature itself (batch 6).

function validateCountdownPayload(payload: unknown): { label: string; targetIso: string } {
  const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
  const label = String(p.label ?? '').trim()
  if (label.length < 1 || label.length > 100) throw new ConnectionError(400, 'label must be 1-100 characters')
  const target = new Date(String(p.targetIso ?? ''))
  if (Number.isNaN(target.getTime())) throw new ConnectionError(400, 'invalid countdown date')
  return { label, targetIso: target.toISOString() }
}

function validateCheckinPayload(payload: unknown): { mood: string; note: string } {
  const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
  const mood = String(p.mood ?? '')
  if (!CHECKIN_MOODS.includes(mood)) throw new ConnectionError(400, 'invalid check-in mood')
  const note = String(p.note ?? '').trim()
  if (note.length < 1 || note.length > 300) throw new ConnectionError(400, 'note must be 1-300 characters')
  return { mood, note }
}

function validateAskPayload(payload: unknown): { question: string; answerA: string; answerB?: string } {
  const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
  const question = String(p.question ?? '').trim()
  if (question.length < 1 || question.length > 300) throw new ConnectionError(400, 'question must be 1-300 characters')
  const answerA = String(p.answerA ?? '').trim()
  if (answerA.length < 1 || answerA.length > 500) throw new ConnectionError(400, 'answer must be 1-500 characters')
  if (p.answerB === undefined || p.answerB === null) return { question, answerA }
  const answerB = String(p.answerB).trim()
  if (answerB.length < 1 || answerB.length > 500) throw new ConnectionError(400, 'answer must be 1-500 characters')
  return { question, answerA, answerB }
}

const THISORTHAT_PICKS = ['a', 'b']

function validateThisOrThatPayload(
  payload: unknown,
): { optionA: string; optionB: string; pickSender: 'a' | 'b'; pickRecipient?: 'a' | 'b' } {
  const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
  const optionA = String(p.optionA ?? '').trim()
  if (optionA.length < 1 || optionA.length > 100) throw new ConnectionError(400, 'option must be 1-100 characters')
  const optionB = String(p.optionB ?? '').trim()
  if (optionB.length < 1 || optionB.length > 100) throw new ConnectionError(400, 'option must be 1-100 characters')
  const pickSender = String(p.pickSender ?? '')
  if (!THISORTHAT_PICKS.includes(pickSender)) throw new ConnectionError(400, 'invalid pick')
  if (p.pickRecipient === undefined || p.pickRecipient === null) {
    return { optionA, optionB, pickSender: pickSender as 'a' | 'b' }
  }
  const pickRecipient = String(p.pickRecipient)
  if (!THISORTHAT_PICKS.includes(pickRecipient)) throw new ConnectionError(400, 'invalid pick')
  return { optionA, optionB, pickSender: pickSender as 'a' | 'b', pickRecipient: pickRecipient as 'a' | 'b' }
}

// An alarm raise carries no payload; an acknowledgement is a follow-up alarm
// message reply-linked (via replyTo) to the original, with payload {ack:<id>}
// naming the raise it clears. No message-mutation path exists (see thisorthat),
// so ack is a new message, not an edit of the original.
function validateAlarmPayload(payload: unknown): { ack?: string } {
  const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
  if (p.ack === undefined || p.ack === null) return {}
  const ack = String(p.ack).trim()
  if (ack.length < 1) throw new ConnectionError(400, 'invalid alarm acknowledgement')
  return { ack }
}

const CALL_KINDS = ['audio', 'video']
const CALL_OUTCOMES = ['missed', 'declined', 'cancelled', 'completed', 'failed']

// Call log rows are server-authored only (callService.ts, at call resolution)
// — never accepted from message:send (see socketServer's explicit reject) —
// but still validated here like every other payload rather than trusted blind.
function validateCallPayload(payload: unknown): { kind: string; outcome: string; durationSec: number } {
  const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
  const kind = String(p.kind ?? '')
  const outcome = String(p.outcome ?? '')
  const durationSec = Number(p.durationSec ?? 0)
  if (!CALL_KINDS.includes(kind)) throw new ConnectionError(400, 'invalid call kind')
  if (!CALL_OUTCOMES.includes(outcome)) throw new ConnectionError(400, 'invalid call outcome')
  if (!Number.isFinite(durationSec) || durationSec < 0) throw new ConnectionError(400, 'invalid call duration')
  return { kind, outcome, durationSec: Math.round(durationSec) }
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
  return rows.map((row) =>
    toMessage(
      { ...row, content: decryptContent(row.content), payload: decryptPayload(row.payload) },
      reactionsByMessage.get(row.id) ?? [],
    ),
  )
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
// caller (socketServer's getLiveConnectionForUser / callService), so this
// doesn't re-fetch it — only `.id` is ever used below.
export async function saveMessage(
  connection: { id: string },
  senderId: string,
  content: string,
  type: MessageType = 'text',
  payload: unknown = null,
  replyTo: string | null = null,
): Promise<Message> {
  if (!isMessageType(type)) throw new ConnectionError(400, 'invalid message type')
  const isMedia = (MEDIA_TYPES as string[]).includes(type)

  // Media messages carry an optional caption, and an alarm/call carry no
  // meaningful content of their own — both can be empty. Every other type
  // (text, letter, ask, countdown, checkin, thisorthat) still requires
  // actual content — each one's primary display string
  // (body / question / label / note / "optionA vs optionB").
  const trimmed = content.trim()
  if (isMedia || type === 'alarm' || type === 'call') {
    if (trimmed.length > 4000) throw new ConnectionError(400, 'caption must be at most 4000 characters')
  } else if (trimmed.length < 1 || trimmed.length > 4000) {
    throw new ConnectionError(400, 'message must be 1-4000 characters')
  }

  const storedPayload = isMedia
    ? validateMediaPayload(connection.id, type as AttachmentKind, payload)
    : type === 'letter'
      ? validateLetterPayload(payload)
      : type === 'countdown'
        ? validateCountdownPayload(payload)
        : type === 'checkin'
          ? validateCheckinPayload(payload)
          : type === 'ask'
            ? validateAskPayload(payload)
            : type === 'thisorthat'
              ? validateThisOrThatPayload(payload)
              : type === 'alarm'
                ? validateAlarmPayload(payload)
                : type === 'call'
                  ? validateCallPayload(payload)
                  : null

  if (replyTo) await assertReplyTargetInConnection(connection.id, replyTo)

  const { data, error } = await supabaseAdmin
    .from('messages')
    .insert({
      connection_id: connection.id,
      sender_id: senderId,
      content: encrypt(trimmed),
      type,
      payload: storedPayload === null ? null : { enc: encrypt(JSON.stringify(storedPayload)) },
      reply_to: replyTo,
    })
    .select('id, sender_id, created_at')
    .single()
  if (error) throw error

  // Sending proves the sender has read everything up to now, so the caller
  // (socketServer) advances their last_read_at after broadcasting — moved out
  // of this function so that DB write doesn't sit on the hot path gating
  // delivery to the recipient (see bumpSenderLastRead).

  // Return the plaintext we already hold rather than decrypting the row back.
  // This Message is what the socket broadcasts and the push preview reads, so it
  // must be plaintext — only content/payload at rest are encrypted.
  return toMessage({
    id: data.id,
    sender_id: data.sender_id,
    content: trimmed,
    created_at: data.created_at,
    type,
    payload: storedPayload,
    reply_to: replyTo,
  })
}

// Sending proves the sender has read everything up to now, so advance their
// last_read_at (to the DB-issued created_at, avoiding app/DB clock skew) —
// this records reads that the separate markRead call would otherwise miss.
// Split out of saveMessage and called fire-and-forget AFTER the broadcast
// (like syncDelivery) so this write never gates delivery to the recipient.
export async function bumpSenderLastRead(connectionId: string, senderId: string, createdAt: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('connection_members')
    .update({ last_read_at: createdAt })
    .eq('connection_id', connectionId)
    .eq('user_id', senderId)
  if (error) console.error('bumpSenderLastRead: failed to bump sender last_read_at', error)
}
