import rateLimit from 'express-rate-limit'

// Broad limiter for the whole API. The 4s poll + markRead means a legit client
// makes well under this; anything above is abuse.
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 240,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too many requests — slow down' },
})

// Tight limiter for expensive / abusable endpoints: connection requests
// (code brute force), push subscribe, message reports.
export const strictLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too many requests — try again in a minute' },
})

// Link previews make the server fetch a third-party page; a chat shows a few
// links at a time, so 30 a minute per IP is plenty.
export const previewLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too many requests — try again in a minute' },
})

// Speech runs CPU models on a small shared service, so these are per signed-in
// user (mounted after requireAuth), not per IP.
const perUser = (limit: number) =>
  rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `user:${req.appUser!.id}`,
    message: { error: 'too many requests — try again in a minute', code: 'rate_limited' },
  })
export const narrationLimiter = perUser(30)
export const transcribeLimiter = perUser(10)
