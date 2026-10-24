import type { Socket } from 'socket.io'

/** Server clock only: OPEN→namespace CONNECT, then the existing Engine.IO PING→PONG. */
export function trackPongRtt(connection: Pick<Socket['conn'], 'on'>, clock: () => number = () => performance.now()): () => number | undefined {
  let sent = clock(), waiting = true, handshake = true
  const recent: number[] = []
  connection.on('packetCreate', (packet: { type: string }) => {
    if (packet.type === 'ping') { sent = clock(); waiting = true }
  })
  connection.on('packet', (packet: { type: string; data?: unknown }) => {
    const connect = handshake && packet.type === 'message' && typeof packet.data === 'string' && packet.data.startsWith('0')
    if (!waiting || packet.type !== 'pong' && !connect) return
    recent.push(Math.max(0, clock() - sent)); if (recent.length > 8) recent.shift()
    waiting = false; handshake = false
  })
  return () => recent.length ? Math.max(...recent) : undefined
}
