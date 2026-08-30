import type { NextFunction, Request, Response } from 'express'
import { ConnectionError } from '../utils/connectionError.js'
import { resolveUserFromToken } from '../services/authToken.js'
import type { AppUser } from '../services/userService.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      appUser?: AppUser
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

  try {
    req.appUser = await resolveUserFromToken(token)
    next()
  } catch (err) {
    if (err instanceof ConnectionError) {
      res.status(err.status).json({ error: err.message })
      return
    }
    next(err)
  }
}
