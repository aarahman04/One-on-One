import { openModal } from '../components/Modal'

export type ThisOrThatPick = 'a' | 'b'

export interface ThisOrThatPayload {
  optionA: string
  optionB: string
  pickSender: ThisOrThatPick
  pickRecipient?: ThisOrThatPick
}

// Composer: the sender writes both options AND picks their own favorite in
// the same step — mirrors /ask's seal-your-own-answer-first pattern. The
// recipient won't see the sender's pick until they pick too.
export function openThisOrThatComposer(opts: {
  onSend: (content: string, payload: { optionA: string; optionB: string; pickSender: ThisOrThatPick }) => void
}): void {
  const { onSend } = opts
  const container = document.createElement('div')
  container.className = 'thisorthat-compose'
  container.innerHTML = `
    <div class="msg-compose__title">This or that?</div>
    <input id="thisorthat-a" class="msg-compose__field" placeholder="Option A" maxlength="100" />
    <input id="thisorthat-b" class="msg-compose__field" placeholder="Option B" maxlength="100" />
    <div class="thisorthat-compose__picker"></div>
    <div class="msg-compose__actions">
      <button type="button" id="thisorthat-cancel">Cancel</button>
      <button type="button" id="thisorthat-send" class="primary">Send, sealed</button>
    </div>
  `
  const modal = openModal(container)
  const aEl = container.querySelector<HTMLInputElement>('#thisorthat-a')!
  const bEl = container.querySelector<HTMLInputElement>('#thisorthat-b')!
  const picker = container.querySelector<HTMLDivElement>('.thisorthat-compose__picker')!
  aEl.focus()

  let pickSender: ThisOrThatPick = 'a'

  const renderPicker = (): void => {
    picker.innerHTML = ''
    const options: { id: ThisOrThatPick; label: string }[] = [
      { id: 'a', label: aEl.value.trim() || 'Option A' },
      { id: 'b', label: bEl.value.trim() || 'Option B' },
    ]
    for (const o of options) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'thisorthat-pick-opt' + (o.id === pickSender ? ' thisorthat-pick-opt--active' : '')
      btn.textContent = o.label
      btn.setAttribute('aria-pressed', String(o.id === pickSender))
      btn.addEventListener('click', () => {
        pickSender = o.id
        renderPicker()
      })
      if (o.id === 'b') { const or = document.createElement('span'); or.className = 'thisorthat-card__vs'; or.textContent = 'or'; picker.append(or) }
      picker.append(btn)
    }
  }
  renderPicker()
  aEl.addEventListener('input', renderPicker)
  bEl.addEventListener('input', renderPicker)

  container.querySelector('#thisorthat-cancel')!.addEventListener('click', () => modal.close())
  container.querySelector('#thisorthat-send')!.addEventListener('click', () => {
    const optionA = aEl.value.trim()
    const optionB = bEl.value.trim()
    if (!optionA) {
      aEl.focus()
      return
    }
    if (!optionB) {
      bEl.focus()
      return
    }
    onSend(`${optionA} vs ${optionB}`, { optionA, optionB, pickSender })
    modal.close()
  })
}
