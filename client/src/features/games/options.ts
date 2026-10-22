import type { GameKind } from '../../services/transport/MatchTransport'

export const clockPresets = [null, 60_000, 120_000, 300_000, 600_000, 3_600_000] as const
export const clockPresetLabels = ['No limit', '1 min', '2 min', '5 min', '10 min', '1 hour']
export const defaultClock = (game: GameKind): number | null =>
  ({ chess: 600_000, reversi: 300_000, connect4: 120_000, tictactoe: 60_000, dots: null, pong: null })[game]
export function validClock(base: number, inc: number): boolean {
  return Number.isInteger(base) && base >= 10_000 && base <= 10_800_000 && Number.isInteger(inc) && inc >= 0 && inc <= 60_000
}
export const reactionLength = (text: string): number => Array.from(text).length
export const limitReaction = (text: string): string => Array.from(text.replace(/\s+/gu, ' ')).slice(0, 60).join('')
export function clockFace(ms: number): string {
  const t = Math.max(0, ms), s = Math.floor(t / 1000), pad = (n: number) => String(n).padStart(2, '0')
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
    : t < 10_000 ? `0:${pad(s)}.${Math.floor(t / 100) % 10}` : `${Math.floor(s / 60)}:${pad(s % 60)}`
}
export function clockLabel(base: number, inc: number): string {
  const seconds = base / 1000
  const main = seconds % 3600 === 0 ? `${seconds / 3600} h` : seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`
  return inc ? `${main} + ${inc / 1000} s` : main
}
