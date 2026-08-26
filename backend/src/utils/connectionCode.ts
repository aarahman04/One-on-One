const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateConnectionCode(): string {
  let code = ''
  for (let i = 0; i < 7; i++) {
    code += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]
  }
  return code
}
