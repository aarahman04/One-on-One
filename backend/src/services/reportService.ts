import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { getConnectionByMessageId } from './connectionAccess.js'
import { UNIQUE_VIOLATION } from '../utils/pgErrors.js'

const MAX_REASON_LEN = 1000

// Reporting must keep working the moment a user most needs it — when they want
// to report abuse and leave. So `everMember` verifies the reporter was *ever*
// a member of the message's connection (not that it's still active), and the
// message text is snapshotted so the report survives the connection being
// terminated.
export async function reportMessage(messageId: string, reporterId: string, reason: unknown): Promise<void> {
  const { messageContent: content } = await getConnectionByMessageId(messageId, reporterId, { everMember: true })
  const trimmed = typeof reason === 'string' ? reason.trim().slice(0, MAX_REASON_LEN) : ''

  const { error } = await supabaseAdmin.from('message_reports').insert({
    message_id: messageId,
    reporter_id: reporterId,
    reason: trimmed || null,
    message_content: content,
  })
  // Already reported by this user — treat as success, not an error.
  if (error && error.code !== UNIQUE_VIOLATION) throw error
}
