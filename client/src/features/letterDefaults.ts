export const letterFromDefault = (nickname?: string | null, signature?: string | null): string =>
  (nickname?.trim() || signature?.trim() || 'me').slice(0, 40)
