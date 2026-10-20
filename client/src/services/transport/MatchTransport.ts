export const gameTitles = {
  chess: 'Chess',
  pong: 'Table Tennis',
  connect4: 'Connect 4',
  tictactoe: 'Tic-Tac-Toe',
  dots: 'Dots & Boxes',
} as const
export type GameKind = keyof typeof gameTitles
export type MatchAction =
  | 'match:invite'
  | 'match:accept'
  | 'match:decline'
  | 'match:leave'
  | 'match:resign'
  | 'match:move'
  | 'match:draw'
  | 'match:rematch'
  | 'match:sync'
  | 'match:away'
export interface ChessBoard {
  fen: string
  last: { from: string; to: string; promotion?: string; captured?: string } | null
  check: boolean
  claim: string | null
  history: string[]
}
export interface GridBoard {
  cells: number[]
  line: number[]
  last: number
}
export interface DotsBoard {
  h: number[]
  v: number[]
  boxes: number[]
  last: { h: boolean; r: number; c: number } | null
}
export interface MatchSnapshot {
  id: string
  game: GameKind
  status: 'invited' | 'playing' | 'over'
  inviter: string
  players: [string, string]
  turn: string | null
  seq: number
  version: number
  board: ChessBoard | GridBoard | DotsBoard | { score: number[] } | null
  outcome: { winner: string | null; reason: string } | null
  drawOffer: string | null
  rematch: string[]
  series: Record<string, number>
  away: string[]
  paused: boolean
  expiresAt: number | null
}
export interface PongFrame {
  id: string
  t: number
  b: [number, number, number, number]
  p: [number, number]
  s: [number, number]
  c: number
  h: number
}
export interface MatchAck {
  ok: boolean
  error?: string
  match?: MatchSnapshot | null
}
export interface MatchTransport {
  sendMatch(event: MatchAction, payload?: Record<string, unknown>): Promise<MatchAck>
  sendPaddle(matchId: string, x: number): void
  onMatch(callback: (match: MatchSnapshot) => void): () => void
  onPong(callback: (frame: PongFrame) => void): () => void
}

// Socket input is untrusted. Reject malformed state before any renderer can use it.
export function decodeMatch(value: unknown): MatchSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const m = value as MatchSnapshot
  const strings = (a: unknown): a is string[] => Array.isArray(a) && a.every((v) => typeof v === 'string')
  const cells = (a: unknown, size: number) =>
    Array.isArray(a) && a.length === size && a.every((n) => Number.isInteger(n) && n >= 0 && n <= 2)
  const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0
  if (
    typeof m.id !== 'string' ||
    !m.id ||
    !Object.hasOwn(gameTitles, m.game) ||
    !['invited', 'playing', 'over'].includes(m.status) ||
    !strings(m.players) ||
    m.players.length !== 2 ||
    m.players[0] === m.players[1] ||
    !m.players.includes(m.inviter) ||
    !count(m.seq) ||
    !count(m.version) ||
    !(m.turn === null || m.players.includes(m.turn)) ||
    typeof m.paused !== 'boolean' ||
    ![m.away, m.rematch].every((a) => strings(a) && a.every((u) => m.players.includes(u))) ||
    !(m.drawOffer === null || m.players.includes(m.drawOffer)) ||
    !m.series ||
    typeof m.series !== 'object' ||
    !Object.entries(m.series).every(([u, n]) => m.players.includes(u) && count(n)) ||
    !(m.expiresAt === null || Number.isFinite(m.expiresAt)) ||
    !(
      m.outcome === null ||
      (m.outcome &&
        typeof m.outcome.reason === 'string' &&
        (m.outcome.winner === null || m.players.includes(m.outcome.winner)))
    )
  )
    return null
  if (m.status === 'invited' && m.board === null) return m
  const b = m.board as unknown as Record<string, unknown> | null
  if (!b) return m.status === 'over' ? m : null
  if (m.game === 'chess') {
    const last = b.last as ChessBoard['last']
    if (
      typeof b.fen !== 'string' ||
      typeof b.check !== 'boolean' ||
      !(b.claim === null || ['threefold_repetition', 'fifty_moves'].includes(b.claim as string)) ||
      !strings(b.history) ||
      !(last === null || (last && /^[a-h][1-8]$/.test(last.from) && /^[a-h][1-8]$/.test(last.to)))
    )
      return null
  } else if (m.game === 'tictactoe' || m.game === 'connect4') {
    const size = m.game === 'tictactoe' ? 9 : 42
    if (
      !cells(b.cells, size) ||
      !Array.isArray(b.line) ||
      !b.line.every((n) => count(n) && n < size) ||
      !Number.isInteger(b.last) ||
      (b.last as number) < -1 ||
      (b.last as number) >= size
    )
      return null
  } else if (m.game === 'dots') {
    const last = b.last as DotsBoard['last']
    if (
      !cells(b.h, 30) ||
      !cells(b.v, 30) ||
      !cells(b.boxes, 25) ||
      !(
        last === null ||
        (last &&
          typeof last.h === 'boolean' &&
          count(last.r) &&
          count(last.c) &&
          last.r < (last.h ? 6 : 5) &&
          last.c < (last.h ? 5 : 6))
      )
    )
      return null
  } else if (!Array.isArray(b.score) || b.score.length !== 2 || !b.score.every(count)) return null
  return m
}
