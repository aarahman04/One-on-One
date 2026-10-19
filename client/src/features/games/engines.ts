import { Chess } from 'chess.js'

export type GameKind = 'chess' | 'pong' | 'connect4' | 'tictactoe' | 'dots'
export interface GameResult { winner: number; detail: string }
export const gameTitles: Record<GameKind, string> = { chess: 'Chess', pong: 'Table Tennis', connect4: 'Connect 4', tictactoe: 'Tic-Tac-Toe', dots: 'Dots & Boxes' }

function requireMove(ok: unknown, message = 'Invalid move.'): asserts ok { if (!ok) throw new Error(message) }
function keys(data: Record<string, unknown>, expected: string[]) { requireMove(data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).sort().join(',') === expected.sort().join(',')) }
function integer(data: Record<string, unknown>, key: string): number { const n = data[key]; requireMove(typeof n === 'number' && Number.isInteger(n)); return n }

export abstract class TurnGame {
  turn = 1
  nextSeq = 0
  result: GameResult | null = null
  play(player: number, seq: number, data: Record<string, unknown>): void {
    requireMove(!this.result, 'This game has finished.')
    requireMove(seq === this.nextSeq, 'Moves arrived out of order.')
    requireMove(player === this.turn, 'That move was out of turn.')
    this.move(data)
    this.nextSeq++
  }
  protected abstract move(data: Record<string, unknown>): void
}

export class TicTacToeGame extends TurnGame {
  cells = Array<number>(9).fill(0)
  winning: number[] = []
  protected move(data: Record<string, unknown>): void {
    keys(data, ['cell'])
    const cell = integer(data, 'cell')
    requireMove(cell >= 0 && cell < 9 && !this.cells[cell], 'That cell is occupied.')
    this.cells[cell] = this.turn
    this.winning = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]].find((line) => line.every((i) => this.cells[i] === this.turn)) || []
    if (this.winning.length) this.result = { winner: this.turn, detail: 'Three in a row' }
    else if (this.cells.every(Boolean)) this.result = { winner: 0, detail: 'A well-matched draw' }
    this.turn = 3 - this.turn
  }
}

