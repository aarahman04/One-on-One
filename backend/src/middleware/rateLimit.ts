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

// Daily ceilings that keep the speech service's usage (and Railway bill)
// bounded even if every per-minute window is used: per user, and one shared
// budget across all users. Env-tunable; in-memory like the limiters above.
const daily = (limit: number, key: (req: import('express').Request) => string) =>
  rateLimit({
    windowMs: 24 * 60 * 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: key,
    message: { error: 'daily speech limit reached — try again tomorrow', code: 'quota_exceeded' },
  })
const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name])
  return Number.isSafeInteger(n) && n > 0 ? n : fallback
}
export const narrationDailyLimiter = daily(envInt('SPEECH_NARRATION_PARTS_PER_USER_DAY', 200), (req) => `narration-day:${req.appUser!.id}`)
export const transcribeDailyLimiter = daily(envInt('SPEECH_TRANSCRIPTIONS_PER_USER_DAY', 60), (req) => `transcribe-day:${req.appUser!.id}`)
export const speechGlobalDailyLimiter = daily(envInt('SPEECH_REQUESTS_PER_DAY', 200), () => 'speech-day:all')
