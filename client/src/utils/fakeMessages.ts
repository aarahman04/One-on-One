export type Sender = 'you' | 'other'

export interface FakeMessage {
  id: string
  sender: Sender
  text: string
  at: Date
}

const base = new Date('2026-08-26T11:00:00')

export const fakeMessages: FakeMessage[] = [
  { id: '1', sender: 'other', text: 'hey, are you free today?', at: new Date(base.getTime() + 32 * 60_000) },
  { id: '2', sender: 'you', text: "yeah, what's up?", at: new Date(base.getTime() + 33 * 60_000) },
  { id: '3', sender: 'other', text: 'nothing much', at: new Date(base.getTime() + 34 * 60_000) },
  {
    id: '4',
    sender: 'other',
    text: 'wanna grab coffee tomorrow?',
    at: new Date(base.getTime() + 24 * 60 * 60_000 + 10 * 60_000),
  },
  {
    id: '5',
    sender: 'you',
    text: 'sure, morning works',
    at: new Date(base.getTime() + 24 * 60 * 60_000 + 12 * 60_000),
  },
]
