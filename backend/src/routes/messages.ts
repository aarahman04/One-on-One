import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { strictLimiter } from '../middleware/rateLimit.js'
import { getHistory } from '../services/messageService.js'
import { reportMessage } from '../services/reportService.js'

export const messagesRouter = Router()

messagesRouter.use(requireAuth)

messagesRouter.get('/connections/:id/messages', async (req, res) => {
  const user = req.appUser!
  const before = typeof req.query.before === 'string' ? req.query.before : undefined
  const messages = await getHistory(req.params.id, user.id, before)
  res.json({ messages })
})

messagesRouter.post('/messages/:id/report', strictLimiter, async (req, res) => {
  const user = req.appUser!
  await reportMessage(String(req.params.id), user.id, req.body?.reason)
  res.status(204).end()
})
