import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { generateConnectionCode } from '../utils/connectionCode.js'
import { UNIQUE_VIOLATION } from '../utils/pgErrors.js'
import { memberOrFilter } from './connectionAccess.js'
import { deleteConnectionAttachments } from './attachmentService.js'
import { deleteAvatarFiles } from './avatarService.js'

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

export interface Gates {
  ageVerifiedAt: string | null
  termsAcceptedAt: string | null
}

// Read fresh (not from the 15s auth cache) so a just-set gate shows at once.
export async function getGates(userId: string): Promise<Gates> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('age_verified_at, terms_accepted_at')
    .eq('id', userId)
    .single()
  if (error) throw error
  return { ageVerifiedAt: data.age_verified_at ?? null, termsAcceptedAt: data.terms_accepted_at ?? null }
}

// Stamp each requested gate only while it is still null: idempotent, and a
// repeat never moves or clears the original time.
export async function setGates(userId: string, set: { ageVerified: boolean; termsAccepted: boolean }): Promise<Gates> {
  const now = new Date().toISOString()
  const columns = [
    ...(set.ageVerified ? ['age_verified_at'] : []),
    ...(set.termsAccepted ? ['terms_accepted_at'] : []),
  ]
  for (const column of columns) {
    const { error } = await supabaseAdmin.from('users').update({ [column]: now }).eq('id', userId).is(column, null)
    if (error) throw error
  }
  return getGates(userId)
}

// Account deletion (Google Play "delete account" policy — in-app + web).
// Deleting the Supabase auth user cascades: auth.users → users (migration 001)
// → connections / messages / connection_members / reactions / push_subscriptions
// / blocks (all reference users(id) on delete cascade). message_reports about
// this user survive with reported_user_id nulled (migration 031) — deliberate
// moderation evidence. Storage isn't covered by any FK cascade, so clean the
// attachments of every connection the cascade will delete (live, plus any
// ended one still inside its 7-day window) first, best-effort.
export async function deleteAccount(user: AppUser): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin
      .from('connections')
      .select('id')
      .in('status', ['active', 'leave_pending', 'ended'])
      .or(memberOrFilter(user.id))
    if (error) throw error
    for (const row of data ?? []) await deleteConnectionAttachments(row.id)
  } catch (err) {
    console.error('deleteAccount: attachment cleanup failed (continuing)', err)
  }
  try {
    await deleteAvatarFiles(user.id)
  } catch (err) {
    console.error('deleteAccount: avatar cleanup failed (continuing)', err)
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(user.authUserId)
  if (error) throw error
}

function toAppUser(row: { id: string; auth_user_id: string; connection_code: string }): AppUser {
  return { id: row.id, authUserId: row.auth_user_id, connectionCode: row.connection_code }
}
