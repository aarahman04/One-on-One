import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { generateConnectionCode } from '../utils/connectionCode.js'

export interface AppUser {
  id: string
  authUserId: string
  connectionCode: string
}

const UNIQUE_VIOLATION = '23505'
const MAX_CODE_ATTEMPTS = 5

export async function getOrCreateUser(authUserId: string): Promise<AppUser> {
  const existing = await supabaseAdmin
    .from('users')
    .select('id, auth_user_id, connection_code')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (existing.error) throw existing.error
  if (existing.data) return toAppUser(existing.data)

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const connectionCode = generateConnectionCode()
    const inserted = await supabaseAdmin
      .from('users')
      .insert({ auth_user_id: authUserId, connection_code: connectionCode })
      .select('id, auth_user_id, connection_code')
      .single()

    if (!inserted.error) return toAppUser(inserted.data)
    if (inserted.error.code !== UNIQUE_VIOLATION) throw inserted.error

    // Could be a connection_code collision (retry with a new code) or a
    // concurrent request that already created this user (return it).
    const raceCheck = await supabaseAdmin
      .from('users')
      .select('id, auth_user_id, connection_code')
      .eq('auth_user_id', authUserId)
      .maybeSingle()
    if (raceCheck.data) return toAppUser(raceCheck.data)
  }

  throw new Error('failed to generate a unique connection code')
}

function toAppUser(row: { id: string; auth_user_id: string; connection_code: string }): AppUser {
  return { id: row.id, authUserId: row.auth_user_id, connectionCode: row.connection_code }
}
