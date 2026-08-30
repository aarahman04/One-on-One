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
