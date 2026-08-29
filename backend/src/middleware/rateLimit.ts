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
