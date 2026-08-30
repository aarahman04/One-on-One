import type { NextFunction, Request, Response } from 'express'
import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { getOrCreateUser, type AppUser } from '../services/userService.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUserId?: string
      appUser?: AppUser
    }
  }
}

// Verifying a request means a network call to GoTrue (getUser) plus a users-table
// lookup. The client polls /connections/current every ~4s, so cache the resolved
// app user per access token for a short window — but never past the token's own
// expiry, so a revoked/expired token still 401s promptly.
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

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null

  if (!token) {
    res.status(401).json({ error: 'missing bearer token' })
    return
  }

  const now = Date.now()
  const cached = cache.get(token)
  if (cached && cached.expiresAt > now) {
    req.authUserId = cached.user.authUserId
    req.appUser = cached.user
    next()
    return
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data.user) {
    cache.delete(token)
    res.status(401).json({ error: 'invalid or expired token' })
    return
  }

  let user: AppUser
  try {
    user = await getOrCreateUser(data.user.id)
  } catch (err) {
    next(err)
    return
  }

  const exp = tokenExpiryMs(token)
  const expiresAt = exp > 0 ? Math.min(now + CACHE_TTL_MS, exp - 5000) : now + CACHE_TTL_MS
  if (expiresAt > now) cache.set(token, { user, expiresAt })
  if (cache.size > 500) {
    for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k)
  }

  req.authUserId = user.authUserId
  req.appUser = user
  next()
}
