import { createServer } from 'node:http'
import express from 'express'
import cors from 'cors'
import { meRouter } from './routes/me.js'
import { connectionsRouter } from './routes/connections.js'
import { messagesRouter } from './routes/messages.js'
import { ConnectionError } from './services/connectionService.js'
import { createSocketServer } from './websocket/socketServer.js'

const app = express()
const port = process.env.PORT ?? 3000
const allowedOrigins = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(',')

app.use(cors({ origin: allowedOrigins }))
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api', meRouter)
app.use('/api', connectionsRouter)
app.use('/api', messagesRouter)

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ConnectionError) {
    res.status(err.status).json({ error: err.message })
    return
  }
  console.error(err)
  res.status(500).json({ error: 'internal server error' })
})

const httpServer = createServer(app)
createSocketServer(httpServer, allowedOrigins)

httpServer.listen(port, () => {
  console.log(`server listening on port ${port}`)
})
