import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { strictLimiter } from '../middleware/rateLimit.js'
import { emitConnectionEnded } from '../websocket/socketServer.js'
import { ConnectionError } from '../utils/connectionError.js'
import { getConnectionForMember } from '../services/connectionAccess.js'
import {
  acceptConnection,
  acknowledgeEnd,
  blockAndTerminate,
  cancelRequest,
  declineConnection,
  getCurrentConnection,
  leaveConnection,
  markDelivered,
  markRead,
  requestConnection,
  setMessageStyle,
  setNickname,
  setWallpaper,
} from '../services/connectionService.js'
import { reportConnectionUser } from '../services/reportService.js'
import { emitAppearanceNotice } from '../services/messageService.js'

export const connectionsRouter = Router()

connectionsRouter.use(requireAuth)

connectionsRouter.get('/connections/current', async (req, res) => {
  const user = req.appUser!
  const current = await getCurrentConnection(user.id)
  res.json({ connection: current })
})

connectionsRouter.post('/connections/request', strictLimiter, async (req, res) => {
  const user = req.appUser!
  const code = String(req.body?.connectionCode ?? '')
    .trim()
    .toUpperCase()
  if (!code) {
    res.status(400).json({ error: 'connectionCode is required' })
    return
  }
  const connection = await requestConnection(user.id, code)
  res.status(201).json({ connection })
})

connectionsRouter.post('/connections/:id/cancel', async (req, res) => {
  const user = req.appUser!
  const connection = await cancelRequest(req.params.id, user.id)
  res.json({ connection })
})

connectionsRouter.post('/connections/:id/accept', async (req, res) => {
  const user = req.appUser!
  const connection = await acceptConnection(req.params.id, user.id)
  res.json({ connection })
})

connectionsRouter.post('/connections/:id/decline', async (req, res) => {
  const user = req.appUser!
  const connection = await declineConnection(req.params.id, user.id)
  res.json({ connection })
})

connectionsRouter.patch('/connections/:id/nickname', async (req, res) => {
  const user = req.appUser!
  const nickname = String(req.body?.nickname ?? '')
  await setNickname(req.params.id, user.id, nickname)
  res.status(204).end()
})

// Instant leave. Android 2.0.5 still calls this as "step 1 of 5" and now
// gets terminated:true straight away, which it already handles.
connectionsRouter.post('/connections/:id/leave', async (req, res) => {
  const user = req.appUser!
  const result = await leaveConnection(req.params.id, user.id)
  emitConnectionEnded(req.params.id)
  res.json({ leave: result })
})

// The countdown is gone; old clients get a clear, stable code.
const leaveStepsRemoved = (): never => {
  throw new ConnectionError(410, 'the leave countdown was removed; leaving is now instant', 'leave_steps_removed')
}
connectionsRouter.post('/connections/:id/leave/cancel', leaveStepsRemoved)
connectionsRouter.post('/connections/:id/leave/confirm-end', leaveStepsRemoved)

// Partner only: done with the read-only history, purge it now.
connectionsRouter.post('/connections/:id/acknowledge-end', async (req, res) => {
  await acknowledgeEnd(req.params.id, req.appUser!.id)
  res.status(204).end()
})

connectionsRouter.patch('/connections/:id/wallpaper', async (req, res) => {
  const user = req.appUser!
  const wallpaper = String(req.body?.wallpaper ?? '')
  const changed = await setWallpaper(req.params.id, user.id, wallpaper)
  if (changed) emitAppearanceNotice(req.params.id, user.id, 'wallpaper', wallpaper)
  res.status(204).end()
})

connectionsRouter.patch('/connections/:id/style', async (req, res) => {
  const user = req.appUser!
  const style = String(req.body?.style ?? '')
  const changed = await setMessageStyle(req.params.id, user.id, style)
  if (changed) emitAppearanceNotice(req.params.id, user.id, 'style', style)
  res.status(204).end()
})

connectionsRouter.post('/connections/:id/block', async (req, res) => {
  const user = req.appUser!
  await blockAndTerminate(req.params.id, user.id)
  emitConnectionEnded(req.params.id)
  res.status(204).end()
})

connectionsRouter.post('/connections/:id/report', strictLimiter, async (req, res) => {
  const user = req.appUser!
  await reportConnectionUser(String(req.params.id), user.id, {
    category: req.body?.category,
    reason: req.body?.reason,
  })
  res.status(204).end()
})

connectionsRouter.post('/connections/:id/read', async (req, res) => {
  const user = req.appUser!
  await markRead(req.params.id, user.id)
  res.status(204).end()
})

// Called by the native app when an FCM message arrives, so a notified but
// offline device flips the sender's tick to delivered.
connectionsRouter.post('/connections/:id/delivered', async (req, res) => {
  const user = req.appUser!
  await getConnectionForMember(req.params.id, user.id, { requireLive: true })
  await markDelivered(req.params.id, user.id)
  res.status(204).end()
})
