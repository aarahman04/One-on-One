import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { getOrCreateUser, regenerateConnectionCode } from '../services/userService.js'

export const meRouter = Router()

meRouter.get('/me', requireAuth, async (req, res) => {
  const user = await getOrCreateUser(req.authUserId!)
  res.json({ userId: user.id, connectionCode: user.connectionCode })
})

meRouter.post('/me/connection-code/regenerate', requireAuth, async (req, res) => {
  const user = await getOrCreateUser(req.authUserId!)
  const connectionCode = await regenerateConnectionCode(user.id)
  res.json({ connectionCode })
})
