import { openModal } from '../components/Modal'
import { showToast } from '../components/Toast'
import { deleteAccount } from '../services/meApi'
import { signOut } from '../services/authService'

// In-app account deletion (Google Play policy). Typed confirmation — the user
// types "delete" to arm the button — because this is irreversible: the backend
// removes the Supabase auth user and every connection, message and block
// cascades away. Report snapshots about the user are kept as moderation
// evidence (stated in the dialog).
export function openDeleteAccountDialog(): void {
  const box = document.createElement('div')
  box.className = 'notice-popup'
  box.innerHTML = `
    <div class="report-dialog__title">Delete your account?</div>
    <div class="report-dialog__text">
      This permanently deletes your account, your connection, and the whole
      conversation for both of you. It can't be undone. Reports filed about you
      are kept for safety review.
    </div>
    <div class="report-dialog__text">Type <strong>delete</strong> to confirm.</div>
    <input id="delete-confirm" class="msg-compose__field" autocomplete="off" placeholder="delete" />
    <div class="report-dialog__actions">
      <button type="button" id="delete-cancel">Cancel</button>
      <button type="button" id="delete-go" class="danger" disabled>Delete account</button>
    </div>
  `
  const modal = openModal(box)
  const input = box.querySelector<HTMLInputElement>('#delete-confirm')!
  const goBtn = box.querySelector<HTMLButtonElement>('#delete-go')!

  input.addEventListener('input', () => {
    goBtn.disabled = input.value.trim().toLowerCase() !== 'delete'
  })
  box.querySelector<HTMLButtonElement>('#delete-cancel')!.addEventListener('click', () => modal.close())

  goBtn.addEventListener('click', async () => {
    goBtn.disabled = true
    try {
      await deleteAccount()
      await signOut()
      location.assign('/')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete the account — try again.')
      goBtn.disabled = false
    }
  })
}
