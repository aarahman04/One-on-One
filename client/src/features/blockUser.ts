import { openModal } from '../components/Modal'
import { showToast } from '../components/Toast'
import { blockAndEnd } from '../services/connectionsApi'

// "Block & end" (Google Play UGC safety). Unlike the deliberate 5-step leave,
// a block is immediate and permanent: the connection ends now and the pair can
// never send each other a request again. Backend-enforced — see blockService.
export function openBlockConfirm(opts: { connectionId: string; peerName: string; onBlocked: () => void }): void {
  const { connectionId, peerName, onBlocked } = opts

  const box = document.createElement('div')
  box.className = 'notice-popup'
  box.innerHTML = `
    <div class="report-dialog__title">Block and end this connection?</div>
    <p class="report-dialog__text"></p>
    <div class="report-dialog__actions">
      <button type="button" id="block-cancel">Cancel</button>
      <button type="button" id="block-go" class="danger">Block &amp; end</button>
    </div>
  `
  box.querySelector('.report-dialog__text')!.textContent =
    `This ends the conversation right now — no countdown — and deletes it for both of you. ${peerName} will never be able to reconnect with you.`

  const modal = openModal(box)
  box.querySelector<HTMLButtonElement>('#block-cancel')!.addEventListener('click', () => modal.close())

  const goBtn = box.querySelector<HTMLButtonElement>('#block-go')!
  goBtn.addEventListener('click', async () => {
    goBtn.disabled = true
    try {
      await blockAndEnd(connectionId)
      modal.close()
      onBlocked()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not block — try again.')
      goBtn.disabled = false
    }
  })
}
