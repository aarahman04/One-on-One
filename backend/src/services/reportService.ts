import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { getConnectionByMessageId, getConnectionForMember } from './connectionAccess.js'
import { otherMemberId } from '../utils/connections.js'
import { UNIQUE_VIOLATION } from '../utils/pgErrors.js'

const MAX_REASON_LEN = 1000

// Coarse reason buckets the moderation review (npm run reports:review) keys
// off. 'child_safety' is the CSAE category required by Google Play's Child
// Safety Standards policy. An unrecognised value falls back to 'other'.
export const REPORT_CATEGORIES = ['harassment', 'hate', 'sexual', 'child_safety', 'spam', 'other'] as const
export type ReportCategory = (typeof REPORT_CATEGORIES)[number]

function normalizeCategory(value: unknown): ReportCategory | null {
  if (typeof value !== 'string') return null
  return (REPORT_CATEGORIES as readonly string[]).includes(value) ? (value as ReportCategory) : 'other'
}

function normalizeNote(reason: unknown): string | null {
  const trimmed = typeof reason === 'string' ? reason.trim().slice(0, MAX_REASON_LEN) : ''
  return trimmed || null
}

// Reporting must keep working the moment a user most needs it — when they want
// to report abuse and leave. So `everMember` verifies the reporter was *ever*
// a member of the message's connection (not that it's still active), and the
// message text is snapshotted so the report survives the connection being
// terminated.
export async function reportMessage(
  messageId: string,
  reporterId: string,
  opts: { category?: unknown; reason?: unknown },
): Promise<void> {
  // `content` is the message's stored ciphertext (encryption at rest, Option C).
  // The snapshot copies it verbatim — never a decrypted plaintext copy at rest.
  // Moderation review decrypts on read. See docs/DECISIONS-encryption-at-rest.md.
  const { messageContent, messageSenderId } = await getConnectionByMessageId(messageId, reporterId, { everMember: true })

  const { error } = await supabaseAdmin.from('message_reports').insert({
    message_id: messageId,
    reporter_id: reporterId,
    reported_user_id: messageSenderId,
    category: normalizeCategory(opts.category),
    reason: normalizeNote(opts.reason),
    message_content: messageContent,
  })
  // Already reported by this user — treat as success, not an error.
  if (error && error.code !== UNIQUE_VIOLATION) throw error
}

// Person-level report ("Report this person") — no specific message, just the
// other member of the connection. message_id stays null; the partial unique
// index (migration 031) keeps it to one per (reporter, reported).
export async function reportConnectionUser(
  connectionId: string,
  reporterId: string,
  opts: { category?: unknown; reason?: unknown },
): Promise<void> {
  const connection = await getConnectionForMember(connectionId, reporterId, { everMember: true })
  const reportedUserId = otherMemberId(connection, reporterId)

  const { error } = await supabaseAdmin.from('message_reports').insert({
    message_id: null,
    reporter_id: reporterId,
    reported_user_id: reportedUserId,
    category: normalizeCategory(opts.category),
    reason: normalizeNote(opts.reason),
    message_content: null,
  })
  if (error && error.code !== UNIQUE_VIOLATION) throw error
}
