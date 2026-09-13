import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { strictLimiter } from '../middleware/rateLimit.js'
import { saveSubscription, removeSubscription, saveToken, removeToken } from '../services/pushService.js'

export const pushRouter = Router()

pushRouter.use(requireAuth)

pushRouter.post('/push/subscribe', strictLimiter, async (req, res) => {
  const user = req.appUser!
  const { endpoint, keys } = req.body ?? {}
  if (typeof endpoint !== 'string' || typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string') {
    res.status(400).json({ error: 'invalid subscription' })
    return
  }
  await saveSubscription(user.id, endpoint, { p256dh: keys.p256dh, auth: keys.auth })
  res.status(204).end()
})

pushRouter.post('/push/unsubscribe', async (req, res) => {
  const { endpoint } = req.body ?? {}
  if (typeof endpoint !== 'string') {
    res.status(400).json({ error: 'invalid endpoint' })
    return
  }
  await removeSubscription(endpoint)
  res.status(204).end()
})

// FCM registration token (native / Android build). An opaque token, not an
// https URL — deliberately NOT run through assertValidPushEndpoint.
pushRouter.post('/push/token', strictLimiter, async (req, res) => {
  const user = req.appUser!
  const { token } = req.body ?? {}
  if (typeof token !== 'string' || !token) {
    res.status(400).json({ error: 'invalid token' })
    return
  }
  await saveToken(user.id, token)
  res.status(204).end()
})

pushRouter.post('/push/token/unregister', async (req, res) => {
  const user = req.appUser!
  const { token } = req.body ?? {}
  if (typeof token !== 'string' || !token) {
    res.status(400).json({ error: 'invalid token' })
    return
  }
  await removeToken(user.id, token)
  res.status(204).end()
})
