import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { strictLimiter } from '../middleware/rateLimit.js'
import { getOrCreateUser } from '../services/userService.js'
import { saveSubscription, removeSubscription } from '../services/pushService.js'

export const pushRouter = Router()

pushRouter.use(requireAuth)

pushRouter.post('/push/subscribe', strictLimiter, async (req, res) => {
  const user = await getOrCreateUser(req.authUserId!)
  const { endpoint, keys } = req.body ?? {}
  if (typeof endpoint !== 'string' || typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string') {
    res.status(400).json({ error: 'invalid subscription' })
    return
  }
  await saveSubscription(user.id, endpoint, { p256dh: keys.p256dh, auth: keys.auth })
  res.status(204).end()
})

pushRouter.post('/push/unsubscribe', async (req, res) => {
  const user = await getOrCreateUser(req.authUserId!)
  const { endpoint } = req.body ?? {}
  if (typeof endpoint !== 'string') {
    res.status(400).json({ error: 'invalid endpoint' })
    return
  }
  await removeSubscription(user.id, endpoint)
  res.status(204).end()
})
