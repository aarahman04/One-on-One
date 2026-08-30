import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { generateConnectionCode } from '../utils/connectionCode.js'
import { UNIQUE_VIOLATION } from '../utils/pgErrors.js'

export interface AppUser {
  id: string
  authUserId: string
  connectionCode: string
}

const MAX_CODE_ATTEMPTS = 5

// Run `attempt` with a fresh connection code, retrying on a unique-collision.
// `attempt` returns the success value, or null to mean "collision — try again".
async function withUniqueConnectionCode<T>(attempt: (code: string) => Promise<T | null>): Promise<T> {
  for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
    const result = await attempt(generateConnectionCode())
    if (result !== null) return result
  }
  throw new Error('failed to generate a unique connection code')
}

export async function getOrCreateUser(authUserId: string): Promise<AppUser> {
  const existing = await supabaseAdmin
    .from('users')
    .select('id, auth_user_id, connection_code')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (existing.error) throw existing.error
  if (existing.data) return toAppUser(existing.data)

  return withUniqueConnectionCode(async (connectionCode) => {
    const inserted = await supabaseAdmin
      .from('users')
      .insert({ auth_user_id: authUserId, connection_code: connectionCode })
      .select('id, auth_user_id, connection_code')
      .single()

    if (!inserted.error) return toAppUser(inserted.data)
    if (inserted.error.code !== UNIQUE_VIOLATION) throw inserted.error

    // 23505: a connection_code collision (retry with a new code) or a
    // concurrent request that already created this user (return it).
    const raceCheck = await supabaseAdmin
      .from('users')
      .select('id, auth_user_id, connection_code')
      .eq('auth_user_id', authUserId)
      .maybeSingle()
    return raceCheck.data ? toAppUser(raceCheck.data) : null
  })
}

// Give the user a fresh connection code (e.g. the old one got shared too widely).
// The code is only used to receive new requests, so rotating it never affects an
// existing connection (those run off user ids).
export async function regenerateConnectionCode(userId: string): Promise<string> {
  return withUniqueConnectionCode(async (connectionCode) => {
    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ connection_code: connectionCode })
      .eq('id', userId)
      .select('connection_code')
      .single()

    if (!error) return data.connection_code
    if (error.code !== UNIQUE_VIOLATION) throw error
    return null
  })
}

function toAppUser(row: { id: string; auth_user_id: string; connection_code: string }): AppUser {
  return { id: row.id, authUserId: row.auth_user_id, connectionCode: row.connection_code }
}
