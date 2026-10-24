/** 64 samples/s (16 ms client cadence) plus bounded capacity for coalesced releases/jitter. */
export function paddleLimit(now: () => number = () => performance.now()): () => boolean {
  let tokens = 96, last = now()
  return () => {
    const at = now()
    tokens = Math.min(96, tokens + Math.max(0, at - last) * .064); last = at
    if (tokens < 1) return false
    tokens--
    return true
  }
}
