const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateConnectionId(): string {
  let id = ''
  for (let i = 0; i < 7; i++) {
    id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]
  }
  return id
}
