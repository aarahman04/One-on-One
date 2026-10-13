import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { previewLimiter, strictLimiter } from '../middleware/rateLimit.js'
import { getLinkPreview } from '../services/linkPreviewService.js'
import { getHistory } from '../services/messageService.js'
import { reportMessage } from '../services/reportService.js'

export const messagesRouter = Router()

messagesRouter.use(requireAuth)

messagesRouter.get('/connections/:id/messages', async (req, res) => {
  const user = req.appUser!
  const before = typeof req.query.before === 'string' ? req.query.before : undefined
  const after = typeof req.query.after === 'string' ? req.query.after : undefined
  const messages = await getHistory(req.params.id, user.id, before, after)
  res.json({ messages })
})

messagesRouter.post('/messages/:id/report', strictLimiter, async (req, res) => {
  const user = req.appUser!
  await reportMessage(String(req.params.id), user.id, {
    category: req.body?.category,
    reason: req.body?.reason,
  })
  res.status(204).end()
})

// Server-side unfurl for a link in a message: {preview: LinkPreview | null}.
// null (not an error) when the page can't be fetched or has nothing to show.
messagesRouter.get('/link-preview', previewLimiter, async (req, res) => {
  const preview = await getLinkPreview(req.query.url)
  res.set('Cache-Control', 'private, max-age=3600')
  res.json({ preview })
})
