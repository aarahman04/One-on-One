import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { ConnectionError } from './connectionService.js'

export const ALLOWED_EMOJI = ['❤️', '👍', '😂', '😮', '😢', '🙏']

export interface ReactionSummary {
  emoji: string
  userIds: string[]
}

// Reactions don't carry their own connection id, so resolve it via the
// message and re-verify membership the same way messages do — never trust
// the client for authorization (spec §20).
async function assertMemberOfMessageConnection(messageId: string, userId: string): Promise<string> {
  const { data: msg, error: msgErr } = await supabaseAdmin
    .from('messages')
    .select('connection_id')
    .eq('id', messageId)
    .maybeSingle()
  if (msgErr) throw msgErr
  if (!msg) throw new ConnectionError(404, 'message not found')

  const { data: conn, error: connErr } = await supabaseAdmin
    .from('connections')
    .select('status, user_a_id, user_b_id')
    .eq('id', msg.connection_id)
    .maybeSingle()
  if (connErr) throw connErr
  if (!conn) throw new ConnectionError(404, 'connection not found')
  if (conn.user_a_id !== userId && conn.user_b_id !== userId) {
    throw new ConnectionError(403, 'not a member of this connection')
  }
  if (conn.status !== 'active' && conn.status !== 'leave_pending') {
    throw new ConnectionError(409, 'connection is not active')
  }
  return msg.connection_id as string
}

function validateEmoji(emoji: unknown): string {
  if (typeof emoji !== 'string' || !ALLOWED_EMOJI.includes(emoji)) {
    throw new ConnectionError(400, 'invalid emoji')
  }
  return emoji
}

export async function addReaction(messageId: string, userId: string, emoji: unknown): Promise<string> {
  const validEmoji = validateEmoji(emoji)
  const connectionId = await assertMemberOfMessageConnection(messageId, userId)
  const { error } = await supabaseAdmin
    .from('reactions')
    .upsert({ message_id: messageId, user_id: userId, emoji: validEmoji }, { onConflict: 'message_id,user_id,emoji' })
  if (error) throw error
  return connectionId
}

export async function removeReaction(messageId: string, userId: string, emoji: unknown): Promise<string> {
  const validEmoji = validateEmoji(emoji)
  const connectionId = await assertMemberOfMessageConnection(messageId, userId)
  const { error } = await supabaseAdmin
    .from('reactions')
    .delete()
    .eq('message_id', messageId)
    .eq('user_id', userId)
    .eq('emoji', validEmoji)
  if (error) throw error
  return connectionId
}

export async function getReactionsForMessages(messageIds: string[]): Promise<Map<string, ReactionSummary[]>> {
  const result = new Map<string, ReactionSummary[]>()
  if (!messageIds.length) return result

  const { data, error } = await supabaseAdmin.from('reactions').select('message_id, user_id, emoji').in('message_id', messageIds)
  if (error) throw error

  const byMessage = new Map<string, Map<string, string[]>>()
  for (const row of data ?? []) {
    let byEmoji = byMessage.get(row.message_id)
    if (!byEmoji) {
      byEmoji = new Map()
      byMessage.set(row.message_id, byEmoji)
    }
    const users = byEmoji.get(row.emoji) ?? []
    users.push(row.user_id)
    byEmoji.set(row.emoji, users)
  }

  for (const [messageId, byEmoji] of byMessage) {
    result.set(
      messageId,
      [...byEmoji.entries()].map(([emoji, userIds]) => ({ emoji, userIds })),
    )
  }
  return result
}
