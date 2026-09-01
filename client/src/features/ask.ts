import { openModal } from '../components/Modal'

export interface AskPayload {
  question: string
  answerA: string
  answerB?: string
}

// Composer: the sender writes a question AND seals their own answer in the
// same step — the recipient won't see either answer until they answer too.
export function openAskComposer(opts: { onSend: (question: string, payload: { question: string; answerA: string }) => void }): void {
  const { onSend } = opts
  const container = document.createElement('div')
  container.className = 'ask-compose'
  container.innerHTML = `
    <div class="msg-compose__title">Ask a sealed question</div>
    <input id="ask-question" class="msg-compose__field" placeholder="What do you want to ask?" maxlength="300" />
    <textarea id="ask-answer" class="msg-compose__field ask-compose__answer" rows="3" placeholder="Your own answer — sealed until they answer too" maxlength="500"></textarea>
    <div class="msg-compose__actions">
      <button type="button" id="ask-cancel">Cancel</button>
      <button type="button" id="ask-send" class="primary">Send, sealed</button>
    </div>
  `
  const modal = openModal(container)
  const qEl = container.querySelector<HTMLInputElement>('#ask-question')!
  const aEl = container.querySelector<HTMLTextAreaElement>('#ask-answer')!
  qEl.focus()

  container.querySelector('#ask-cancel')!.addEventListener('click', () => modal.close())
  container.querySelector('#ask-send')!.addEventListener('click', () => {
    const question = qEl.value.trim()
    const answerA = aEl.value.trim()
    if (!question) {
      qEl.focus()
      return
    }
    if (!answerA) {
      aEl.focus()
      return
    }
    onSend(question, { question, answerA })
    modal.close()
  })
}

// Answer modal: the recipient sees only the question — never the sealed
// answer — and submits their own. Sending it reveals both at once.
export function openAskAnswerModal(opts: { question: string; onAnswer: (answerB: string) => void }): void {
  const { question, onAnswer } = opts
  const container = document.createElement('div')
  container.className = 'ask-compose'
  container.innerHTML = `
    <div class="msg-compose__title" id="ask-answer-title"></div>
    <textarea id="ask-answerb" class="msg-compose__field ask-compose__answer" rows="3" placeholder="Your answer — sends and reveals both" maxlength="500"></textarea>
    <div class="msg-compose__actions">
      <button type="button" id="ask-answerb-cancel">Cancel</button>
      <button type="button" id="ask-answerb-send" class="primary">Answer &amp; reveal</button>
    </div>
  `
  // Set separately (not interpolated into the innerHTML above) so a question
  // containing markup-like characters can never be parsed as markup.
  container.querySelector<HTMLDivElement>('#ask-answer-title')!.textContent = question

  const modal = openModal(container)
  const bEl = container.querySelector<HTMLTextAreaElement>('#ask-answerb')!
  bEl.focus()

  container.querySelector('#ask-answerb-cancel')!.addEventListener('click', () => modal.close())
  container.querySelector('#ask-answerb-send')!.addEventListener('click', () => {
    const answerB = bEl.value.trim()
    if (!answerB) {
      bEl.focus()
      return
    }
    onAnswer(answerB)
    modal.close()
  })
}
