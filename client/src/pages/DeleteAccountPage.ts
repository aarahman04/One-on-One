import type { Page } from '../state/router'
import { legalShell, wireLegalBack } from './legalShared'
import { getSession, signOut } from '../services/authService'
import { deleteAccount } from '../services/meApi'
import { showToast } from '../components/Toast'

// Public account-deletion page (Google Play policy: deletion must be reachable
// from an external web page, not only in-app). Signed in → run the same delete
// flow as the in-app dialog. Signed out → explain and offer sign-in.

const WHAT_HAPPENS = `
  <p>Deleting your account permanently removes:</p>
  <ul>
    <li>your sign-in record and app profile;</li>
    <li>your current connection and the entire conversation &mdash; messages,
      photos, voice notes, files, reactions and call records &mdash; for both
      people;</li>
    <li>your blocks and push subscriptions.</li>
  </ul>
  <p>Reports filed about you are kept as safety evidence, with the link to your
  account cleared. Deletion cannot be undone.</p>
`

const signedInBody = `
  ${WHAT_HAPPENS}
  <p>Type <strong>delete</strong> below to confirm.</p>
  <p>
    <input id="da-confirm" autocomplete="off" placeholder="delete"
      style="font: inherit; padding: 8px 10px; min-width: 160px;" />
  </p>
  <p>
    <button type="button" id="da-go" class="danger" disabled>Delete my account</button>
  </p>
`

const signedOutBody = `
  ${WHAT_HAPPENS}
  <p>You need to be signed in to delete your account.</p>
  <p><button type="button" id="da-signin" class="primary">Sign in to delete</button></p>
`

export const DeleteAccountPage: Page = (root) => {
  root.innerHTML = legalShell(
    'Delete your account',
    `<div id="da-body"><p class="legal__meta">Checking your sign-in status&hellip;</p></div>`,
  )
  const cleanupBack = wireLegalBack(root)
  const body = root.querySelector<HTMLDivElement>('#da-body')!
  let disposed = false

  void getSession().then((session) => {
    if (disposed) return
    body.innerHTML = session ? signedInBody : signedOutBody

    if (!session) {
      body.querySelector<HTMLButtonElement>('#da-signin')!.addEventListener('click', () => {
        window.location.assign('/')
      })
      return
    }

    const input = body.querySelector<HTMLInputElement>('#da-confirm')!
    const goBtn = body.querySelector<HTMLButtonElement>('#da-go')!
    input.addEventListener('input', () => {
      goBtn.disabled = input.value.trim().toLowerCase() !== 'delete'
    })
    goBtn.addEventListener('click', async () => {
      goBtn.disabled = true
      try {
        await deleteAccount()
        await signOut()
        window.location.assign('/')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not delete the account — try again.')
        goBtn.disabled = false
      }
    })
  })

  return () => {
    disposed = true
    cleanupBack()
  }
}
