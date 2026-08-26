import type { NextFunction, Request, Response } from 'express'
import { supabaseAdmin } from '../database/supabaseAdmin.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUserId?: string
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null

  if (!token) {
    res.status(401).json({ error: 'missing bearer token' })
    return
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data.user) {
    res.status(401).json({ error: 'invalid or expired token' })
    return
  }

  req.authUserId = data.user.id
  next()
}
