import { InternetTransport } from './transport/InternetTransport'
import type { IncomingMessage, MessageType, Transport } from './transport/Transport'

export type { IncomingMessage, MessageType }

// The chat talks to this, not to any transport directly. Swapping in a
// BluetoothTransport later (spec §22) means changing only this factory.
export async function connectMessaging(): Promise<Transport> {
  const transport = new InternetTransport()
  await transport.connect()
  return transport
}
