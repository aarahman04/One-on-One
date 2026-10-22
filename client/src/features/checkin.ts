export type CheckinMood = 'great' | 'good' | 'okay' | 'down' | 'struggling'

export interface CheckinPayload {
  mood: CheckinMood
  note: string
}

const MOODS: { id: CheckinMood; label: string; emoji: string }[] = [
  { id: 'great', label: 'Great', emoji: '😄' },
  { id: 'good', label: 'Good', emoji: '🙂' },
  { id: 'okay', label: 'Okay', emoji: '😐' },
  { id: 'down', label: 'Down', emoji: '😔' },
  { id: 'struggling', label: 'Struggling', emoji: '😞' },
]

export function moodEmoji(mood: string): string {
  return MOODS.find((m) => m.id === mood)?.emoji ?? '🙂'
}
