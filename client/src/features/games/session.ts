import { Chess } from 'chess.js'
import {
  decodeMatch,
  type ChessBoard,
  type GameKind,
  type MatchAck,
  type MatchAction,
  type MatchSnapshot,
  type GridBoard,
} from '../../services/transport/MatchTransport'
import { PongClient } from './pong'

export class GameSession {
  match: MatchSnapshot | null = null
  busy = false
  connected = false
  online = false
  pong: PongClient | null = null
  predicted: ChessBoard | null = null
  predictedGrid: GridBoard | null = null
  receivedAt = 0
  private dismissed = ''
  private hubOpen = false
  private disposed = false
  private revision = 0
  private retired = new Set<string>()
  private pendingPaddle: [number, number, boolean] | null = null
  private paddleTimer: ReturnType<typeof setTimeout> | undefined
  readonly me: string
  private call: (event: MatchAction, payload?: Record<string, unknown>) => Promise<MatchAck>
  private sendPaddle: (id: string, x: number, y?: number, released?: boolean) => void
  private changed: () => void
  private notice: (text: string) => void
  constructor(
    me: string,
    call: (event: MatchAction, payload?: Record<string, unknown>) => Promise<MatchAck>,
    sendPaddle: (id: string, x: number, y?: number, released?: boolean) => void,
    changed: () => void,
    notice: (text: string) => void,
  ) {
    this.me = me
    this.call = call
    this.sendPaddle = sendPaddle
    this.changed = changed
    this.notice = notice
  }
  get stage() {
    const m = this.match
    if (m && m.id !== this.dismissed && !this.hubOpen) {
      if (m.status === 'invited') return m.inviter === this.me ? 'outgoing' : 'incoming'
      if (m.status === 'playing') return 'playing'
      if (!['declined', 'cancelled', 'expired'].includes(m.outcome?.reason || '')) return 'result'
    }
    return this.hubOpen ? 'hub' : 'idle'
  }
  get player() {
    return (this.match?.players.indexOf(this.me) ?? -1) + 1
  }
  receive(value: unknown): void {
    const next = decodeMatch(value),
      current = this.match
    if (this.disposed || !next?.players.includes(this.me) || this.retired.has(next.id)) return
    if (current?.id === next.id && (next.version <= current.version || next.seq < current.seq)) return
    if (current && current.id !== next.id) {
      this.retired.add(current.id)
      if (this.retired.size > 32) this.retired.delete(this.retired.values().next().value!)
    }
    if (current?.id !== next.id) {
      this.pong = next.game === 'pong' ? new PongClient(next.players.indexOf(this.me) + 1) : null
      this.clearPaddle()
    }
    this.match = next
    this.receivedAt = performance.now()
    this.revision++
    if (current?.id !== next.id || next.seq !== current.seq || next.status !== 'playing') { this.predicted = null; this.predictedGrid = null }
    if (current?.id === next.id && current.drawOffer === this.me && !next.drawOffer && next.status === 'playing' && next.seq === current.seq)
      this.notice('Your partner declined your draw offer.')
    if (next.status !== 'over') this.hubOpen = false
    if (
      next.status === 'over' &&
      current?.status !== 'over' &&
      ['declined', 'cancelled', 'expired'].includes(next.outcome?.reason || '')
    )
      this.notice(`Invitation ${next.outcome!.reason}.`)
    this.changed()
  }
  availability(connected: boolean, online: boolean): void {
    if (this.connected === connected && this.online === online) return
    const reconnect = connected && !this.connected
    this.connected = connected
    this.online = online
    if (!connected) this.clearPaddle()
    if (reconnect) void this.sync()
    this.changed()
  }
  hub(): void {
    if (!this.connected) {
      this.notice('Connect to the internet to invite your partner.')
      return
    }
    if (this.stage !== 'playing') {
      if (this.stage === 'result') void this.action('match:leave')
      this.hubOpen = true
      this.changed()
    }
  }
  done(): void {
    if (this.match?.status === 'over') void this.action('match:leave')
    this.dismissed = this.match?.id || ''
    this.hubOpen = false
    this.changed()
  }
  async invite(game: GameKind, options: Record<string, unknown> = {}) {
    this.hubOpen = false
    this.changed()
    await this.request('match:invite', { game, ...options })
  }
  async sync() {
    const revision = this.revision
    const ack = await this.request('match:sync', {}, false)
    if (ack?.ok && ack.match === null && revision === this.revision && this.match?.status !== 'over') {
      if (this.match) this.notice('This game is no longer available. Start a new game.')
      this.match = null
      this.pong = null
      this.predicted = null
      this.clearPaddle()
      this.changed()
    }
  }
  action(event: MatchAction, extra: Record<string, unknown> = {}) {
    return this.match ? this.request(event, { matchId: this.match.id, ...extra }) : Promise.resolve(null)
  }
  async move(move: Record<string, unknown>) {
    const m = this.match
    if (this.disposed || !this.connected || this.busy || m?.status !== 'playing' || m.turn !== this.me || m.paused)
      return
    const payload = { matchId: m.id, seq: m.seq, move }
    if (m.game === 'chess' && m.board) {
      try {
        const board = m.board as ChessBoard,
          chess = new Chess(board.fen),
          uci = String(move.uci)
        const last = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
        this.predicted = {
          ...board,
          fen: chess.fen(),
          last: { from: last.from, to: last.to, captured: last.captured, promotion: last.promotion },
          check: chess.isCheck(),
        }
      } catch {
        return
      }
    }
    if ((m.game === 'tictactoe' || m.game === 'connect4') && m.board) {
      const board = m.board as GridBoard, cells = [...board.cells]
      let cell = Number(move.cell)
      if (m.game === 'connect4') {
        const col = Number(move.col)
        if (!Number.isInteger(col) || col < 0 || col > 6) return
        cell = -1
        for (let r = 5; r >= 0; r--) if (!cells[r * 7 + col]) { cell = r * 7 + col; break }
      }
      if (!Number.isInteger(cell) || cell < 0 || cell >= cells.length || cells[cell]) return
      cells[cell] = this.player
      this.predictedGrid = { ...board, cells, last: cell }
    }
    this.busy = true
    this.changed()
    try {
      let ack = await this.request('match:move', payload, false)
      if (!ack && this.connected && !this.disposed && this.match?.id === m.id)
        ack = await this.request('match:move', payload)
      if (ack && !ack.ok) this.notice('That move was not accepted. The board has been restored.')
      if (!ack || !ack.ok) await this.sync()
    } finally {
      if (!this.disposed) {
        this.predicted = null
        this.predictedGrid = null
        this.busy = false
        this.changed()
      }
    }
  }
  paddle(x: number, y = this.pong?.myY ?? 1.88, released = false) {
    const m = this.match
    if (!this.connected || this.disposed || m?.status !== 'playing' || m.paused || !this.pong) return
    const position = this.pong.paddle(x, y, released)
    this.pendingPaddle = [...position, released]
    if (this.paddleTimer) return
    const flush = () => {
      this.paddleTimer = undefined
      if (
        this.pendingPaddle === null ||
        this.match?.id !== m.id ||
        this.match.status !== 'playing' ||
        this.match.paused ||
        !this.connected
      ) {
        this.clearPaddle()
        return
      }
      this.sendPaddle(m.id, ...this.pendingPaddle)
      this.pendingPaddle = null
      this.paddleTimer = setTimeout(flush, 34)
    }
    flush()
  }
  private clearPaddle() {
    clearTimeout(this.paddleTimer)
    this.paddleTimer = undefined
    this.pendingPaddle = null
  }
  private async request(event: MatchAction, payload: Record<string, unknown>, report = true): Promise<MatchAck | null> {
    if (this.disposed) return null
    try {
      const ack = await this.call(event, payload)
      if (this.disposed) return null
      if (ack.match) this.receive(ack.match)
      if (!ack.ok && report && !(event === 'match:react' && ack.error === 'rate_limited'))
        this.notice(
          ack.error === 'partner_offline'
            ? 'Games need your partner to be online.'
            : ack.error === 'rate_limited'
              ? 'Wait a moment, then try again.'
              : `Could not complete the game action (${ack.error || 'invalid_payload'}).`,
        )
      return ack
    } catch {
      if (report && !this.disposed) this.notice('Connection interrupted. Reconnecting will restore your game.')
      return null
    }
  }
  dispose() {
    this.disposed = true
    this.clearPaddle()
    this.predicted = null
  }
}
