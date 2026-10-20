import { Chess } from 'chess.js'

// Server-side rules for the turn-based games (2.0.7). The backend is the only
// authority: a move is applied here or rejected, and clients render the view.

export type Seat = 1 | 2
export type TurnGameKind = 'chess' | 'connect4' | 'tictactoe' | 'dots'
export interface Outcome {
  winner: Seat | 0
  reason: string
}

export interface TurnRules {
  readonly turn: Seat
  readonly outcome: Outcome | null
  // null when applied, else an error code. A rejected move never changes state.
  apply(seat: Seat, move: unknown): string | null
  view(): Record<string, unknown>
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const int = (v: unknown): number | null => (Number.isSafeInteger(v) ? (v as number) : null)
const exactKeys = (m: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(m).length === keys.length && keys.every((k) => k in m)

const UCI_RE = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/

export class ChessRules implements TurnRules {
  private chess: Chess
  // Position counts keyed by the FEN's first four fields (placement, side,
  // castling, en passant): FIDE's "same position" for repetition.
  private counts = new Map<string, number>()
  private last: { from: string; to: string; promotion?: string; captured?: string } | null = null
  outcome: Outcome | null = null
  constructor(fen?: string) {
    this.chess = new Chess(fen)
    this.count()
  }
  get turn(): Seat {
    return this.chess.turn() === 'w' ? 1 : 2
  }
  private key(): string {
    return this.chess.fen().split(' ').slice(0, 4).join(' ')
  }
  private count(): number {
    const k = this.key()
    const n = (this.counts.get(k) ?? 0) + 1
    this.counts.set(k, n)
    return n
  }
  private halfmoves(): number {
    return Number(this.chess.fen().split(' ')[4])
  }
  // Draws the player to move may claim (FIDE 9.2 / 9.3). Fivefold and the
  // 75-move rule end the game automatically instead (FIDE 9.6).
  claimable(): 'threefold_repetition' | 'fifty_moves' | null {
    if (this.outcome) return null
    if ((this.counts.get(this.key()) ?? 0) >= 3) return 'threefold_repetition'
    if (this.halfmoves() >= 100) return 'fifty_moves'
    return null
  }
  claim(seat: Seat): string | null {
    if (this.outcome) return 'game_over'
    if (seat !== this.turn) return 'not_your_turn'
    const reason = this.claimable()
    if (!reason) return 'no_claim'
    this.outcome = { winner: 0, reason }
    return null
  }
  agreeDraw(): void {
    if (!this.outcome) this.outcome = { winner: 0, reason: 'agreement' }
  }
  apply(seat: Seat, move: unknown): string | null {
    if (this.outcome) return 'game_over'
    if (seat !== this.turn) return 'not_your_turn'
    if (!isRecord(move) || !exactKeys(move, ['uci']) || typeof move.uci !== 'string') return 'invalid_move'
    const m = UCI_RE.exec(move.uci)
    if (!m) return 'invalid_move'
    const [, from, to, promotion] = m
    // Only a generated legal move is accepted; a promotion must name its piece.
    const legal = this.chess
      .moves({ verbose: true })
      .find((l) => l.from === from && l.to === to && (l.promotion ?? undefined) === promotion)
    if (!legal) return 'illegal_move'
    this.chess.move({ from, to, promotion })
    this.last = { from, to, ...(promotion ? { promotion } : {}), ...(legal.captured ? { captured: legal.captured } : {}) }
    const repeats = this.count()
    if (this.chess.isCheckmate()) this.outcome = { winner: seat, reason: 'checkmate' }
    else if (this.chess.isStalemate()) this.outcome = { winner: 0, reason: 'stalemate' }
    else if (this.chess.isInsufficientMaterial()) this.outcome = { winner: 0, reason: 'insufficient_material' }
    else if (repeats >= 5) this.outcome = { winner: 0, reason: 'fivefold_repetition' }
    else if (this.halfmoves() >= 150) this.outcome = { winner: 0, reason: 'seventy_five_moves' }
    return null
  }
  view(): Record<string, unknown> {
    // `history`: every move so far in SAN ("e4", "Nf3", "O-O", "exd8=Q+"), for the move list.
    return { fen: this.chess.fen(), last: this.last, check: this.chess.inCheck(), claim: this.claimable(), history: this.chess.history() }
  }
}

const TTT_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]

export class TicTacToeRules implements TurnRules {
  cells = Array<number>(9).fill(0)
  line: number[] = []
  last = -1
  turn: Seat = 1
  outcome: Outcome | null = null
  apply(seat: Seat, move: unknown): string | null {
    if (this.outcome) return 'game_over'
    if (seat !== this.turn) return 'not_your_turn'
    if (!isRecord(move) || !exactKeys(move, ['cell'])) return 'invalid_move'
    const cell = int(move.cell)
    if (cell === null || cell < 0 || cell > 8) return 'invalid_move'
    if (this.cells[cell] !== 0) return 'illegal_move'
    this.cells[cell] = seat
    this.last = cell
    this.line = TTT_LINES.find((l) => l.every((i) => this.cells[i] === seat)) ?? []
    if (this.line.length) this.outcome = { winner: seat, reason: 'three_in_a_row' }
    else if (this.cells.every((c) => c !== 0)) this.outcome = { winner: 0, reason: 'board_full' }
    this.turn = seat === 1 ? 2 : 1
    return null
  }
  view(): Record<string, unknown> {
    return { cells: this.cells, line: this.line, last: this.last }
  }
}

export class ConnectFourRules implements TurnRules {
  cells = Array<number>(42).fill(0)
  line: number[] = []
  last = -1
  turn: Seat = 1
  outcome: Outcome | null = null
  apply(seat: Seat, move: unknown): string | null {
    if (this.outcome) return 'game_over'
    if (seat !== this.turn) return 'not_your_turn'
    if (!isRecord(move) || !exactKeys(move, ['col'])) return 'invalid_move'
    const col = int(move.col)
    if (col === null || col < 0 || col > 6) return 'invalid_move'
    let row = 5
    while (row >= 0 && this.cells[row * 7 + col] !== 0) row--
    if (row < 0) return 'illegal_move'
    const cell = row * 7 + col
    this.cells[cell] = seat
    this.last = cell
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const line = [cell]
      for (const sign of [-1, 1]) {
        let r = row + dr * sign
        let c = col + dc * sign
        while (r >= 0 && r <= 5 && c >= 0 && c <= 6 && this.cells[r * 7 + c] === seat) {
          line.push(r * 7 + c)
          r += dr * sign
          c += dc * sign
        }
      }
      if (line.length >= 4) {
        this.line = line.sort((a, b) => a - b)
        this.outcome = { winner: seat, reason: 'four_connected' }
        break
      }
    }
    if (!this.outcome && this.cells.every((c) => c !== 0)) this.outcome = { winner: 0, reason: 'board_full' }
    this.turn = seat === 1 ? 2 : 1
    return null
  }
  view(): Record<string, unknown> {
    return { cells: this.cells, line: this.line, last: this.last }
  }
}

