import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { UNIQUE_VIOLATION } from '../utils/pgErrors.js'

// The blocks table (migration 030). A block is directional and permanent until
// the blocker removes it. Backend-only — the client never reads or writes it
// (spec §20); requestConnection consults isBlockedBetween on every request.

// Either direction: if A blocked B or B blocked A, they cannot reconnect.
export async function isBlockedBetween(userId: string, otherUserId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('blocks')
    .select('blocker_user_id')
    .or(
      `and(blocker_user_id.eq.${userId},blocked_user_id.eq.${otherUserId}),` +
        `and(blocker_user_id.eq.${otherUserId},blocked_user_id.eq.${userId})`,
    )
    .limit(1)
  if (error) throw error
  return (data?.length ?? 0) > 0
}

// Record a block. Idempotent — re-blocking an already-blocked user is a no-op.
export async function addBlock(blockerUserId: string, blockedUserId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('blocks')
    .insert({ blocker_user_id: blockerUserId, blocked_user_id: blockedUserId })
  if (error && error.code !== UNIQUE_VIOLATION) throw error
}

export interface BlockRow {
  blockedUserId: string
  createdAt: string
}

export async function listBlocks(blockerUserId: string): Promise<BlockRow[]> {
  const { data, error } = await supabaseAdmin
    .from('blocks')
    .select('blocked_user_id, created_at')
    .eq('blocker_user_id', blockerUserId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r) => ({ blockedUserId: r.blocked_user_id as string, createdAt: r.created_at as string }))
}

// Unblock. The caller can only ever remove their OWN outbound blocks — the
// blocker id is the authenticated user, never client-supplied.
export async function removeBlock(blockerUserId: string, blockedUserId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('blocks')
    .delete()
    .eq('blocker_user_id', blockerUserId)
    .eq('blocked_user_id', blockedUserId)
  if (error) throw error
}
