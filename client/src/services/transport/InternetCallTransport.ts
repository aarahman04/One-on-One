import type { Socket } from 'socket.io-client'
import type { CallKind, CallTransport, IceServer, IncomingCall } from './CallTransport'

const ACK_TIMEOUT_MS = 10000

// Rides the SAME authenticated socket as InternetTransport — obtained only
// through InternetTransport.getCallTransport(), never opened independently,
// so call signaling shares the message transport's connection/auth lifecycle.
export class InternetCallTransport implements CallTransport {
  private socket: Socket

  constructor(socket: Socket) {
    this.socket = socket
  }

  private emitWithAck<T extends { error?: string }>(event: string, payload: unknown): Promise<T> {
    const socket = this.socket
    if (!socket.connected) throw new Error('not connected')
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('call request timed out')), ACK_TIMEOUT_MS)
      socket.emit(event, payload, (res: T) => {
        clearTimeout(timer)
        if (res?.error) reject(new Error(res.error))
        else resolve(res)
      })
    })
  }

  invite(kind: CallKind): Promise<{ callId: string; iceServers: IceServer[] }> {
    return this.emitWithAck<{ error?: string; callId: string; iceServers: IceServer[] }>('call:invite', { kind })
  }

  accept(callId: string): Promise<{ iceServers: IceServer[] }> {
    return this.emitWithAck<{ error?: string; iceServers: IceServer[] }>('call:accept', { callId })
  }

  async decline(callId: string): Promise<void> {
    await this.emitWithAck('call:decline', { callId })
  }

  async end(callId: string): Promise<void> {
    await this.emitWithAck('call:end', { callId })
  }

  async sendSignal(callId: string, data: unknown): Promise<void> {
    await this.emitWithAck('call:signal', { callId, data })
  }

  onIncoming(callback: (call: IncomingCall) => void): () => void {
    this.socket.on('call:incoming', callback)
    return () => {
      this.socket.off('call:incoming', callback)
    }
  }

  onAccepted(callback: (callId: string) => void): () => void {
    const handler = (msg: { callId: string }): void => callback(msg.callId)
    this.socket.on('call:accepted', handler)
    return () => {
      this.socket.off('call:accepted', handler)
    }
  }

  onSignal(callback: (callId: string, data: unknown) => void): () => void {
    const handler = (msg: { callId: string; data: unknown }): void => callback(msg.callId, msg.data)
    this.socket.on('call:signal', handler)
    return () => {
      this.socket.off('call:signal', handler)
    }
  }

  onEnded(callback: (callId: string, reason: string) => void): () => void {
    const handler = (msg: { callId: string; reason: string }): void => callback(msg.callId, msg.reason)
    this.socket.on('call:ended', handler)
    return () => {
      this.socket.off('call:ended', handler)
    }
  }
}
