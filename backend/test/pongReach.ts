import { COURT_H, RACKET_FAR, RACKET_MAX, RACKET_MIN, RACKET_NEAR } from '../src/games/pong.js'

// Receiver model shared by the fairness sweeps: seat 1 starts at the neutral baseline (.5, COURT_H + .08)
// and its bat may move at BAT_SPEED (a fast finger through racketFollow) after REACTION_S.
export const BAT_SPEED = 6, REACTION_S = .2, DT = 8
export const start: [number, number] = [.5, COURT_H + .08]
export const reachable = (bx: number, by: number, r: number, budget: number) => {
  if (budget < 0) return false
  // Candidate bat centres inside the legal region and within the contact radius of the ball.
  for (let k = 0; k <= 48; k++) {
    const angle = k * Math.PI / 8, d = k === 0 ? 0 : r * (1 + ((k - 1) >> 4)) / 3
    const qx = bx + Math.cos(angle) * d, qy = by + Math.sin(angle) * d
    if (qx < RACKET_MIN || qx > RACKET_MAX || qy < RACKET_NEAR || qy > RACKET_FAR) continue
    if (Math.hypot(qx - start[0], qy - start[1]) <= budget) return true
  }
  return false
}
