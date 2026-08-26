import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { getOrCreateUser } from '../services/userService.js'

export const meRouter = Router()

meRouter.get('/me', requireAuth, async (req, res) => {
  const user = await getOrCreateUser(req.authUserId!)
  res.json({ connectionCode: user.connectionCode })
})
