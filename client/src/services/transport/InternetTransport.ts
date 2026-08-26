import { io, type Socket } from 'socket.io-client'
import { supabase } from '../supabaseClient'
import type { IncomingMessage, Transport } from './Transport'

const API_URL = import.meta.env.VITE_API_URL

export class InternetTransport implements Transport {
  private socket: Socket | null = null

  async connect(): Promise<void> {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) throw new Error('not signed in')

    const socket = io(API_URL, {
      auth: { token: session.access_token },
      transports: ['websocket'],
    })
    this.socket = socket

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve())
      socket.once('connect_error', (err) => reject(err))
    })
  }

  disconnect(): void {
    this.socket?.disconnect()
    this.socket = null
  }

  async sendMessage(content: string): Promise<void> {
    const socket = this.socket
    if (!socket) throw new Error('not connected')

    await new Promise<void>((resolve, reject) => {
      socket.emit('message:send', { content }, (res: { ok?: boolean; error?: string }) => {
        if (res?.error) reject(new Error(res.error))
        else resolve()
      })
    })
  }

  onMessage(callback: (message: IncomingMessage) => void): () => void {
    const socket = this.socket
    if (!socket) throw new Error('not connected')
    socket.on('message:new', callback)
    return () => {
      socket.off('message:new', callback)
    }
  }
}
