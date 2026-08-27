// Transport abstraction (spec §22). V1 ships only InternetTransport; a
// future BluetoothTransport implements this same interface so the chat UI
// and MessageService never change.

export type MessageType = 'text' | 'letter'

export interface IncomingMessage {
  id: string
  senderId: string
  content: string
  createdAt: string
  type: MessageType
  payload: unknown | null
}

export interface Transport {
  connect(): Promise<void>
  disconnect(): void
  sendMessage(content: string, type?: MessageType, payload?: unknown): Promise<void>
  onMessage(callback: (message: IncomingMessage) => void): () => void
}