export class ConnectFourGame extends TurnGame {
  cells = Array<number>(42).fill(0)
  winning: number[] = []
  landing(col: number): number { for (let r = 5; col >= 0 && col <= 6 && r >= 0; r--) if (!this.cells[r * 7 + col]) return r * 7 + col; return -1 }
  protected move(data: Record<string, unknown>): void {
    keys(data, ['col'])
    const col = integer(data, 'col'), cell = this.landing(col)
    requireMove(cell >= 0, 'That column is full.')
    this.cells[cell] = this.turn
    for (const [dr, dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
      const line = [cell]
      for (const sign of [-1, 1]) {
        let r = Math.floor(cell / 7) + dr * sign, c = col + dc * sign
        while (r >= 0 && r < 6 && c >= 0 && c < 7 && this.cells[r * 7 + c] === this.turn) { line.push(r * 7 + c); r += dr * sign; c += dc * sign }
      }
      if (line.length >= 4) { this.winning = line; this.result = { winner: this.turn, detail: 'Four connected' }; break }
    }
    if (!this.result && this.cells.every(Boolean)) this.result = { winner: 0, detail: 'The board is full' }
    this.turn = 3 - this.turn
  }
}

export class DotsGame extends TurnGame {
  horizontal = Array<number>(30).fill(0)
  vertical = Array<number>(30).fill(0)
  boxes = Array<number>(25).fill(0)
  score(player: number): number { return this.boxes.filter((v) => v === player).length }
  protected move(data: Record<string, unknown>): void {
    keys(data, ['h', 'r', 'c'])
    requireMove(typeof data.h === 'boolean')
    const h = data.h, r = integer(data, 'r'), c = integer(data, 'c')
    requireMove(r >= 0 && r <= (h ? 5 : 4) && c >= 0 && c <= (h ? 4 : 5))
    const lines = h ? this.horizontal : this.vertical, i = r * (h ? 5 : 6) + c
    requireMove(!lines[i], 'That line is already taken.')
    lines[i] = this.turn
    let completed = false
    for (let box = 0; box < 25; box++) {
      const br = Math.floor(box / 5), bc = box % 5
      if (!this.boxes[box] && this.horizontal[br * 5 + bc] && this.horizontal[(br + 1) * 5 + bc] && this.vertical[br * 6 + bc] && this.vertical[br * 6 + bc + 1]) { this.boxes[box] = this.turn; completed = true }
    }
    if (this.boxes.every(Boolean)) this.result = { winner: this.score(1) > this.score(2) ? 1 : 2, detail: `${this.score(1)}–${this.score(2)} boxes` }
    if (!completed) this.turn = 3 - this.turn
  }
}

export class ChessGame extends TurnGame {
  board: Chess
  captured: string[] = []
  constructor(fen?: string) { super(); this.board = new Chess(fen); this.refresh() }
  get legal(): string[] { return this.board.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || '')) }
  private refresh(): void {
    const b = this.board
    this.turn = b.turn() === 'w' ? 1 : 2
    this.result = b.isCheckmate() ? { winner: 3 - this.turn, detail: 'Checkmate' }
      : b.isStalemate() ? { winner: 0, detail: 'Stalemate' }
      : b.isThreefoldRepetition() ? { winner: 0, detail: 'Draw by repetition' }
      : b.isDrawByFiftyMoves() ? { winner: 0, detail: 'Draw by the 50-move rule' }
      : b.isInsufficientMaterial() ? { winner: 0, detail: 'Insufficient material' } : null
  }
  protected move(data: Record<string, unknown>): void {
    keys(data, ['uci'])
    const uci = data.uci
    requireMove(typeof uci === 'string' && this.legal.includes(uci), 'That chess move is illegal.')
    const m = this.board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
    if (m.captured) this.captured.push(m.color === 'w' ? m.captured : m.captured.toUpperCase())
    this.refresh()
  }
}

