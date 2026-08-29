import { randomInt } from 'node:crypto'

// Ambiguous characters (0/O, 1/I) omitted.
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8

// The connection code is a capability token (anyone holding it can send you a
// request), so it must be unpredictable — a CSPRNG, not Math.random().
export function generateConnectionCode(): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ID_CHARS[randomInt(ID_CHARS.length)]
  }
  return code
}
