import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { ConnectionError } from './connectionService.js'
import { UNIQUE_VIOLATION } from '../utils/pgErrors.js'

const MAX_REASON_LEN = 1000

// Reporting must keep working the moment a user most needs it — when they want
// to report abuse and leave. So this verifies the reporter was *ever* a member
// of the message's connection (not that it's still active), and snapshots the
// message text so the report survives the connection being terminated.
async function loadReportableMessage(
  messageId: string,
  reporterId: string,
): Promise<{ connectionId: string; content: string }> {
  const { data: msg, error: msgErr } = await supabaseAdmin
    .from('messages')
    .select('connection_id, content')
    .eq('id', messageId)
    .maybeSingle()
  if (msgErr) throw msgErr
  if (!msg) throw new ConnectionError(404, 'message not found')

  const { data: conn, error: connErr } = await supabaseAdmin
    .from('connections')
    .select('user_a_id, user_b_id')
    .eq('id', msg.connection_id)
    .maybeSingle()
  if (connErr) throw connErr
  if (!conn || (conn.user_a_id !== reporterId && conn.user_b_id !== reporterId)) {
    throw new ConnectionError(403, 'not a member of this connection')
  }
  return { connectionId: msg.connection_id as string, content: msg.content as string }
}

export async function reportMessage(messageId: string, reporterId: string, reason: unknown): Promise<void> {
  const { content } = await loadReportableMessage(messageId, reporterId)
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
