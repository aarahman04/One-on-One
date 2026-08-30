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
