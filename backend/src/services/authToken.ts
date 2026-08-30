import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { ConnectionError } from '../utils/connectionError.js'
import { getOrCreateUser, type AppUser } from './userService.js'

// Verifying a token is a GoTrue round-trip plus a users-table lookup. Both the
// HTTP middleware (client polls every ~4s) and the socket handshake (every
// reconnect) hit this, so cache the resolved app user per token for a short
// window — never past the token's own expiry, so a revoked/expired token still
// fails promptly.
const CACHE_TTL_MS = 15_000
const cache = new Map<string, { user: AppUser; expiresAt: number }>()

function tokenExpiryMs(token: string): number {
  try {
    const payload = token.split('.')[1]
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as { exp?: number }
    return typeof claims.exp === 'number' ? claims.exp * 1000 : 0
  } catch {
    return 0
  }
}

// Throws ConnectionError(401) on an invalid/expired token. A failure resolving
// the app user (getOrCreateUser) propagates as-is (→ 500).
export async function resolveUserFromToken(token: string): Promise<AppUser> {
  const now = Date.now()
  const cached = cache.get(token)
  if (cached && cached.expiresAt > now) return cached.user

  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data.user) {
    cache.delete(token)
    throw new ConnectionError(401, 'invalid or expired token')
  }

  const user = await getOrCreateUser(data.user.id)

  const exp = tokenExpiryMs(token)
  const expiresAt = exp > 0 ? Math.min(now + CACHE_TTL_MS, exp - 5000) : now + CACHE_TTL_MS
  if (expiresAt > now) cache.set(token, { user, expiresAt })
  if (cache.size > 500) {
    for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k)
  }
  return user
}
