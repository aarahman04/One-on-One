// Transport abstraction (spec §22). V1 ships only InternetTransport; a
// future BluetoothTransport implements this same interface so the chat UI
// and MessageService never change.

export interface IncomingMessage {
  id: string
  senderId: string
  content: string
  createdAt: string
}

export interface Transport {
  connect(): Promise<void>
  disconnect(): void
  sendMessage(content: string): Promise<void>
  onMessage(callback: (message: IncomingMessage) => void): () => void
}
