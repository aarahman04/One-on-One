import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// Application-layer encryption at rest for message content/payload — Option C,
// see docs/DECISIONS-encryption-at-rest.md. AES-256-GCM with the key held only
// in the backend host env; it is never written to the DB or sent to the client,
// which is the whole point (a DB leak yields ciphertext, not message text).
//
// Envelope, stored as one string (e.g. in messages.content):
//   v{N}:{base64( iv[12] || tag[16] || ciphertext )}
// The v{N} tag names the key VERSION so keys can rotate without a flag day: new
// writes use the highest configured version; old ciphertext keeps decrypting as
// long as its version's key is still present (report snapshots pin old versions
// — see the retention constraint in the decision doc). GCM's auth tag gives
// tamper detection for free: decrypt throws if the bytes were altered.

const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32
const PREFIX = /^v(\d+):/

// Load every ENCRYPTION_KEY_V<n> from the env into a version->key map. Each is
// base64 of 32 random bytes; generate one with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
function loadKeys(): Map<number, Buffer> {
  const keys = new Map<number, Buffer>()
  for (const [name, value] of Object.entries(process.env)) {
    const m = /^ENCRYPTION_KEY_V(\d+)$/.exec(name)
    if (!m || !value) continue
    const key = Buffer.from(value, 'base64')
    if (key.length !== KEY_LEN) {
      throw new Error(`${name} must be base64 of ${KEY_LEN} bytes (decoded ${key.length})`)
    }
    keys.set(Number(m[1]), key)
  }
  return keys
}

// Fail fast on a misconfigured server (same stance as supabaseAdmin) — never
// silently fall back to storing plaintext, which would defeat encryption at rest.
const keys = loadKeys()
if (keys.size === 0) {
  throw new Error('missing ENCRYPTION_KEY_V1 (base64 of 32 bytes) — required for encryption at rest')
}
const currentVersion = Math.max(...keys.keys())

// True when a stored value is an encryption envelope (vs. a pre-backfill
// plaintext row). The rollout wiring uses this to pass legacy plaintext through
// until the Chunk 4 backfill converts every row; afterwards everything is tagged.
export function isEncrypted(value: string): boolean {
  return PREFIX.test(value)
}

export function encrypt(plaintext: string): string {
  const key = keys.get(currentVersion)!
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v${currentVersion}:${Buffer.concat([iv, tag, ct]).toString('base64')}`
}

export function decrypt(envelope: string): string {
  const m = PREFIX.exec(envelope)
  if (!m) throw new Error('not an encryption envelope')
  const version = Number(m[1])
  const key = keys.get(version)
  if (!key) throw new Error(`no key configured for encryption version v${version}`)
  const raw = Buffer.from(envelope.slice(m[0].length), 'base64')
  const iv = raw.subarray(0, IV_LEN)
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ct = raw.subarray(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}
