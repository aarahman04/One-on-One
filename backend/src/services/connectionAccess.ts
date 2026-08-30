// Single implementation of "is this authenticated user allowed to touch this
// connection?" (spec §20 — the backend, never the client, decides membership
// and connection state). Previously this check was hand-written five times
// across connectionService, messageService, reactionService and reportService,
// each with slightly different SELECTs and error wording.

import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { ConnectionError } from '../utils/connectionError.js'
import { isLiveStatus } from '../utils/connections.js'

export interface MemberConnection {
  id: string
  user_a_id: string
  user_b_id: string
  status: string
  created_at: string
}

export interface AccessOpts {
  // 409 unless the connection is active / leave_pending.
  requireLive?: boolean
  // Tolerate a vanished connection (report-abuse-as-you-leave). Only meaningful
  // on the message-scoped lookup; also skips the live check.
  everMember?: boolean
}

function assertAccess(conn: MemberConnection, userId: string, opts: AccessOpts): void {
  if (conn.user_a_id !== userId && conn.user_b_id !== userId) {
    throw new ConnectionError(403, 'not a member of this connection')
  }
  if (opts.requireLive && !isLiveStatus(conn.status)) {
    throw new ConnectionError(409, 'connection is not active')
  }
}

const SELECT = 'id, user_a_id, user_b_id, status, created_at'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// PostgREST .or() takes a raw string; assert the id shape before interpolating
// so a malformed id can't reach the filter grammar (defense in depth — ids are
// DB-issued UUIDs).
export function memberOrFilter(userId: string): string {
  if (!UUID_RE.test(userId)) throw new ConnectionError(400, 'invalid user id')
  return `user_a_id.eq.${userId},user_b_id.eq.${userId}`
}

// The caller's single live connection as one lightweight query — for the socket
// send path, which needs only id + members, not the full /connections/current
// poll payload. Newest wins if a stray extra row exists (see migration 016).
export async function getLiveConnectionForUser(userId: string): Promise<MemberConnection | null> {
  const { data, error } = await supabaseAdmin
    .from('connections')
    .select(SELECT)
    .in('status', ['active', 'leave_pending'])
    .or(memberOrFilter(userId))
    .order('updated_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return (data?.[0] as MemberConnection) ?? null
}

// Load a connection by id and assert the caller is a member (and, with
// requireLive, that it is still live). 404 if the connection doesn't exist.
export async function getConnectionForMember(
  connectionId: string,
  userId: string,
  opts: AccessOpts = {},
): Promise<MemberConnection> {
  const { data, error } = await supabaseAdmin
    .from('connections')
    .select(SELECT)
    .eq('id', connectionId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new ConnectionError(404, 'connection not found')
  assertAccess(data as MemberConnection, userId, opts)
  return data as MemberConnection
}

// Resolve a message to its connection and run the same membership check, plus
// return the message's stored text. 404 'message not found' if the message is
// gone; a missing connection is 404 normally, or 403 under everMember (a report
// filed as the connection is torn down must still verify the reporter, not leak
// that the connection existed).
export async function getConnectionByMessageId(
  messageId: string,
  userId: string,
  opts: AccessOpts = {},
): Promise<{ connection: MemberConnection; messageContent: string }> {
  const { data: msg, error: msgErr } = await supabaseAdmin
    .from('messages')
    .select('connection_id, content')
    .eq('id', messageId)
    .maybeSingle()
  if (msgErr) throw msgErr
  if (!msg) throw new ConnectionError(404, 'message not found')

  const { data: conn, error: connErr } = await supabaseAdmin
    .from('connections')
    .select(SELECT)
    .eq('id', msg.connection_id)
    .maybeSingle()
  if (connErr) throw connErr
  if (!conn) {
    throw opts.everMember
      ? new ConnectionError(403, 'not a member of this connection')
      : new ConnectionError(404, 'connection not found')
  }
  assertAccess(conn as MemberConnection, userId, opts)
  return { connection: conn as MemberConnection, messageContent: msg.content as string }
}