export function createBoard(kind: Exclude<GameKind, 'pong'>): TurnGame {
  return kind === 'chess' ? new ChessGame() : kind === 'connect4' ? new ConnectFourGame() : kind === 'dots' ? new DotsGame() : new TicTacToeGame()
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
const number = (v: unknown): number => { requireMove(typeof v === 'number' && Number.isFinite(v)); return v }
export const PADDLE_HALF = .105, PADDLE_X = .055, BALL_RADIUS = .014, MAX_SPEED = 1.8

// Android PongGame.kt: normalized coordinates, inviter authority, a sequence per sender.
export class PongGame {
  x = .5; y = .5; vx = 0; vy = 0; hostY = .5; guestY = .5
  hostScore = 0; guestScore = 0; countdown = 3; hits = 0
  private expected = [0, 0]
  private serveDirection = 1
  private targetX = .5
  private targetY = .5
  private snapshotAge = 0
  get winner(): number { return this.hostScore === 7 ? 1 : this.guestScore === 7 ? 2 : 0 }
  paddle(player: number, y: number): void { requireMove((player === 1 || player === 2) && Number.isFinite(y)); if (player === 1) this.hostY = clamp(y, PADDLE_HALF, 1 - PADDLE_HALF); else this.guestY = clamp(y, PADDLE_HALF, 1 - PADDLE_HALF) }
  receive(player: number, seq: number, data: Record<string, unknown>): void {
    requireMove((player === 1 || player === 2) && seq === this.expected[player - 1], 'Moves arrived out of order.')
    keys(data, player === 1 ? ['b','p','s'] : ['p'])
    const p = number(data.p)
    // Float32 peers serialize .105 as .1049999967; allow that rounding at the boundary.
    requireMove(p >= PADDLE_HALF - 1e-7 && p <= 1 - PADDLE_HALF + 1e-7)
    if (player === 1) {
      const b = data.b, s = data.s
      requireMove(Array.isArray(b) && b.length === 4 && Array.isArray(s) && s.length === 2)
      const [x,y,vx,vy] = b.map(number), [a,c] = s.map(number)
      requireMove(x >= 0 && x <= 1 && y >= 0 && y <= 1 && Math.abs(vx) <= MAX_SPEED + 1e-7 && Math.abs(vy) <= MAX_SPEED + 1e-7)
      requireMove(Number.isInteger(a) && Number.isInteger(c) && a >= this.hostScore && c >= this.guestScore && a <= 7 && c <= 7 && a - this.hostScore + c - this.guestScore <= 1 && !(a === 7 && c === 7))
      const serve = a !== this.hostScore || c !== this.guestScore
      if (!serve && this.vx * vx < 0) this.hits++
      this.hostScore = a; this.guestScore = c; this.hostY = p
      this.targetX = x; this.targetY = y; this.vx = vx; this.vy = vy; this.snapshotAge = 0
      if (serve) { this.countdown = 3; this.x = x; this.y = y }
      if (vx || vy) this.countdown = 0
    } else this.guestY = p
    this.expected[player - 1]++
  }
  tick(seconds: number, authority: boolean): void {
    if (this.winner) return
    const dt = clamp(seconds, 0, .05)
    if (!authority) {
      this.countdown = Math.max(0, this.countdown - dt); this.snapshotAge += dt
      const prediction = Math.min(this.snapshotAge, .12), blend = 1 - Math.exp(-22 * dt)
      this.x += (clamp(this.targetX + this.vx * prediction, 0, 1) - this.x) * blend
      this.y += (clamp(this.targetY + this.vy * prediction, 0, 1) - this.y) * blend
      return
    }
    if (this.countdown > 0) {
      this.countdown = Math.max(0, this.countdown - dt)
      if (!this.countdown) { this.vx = .48 * this.serveDirection; this.vy = .19 }
      return
    }
    for (let i = 0; i < 4 && !this.countdown && !this.winner; i++) {
      const oldX = this.x
      this.x += this.vx * dt / 4; this.y += this.vy * dt / 4
      if (this.y < BALL_RADIUS) { this.y = BALL_RADIUS * 2 - this.y; this.vy = Math.abs(this.vy) }
      if (this.y > 1 - BALL_RADIUS) { this.y = 2 * (1 - BALL_RADIUS) - this.y; this.vy = -Math.abs(this.vy) }
      if (this.vx < 0 && oldX >= PADDLE_X + BALL_RADIUS && this.x < PADDLE_X + BALL_RADIUS && Math.abs(this.y - this.hostY) <= PADDLE_HALF + BALL_RADIUS) { this.x = PADDLE_X + BALL_RADIUS; this.bounce(this.hostY, 1) }
      else if (this.vx > 0 && oldX <= 1 - PADDLE_X - BALL_RADIUS && this.x > 1 - PADDLE_X - BALL_RADIUS && Math.abs(this.y - this.guestY) <= PADDLE_HALF + BALL_RADIUS) { this.x = 1 - PADDLE_X - BALL_RADIUS; this.bounce(this.guestY, -1) }
      if (this.x < 0 || this.x > 1) {
        if (this.x < 0) this.guestScore++; else this.hostScore++
        this.serveDirection = this.x < 0 ? -1 : 1
        this.x = this.y = .5; this.vx = this.vy = 0; this.countdown = 3
      }
    }
  }
  private bounce(paddle: number, direction: number): void {
    const speed = Math.min(MAX_SPEED, Math.hypot(this.vx, this.vy) * 1.07)
    this.vy = clamp((this.y - paddle) / PADDLE_HALF, -1, 1) * speed * .72
    this.vx = Math.sqrt(speed * speed - this.vy * this.vy) * direction; this.hits++
  }
  packet(authority: boolean): Record<string, unknown> { return authority ? { p: Math.fround(this.hostY), b: [this.x,this.y,this.vx,this.vy].map(Math.fround), s: [this.hostScore,this.guestScore] } : { p: Math.fround(this.guestY) } }
}
