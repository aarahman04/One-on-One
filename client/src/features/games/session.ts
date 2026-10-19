import type { GameEvent, GameEventName, GamePacket } from '../../services/transport/Transport'
import { createBoard, gameTitles, PongGame, type GameKind, type GameResult, type TurnGame } from './engines'

export type GameStage = 'idle' | 'hub' | 'outgoing' | 'incoming' | 'playing' | 'result'
type Relay = (event: GameEventName, packet: GamePacket) => Promise<void>
export class GameSession {
  stage: GameStage = 'idle'
  id = ''
  kind: GameKind = 'chess'
  player = 1
  board: TurnGame | null = null
  pong: PongGame | null = null
  result: GameResult | null = null
  paused = false
  busy = false
  myWins = 0
  theirWins = 0
  bestOfThree = false
  private relay: Relay
  private changed: () => void
  private notice: (text: string) => void
  private nickname: string
  private partner = ''
  private online = false
  private relayLost = false
  private pongSeq = 0
  private retired = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private pauseTimer: ReturnType<typeof setTimeout> | undefined
  private resultTimer: ReturnType<typeof setTimeout> | undefined
  private sender: ReturnType<typeof setInterval> | undefined
  private disposed = false
  constructor(relay: Relay, nickname: string, changed: () => void, notice: (text: string) => void) {
    this.relay = relay; this.nickname = nickname; this.changed = changed; this.notice = notice
  }
  availability(online: boolean, partner?: string): void {
    this.online = online
    if (partner) this.partner = partner
    if (this.stage !== 'playing') return
    if (online && !this.relayLost) {
      clearTimeout(this.pauseTimer); this.pauseTimer = undefined
      if (this.paused) { this.paused = false; this.changed() }
    } else if (!this.pauseTimer) {
      this.paused = true; this.changed()
      const id = this.id
      this.pauseTimer = setTimeout(() => { if (this.id === id && this.stage === 'playing') { this.finish({ winner: 0, detail: `${this.nickname} disconnected. The game has ended.` }); this.sendEnd(id, 'disconnected') } }, 15_000)
    }
  }
  private canStart(): boolean { if (!this.online) { this.notice(`Games need ${this.nickname} online`); return false }; return !this.disposed }
  hub(): void { if (this.canStart() && ['idle','result'].includes(this.stage)) { this.stage = 'hub'; this.changed() } }
  invite(kind: GameKind): void {
    if (!this.canStart() || !['idle','hub','result'].includes(this.stage)) return
    this.resetScore(kind)
    this.kind = kind; this.id = crypto.randomUUID(); this.player = 1; this.result = null; this.board = null; this.pong = null
    this.stage = 'outgoing'; this.busy = false; this.changed(); this.inviteTimer()
    void this.request('game:invite', { gameId: this.id, game: kind })
  }
  accept(): void {
    if (this.stage !== 'incoming' || !this.canStart()) return
    const id = this.id
    this.player = 2
    this.start(false)
    void this.request('game:accept', { gameId: id }).then((ok) => { if (ok && this.id === id && this.stage === 'playing') this.startSender() })
  }
  decline(): void {
    if (this.stage !== 'incoming') return
    const id = this.id
    this.retire(); this.stopTimers(); this.stage = 'idle'; this.changed()
    void this.relay('game:decline', { gameId: id }).catch(() => {})
  }
  cancel(): void {
    if (this.stage !== 'outgoing') return
    const id = this.id
    this.retire(); this.stopTimers(); this.stage = 'idle'; this.changed(); this.sendEnd(id, 'cancelled')
  }
  leave(resign: boolean): void {
    if (this.stage !== 'playing') return
    this.finish({ winner: 3 - this.player, detail: resign ? 'You resigned.' : 'You left the game.' })
    this.sendEnd(this.id, resign ? 'resigned' : 'left')
  }
  done(): void { this.retire(); this.stopTimers(); this.stage = 'idle'; this.changed() }
  move(data: Record<string, unknown>): void {
    const board = this.board, id = this.id
    if (this.stage !== 'playing' || this.paused || this.busy || !board || board.turn !== this.player || board.result) return
    const seq = board.nextSeq
    try { board.play(this.player, seq, data) } catch (error) { this.notice((error as Error).message); return }
    this.busy = true; this.changed()
    void this.request('game:move', { gameId: id, seq, data }).then((ok) => {
      if (ok && this.id === id && this.stage === 'playing') { this.busy = false; this.changed(); this.conclude() }
    })
  }
  receive(event: GameEvent): void {
    if (this.disposed || event.from !== this.partner || this.retired.has(event.gameId)) return
    if (event.name === 'game:invite') {
      if (!Object.hasOwn(gameTitles, event.game || '') || event.gameId === this.id) return
      if (this.stage === 'playing' && this.board?.result) this.finish(this.board.result)
      if (!this.online || !['idle','hub','result'].includes(this.stage) && !(this.stage === 'outgoing' && event.gameId < this.id)) {
        void this.relay('game:decline', { gameId: event.gameId }).catch(() => {}); return
      }
      if (this.stage === 'outgoing') this.cancel()
      this.resetScore(event.game as GameKind)
      this.kind = event.game as GameKind; this.id = event.gameId; this.player = 2; this.result = null
      this.stage = 'incoming'; this.busy = false; this.changed(); this.inviteTimer(); return
    }
    if (event.gameId !== this.id) return
    if (event.name === 'game:accept' && this.stage === 'outgoing') this.start()
    else if (event.name === 'game:decline' && this.stage === 'outgoing') this.finish({ winner: 0, detail: `${this.nickname} declined the invitation.` })
    else if (event.name === 'game:end' && ['incoming','outgoing','playing'].includes(this.stage)) {
      const reasons: Record<string, string> = { resigned: `${this.nickname} resigned.`, left: `${this.nickname} left the game.`, cancelled: 'The invitation was cancelled.', invite_timeout: 'The invitation expired.', invalid_move: 'The game ended because a move could not be validated.', disconnected: `${this.nickname} disconnected. The game has ended.`, process_restarted: `${this.nickname} restarted the app. This game has ended.` }
      this.finish({ winner: ['resigned','left'].includes(event.reason || '') ? this.player : 0, detail: reasons[event.reason || ''] || 'The game has ended.' })
    } else if (event.name === 'game:move' && this.stage === 'playing') {
      try {
        if (!Number.isInteger(event.seq) || !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) throw new Error('Invalid move')
        const data = event.data as Record<string, unknown>
        if (this.pong) {
          this.pong.receive(3 - this.player, event.seq!, data)
          if (this.pong.winner) this.finish({ winner: this.pong.winner, detail: `${this.pong.hostScore}–${this.pong.guestScore} · first to 7` })
        } else { this.board!.play(3 - this.player, event.seq!, data); this.conclude() }
        this.changed()
      } catch {
        this.finish({ winner: 0, detail: 'The game ended: an illegal or out-of-sequence move arrived.' })
        this.sendEnd(this.id, 'invalid_move')
      }
    }
  }
  private start(sendPong = true): void {
    this.stopTimers()
    this.board = this.kind === 'pong' ? null : createBoard(this.kind)
    this.pong = this.kind === 'pong' ? new PongGame() : null
    this.pongSeq = 0; this.relayLost = false; this.paused = false; this.busy = false; this.result = null; this.stage = 'playing'
    this.changed(); this.availability(this.online)
    if (sendPong) this.startSender()
  }
  private startSender(): void {
    if (!this.pong || this.sender) return
    const id = this.id
    this.sender = setInterval(() => {
      if (this.stage !== 'playing' || this.paused || !this.pong) return
      const pong = this.pong, result = pong.winner ? { winner: pong.winner, detail: `${pong.hostScore}–${pong.guestScore} · first to 7` } : null
      void this.request('game:move', { gameId: id, seq: this.pongSeq++, data: pong.packet(this.player === 1) }).then((ok) => { if (ok && result && this.id === id) this.finish(result) })
    }, 34)
  }
  private conclude(): void {
    if (!this.board?.result || this.resultTimer) return
    const result = this.board.result, id = this.id
    this.resultTimer = setTimeout(() => { if (this.id === id) this.finish(result) }, 800)
  }
  private inviteTimer(): void {
    clearTimeout(this.timer)
    const id = this.id
    this.timer = setTimeout(() => { if (this.id === id) { if (this.stage === 'incoming') this.decline(); else { this.finish({ winner: 0, detail: 'The invitation expired.' }); this.sendEnd(id, 'invite_timeout') } } }, 30_000)
  }
  private finish(result: GameResult): void {
    if (!['incoming','outgoing','playing'].includes(this.stage)) return
    if (this.stage === 'playing' && this.kind === 'tictactoe' && result.detail === 'Three in a row') { if (result.winner === this.player) this.myWins++; else this.theirWins++ }
    this.stopTimers(); this.retire(); this.result = result; this.paused = false; this.busy = false; this.stage = 'result'; this.changed()
  }
  private resetScore(kind: GameKind): void { if (kind !== this.kind || this.myWins >= 2 || this.theirWins >= 2) { this.myWins = 0; this.theirWins = 0; this.bestOfThree = false } }
  private retire(): void { if (this.id) this.retired.add(this.id); if (this.retired.size > 32) this.retired.delete(this.retired.values().next().value!) }
  private stopTimers(): void { clearTimeout(this.timer); clearTimeout(this.pauseTimer); clearTimeout(this.resultTimer); clearInterval(this.sender); this.timer = this.pauseTimer = this.resultTimer = this.sender = undefined }
  private sendEnd(id: string, reason: string): void { void this.relay('game:end', { gameId: id, reason }).catch(() => {}) }
  private async request(event: GameEventName, packet: GamePacket): Promise<boolean> {
    try { await this.relay(event, packet); return true }
    catch (error) {
      if (this.disposed || this.id !== packet.gameId || !['incoming','outgoing','playing'].includes(this.stage)) return false
      const code = (error as Error).message
      if (this.stage === 'playing' && ['partner_offline','not connected','send timeout'].includes(code)) { this.relayLost = true; this.availability(false); return false }
      const message = code === 'partner_offline' ? `Games need ${this.nickname} online` : code === 'rate_limited' ? 'Games are moving too quickly. Try again in a moment.' : ['not_member','connection_inactive'].includes(code) ? 'This connection is no longer available for games.' : 'The game could not stay connected. Please start a new game.'
      this.notice(message); this.finish({ winner: 0, detail: message }); this.sendEnd(this.id, 'relay_failed'); return false
    }
  }
  dispose(): void { if (['incoming','outgoing','playing'].includes(this.stage)) this.sendEnd(this.id, 'left'); this.disposed = true; this.stopTimers() }
}
