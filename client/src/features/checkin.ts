import { openModal } from '../components/Modal'

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

// Composer: pick a mood, add one honest line. The mood picker is the
// permission-giver — it makes the honest line easier to send.
export function openCheckinComposer(opts: { onSend: (note: string, payload: CheckinPayload) => void }): void {
  const { onSend } = opts
  const container = document.createElement('div')
  container.className = 'checkin-compose'

  let mood: CheckinMood = 'okay'

  container.innerHTML = `
    <div class="msg-compose__title">How are you, really?</div>
    <div class="checkin-compose__picker"></div>
    <textarea id="checkin-note" class="msg-compose__field checkin-compose__note" rows="3" placeholder="Say a bit more..." maxlength="300"></textarea>
    <div class="msg-compose__actions">
      <button type="button" id="checkin-cancel">Cancel</button>
      <button type="button" id="checkin-send" class="primary">Send</button>
    </div>
  `
  const modal = openModal(container)
  const picker = container.querySelector<HTMLDivElement>('.checkin-compose__picker')!
  const noteEl = container.querySelector<HTMLTextAreaElement>('#checkin-note')!

  const renderPicker = (): void => {
    picker.innerHTML = ''
    for (const m of MOODS) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'checkin-mood-opt' + (m.id === mood ? ' checkin-mood-opt--active' : '')
      const emoji = document.createElement('span')
      emoji.textContent = m.emoji
      btn.append(emoji, document.createTextNode(m.label))
      btn.addEventListener('click', () => {
        mood = m.id
        renderPicker()
      })
      picker.append(btn)
    }
  }
  renderPicker()
  noteEl.focus()

  container.querySelector('#checkin-cancel')!.addEventListener('click', () => modal.close())
  container.querySelector('#checkin-send')!.addEventListener('click', () => {
    const note = noteEl.value.trim()
    if (!note) {
      noteEl.focus()
      return
    }
    onSend(note, { mood, note })
    modal.close()
  })
}
