// Pure connection predicates — no DB access, so both the HTTP and socket paths
// can use them without pulling in a service.

// A connection you can still send messages / reactions / leave-steps to.
export function isLiveStatus(status: string): boolean {
  return status === 'active' || status === 'leave_pending'
}

// The other member of a 1:1 connection, given one member's id.
export function otherMemberId(
  conn: { user_a_id: string; user_b_id: string },
  userId: string,
): string {
  return conn.user_a_id === userId ? conn.user_b_id : conn.user_a_id
}

// The Socket.IO room for a connection's two members. Shared by socketServer
// (message/reaction broadcast) and callService (call signaling broadcast).
export function room(connectionId: string): string {
  return `conn:${connectionId}`
}

// Partner keeps read-only history this long after the other member leaves.
export const ENDED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

// An ended connection the caller may still READ: they did not leave it and
// the 7-day window is open. The leaver loses access at once.
export function isEndedReadable(
  conn: { status: string; ended_by?: string | null; ended_at?: string | null },
  userId: string,
  now = Date.now(),
): boolean {
  return (
    conn.status === 'ended' &&
    !!conn.ended_by &&
    conn.ended_by !== userId &&
    !!conn.ended_at &&
    new Date(conn.ended_at).getTime() + ENDED_RETENTION_MS > now
  )
}
