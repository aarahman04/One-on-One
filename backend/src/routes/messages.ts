import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { getOrCreateUser } from '../services/userService.js'
import { getHistory } from '../services/messageService.js'

export const messagesRouter = Router()

messagesRouter.use(requireAuth)

messagesRouter.get('/connections/:id/messages', async (req, res) => {
  const user = await getOrCreateUser(req.authUserId!)
  const messages = await getHistory(req.params.id, user.id)
  res.json({ messages })
})
