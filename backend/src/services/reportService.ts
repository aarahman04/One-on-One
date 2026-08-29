import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { assertMemberOfMessageConnection } from './reactionService.js'

const MAX_REASON_LEN = 1000

// A report re-verifies connection membership server-side via the message itself
// (never trusts the client — spec §20), then records one row. No broadcast.
export async function reportMessage(messageId: string, reporterId: string, reason: unknown): Promise<void> {
  await assertMemberOfMessageConnection(messageId, reporterId)
  const trimmed = typeof reason === 'string' ? reason.trim().slice(0, MAX_REASON_LEN) : ''
  const { error } = await supabaseAdmin.from('message_reports').insert({
    message_id: messageId,
    reporter_id: reporterId,
    reason: trimmed || null,
  })
  if (error) throw error
}