// 5x5 boxes: 6 rows of 5 horizontal lines, 5 rows of 6 vertical lines.
export class DotsRules implements TurnRules {
  h = Array<number>(30).fill(0)
  v = Array<number>(30).fill(0)
  boxes = Array<number>(25).fill(0)
  last: { h: boolean; r: number; c: number } | null = null
  turn: Seat = 1
  outcome: Outcome | null = null
  score(seat: Seat): number {
    return this.boxes.filter((b) => b === seat).length
  }
  apply(seat: Seat, move: unknown): string | null {
    if (this.outcome) return 'game_over'
    if (seat !== this.turn) return 'not_your_turn'
    if (!isRecord(move) || !exactKeys(move, ['h', 'r', 'c']) || typeof move.h !== 'boolean') return 'invalid_move'
    const horizontal = move.h
    const r = int(move.r)
    const c = int(move.c)
    if (r === null || c === null || r < 0 || c < 0 || r > (horizontal ? 5 : 4) || c > (horizontal ? 4 : 5)) return 'invalid_move'
    const lines = horizontal ? this.h : this.v
    const index = r * (horizontal ? 5 : 6) + c
    if (lines[index] !== 0) return 'illegal_move'
    lines[index] = seat
    this.last = { h: horizontal, r, c }
    let closed = false
    for (let box = 0; box < 25; box++) {
      const br = Math.floor(box / 5)
      const bc = box % 5
      if (this.boxes[box] === 0 && this.h[br * 5 + bc] && this.h[(br + 1) * 5 + bc] && this.v[br * 6 + bc] && this.v[br * 6 + bc + 1]) {
        this.boxes[box] = seat
        closed = true
      }
    }
    // 25 boxes: never a tie.
    if (this.boxes.every((b) => b !== 0)) this.outcome = { winner: this.score(1) > this.score(2) ? 1 : 2, reason: 'most_boxes' }
    if (!closed) this.turn = seat === 1 ? 2 : 1
    return null
  }
  view(): Record<string, unknown> {
    return { h: this.h, v: this.v, boxes: this.boxes, last: this.last }
  }
}

export function createRules(game: TurnGameKind): TurnRules {
  switch (game) {
    case 'chess':
      return new ChessRules()
    case 'connect4':
      return new ConnectFourRules()
    case 'tictactoe':
      return new TicTacToeRules()
    case 'dots':
      return new DotsRules()
  }
}
