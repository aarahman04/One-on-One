import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { ConnectionError } from './connectionService.js'
import { getConnectionByMessageId } from './connectionAccess.js'

const ALLOWED_EMOJI = ['❤️', '👍', '😂', '😮', '😢', '🙏']

export interface ReactionSummary {
  emoji: string
  userIds: string[]
}

function validateEmoji(emoji: unknown): string {
  if (typeof emoji !== 'string' || !ALLOWED_EMOJI.includes(emoji)) {
    throw new ConnectionError(400, 'invalid emoji')
  }
  return emoji
}

// Reactions don't carry their own connection id — resolve it via the message
// and re-verify membership + live state (spec §20). Returns the connection id
// for the caller's socket broadcast.
export async function addReaction(messageId: string, userId: string, emoji: unknown): Promise<string> {
  const validEmoji = validateEmoji(emoji)
  const { connection } = await getConnectionByMessageId(messageId, userId, { requireLive: true })
  const { error } = await supabaseAdmin
    .from('reactions')
    .upsert({ message_id: messageId, user_id: userId, emoji: validEmoji }, { onConflict: 'message_id,user_id,emoji' })
  if (error) throw error
  return connection.id
}

export async function removeReaction(messageId: string, userId: string, emoji: unknown): Promise<string> {
  const validEmoji = validateEmoji(emoji)
  const { connection } = await getConnectionByMessageId(messageId, userId, { requireLive: true })
  const { error } = await supabaseAdmin
    .from('reactions')
    .delete()
    .eq('message_id', messageId)
    .eq('user_id', userId)
    .eq('emoji', validEmoji)
  if (error) throw error
  return connection.id
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
