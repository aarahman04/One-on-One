// Races a promise against a timeout so a hung network call can't leave the UI
// waiting forever. Rejects with an Error whose message is exactly 'timeout'
// so callers can distinguish it from a real failure.
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}
