// Call signaling transport abstraction — same pattern as Transport.ts for
// messages (spec §22). V1 ships only InternetCallTransport, riding the same
// authenticated Socket.IO connection as the message transport; a future
// BluetoothTransport would add a matching call transport without touching
// call UI or session code.

export type CallKind = 'audio' | 'video'

export interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

export interface IncomingCall {
  callId: string
  kind: CallKind
  fromUserId: string
}

export interface CallTransport {
  invite(kind: CallKind): Promise<{ callId: string; iceServers: IceServer[] }>
  accept(callId: string): Promise<{ iceServers: IceServer[] }>
  decline(callId: string): Promise<void>
  end(callId: string): Promise<void>
  // Opaque SDP/ICE payload, relayed verbatim — never parsed by the transport.
  sendSignal(callId: string, data: unknown): Promise<void>
  onIncoming(callback: (call: IncomingCall) => void): () => void
  onAccepted(callback: (callId: string) => void): () => void
  onSignal(callback: (callId: string, data: unknown) => void): () => void
  onEnded(callback: (callId: string, reason: string) => void): () => void
}
