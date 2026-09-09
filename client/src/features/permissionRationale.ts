import { openModal } from '../components/Modal'

// Prominent in-app explanation shown BEFORE the browser's own camera / mic /
// notification permission prompt (Google Play permissions policy). Mirrors the
// pattern openLocationConfirm already uses for /location. Shown at most once
// per kind per session — after that the browser's own prompt (or an
// already-granted permission) stands on its own.

export type PermissionKind = 'microphone' | 'camera' | 'notifications'

const shown = new Set<PermissionKind>()

const COPY: Record<PermissionKind, { title: string; body: string; cta: string }> = {
  microphone: {
    title: 'Microphone access',
    body: 'The next prompt asks to use your microphone. One on One needs it to record voice notes and to carry your voice on a call. Audio is sent only to the person you are connected with — never recorded or stored on our side.',
    cta: 'Continue',
  },
  camera: {
    title: 'Camera access',
    body: 'The next prompt asks to use your camera. One on One needs it for video calls. Video goes directly to the person you are connected with — it is never recorded or stored.',
    cta: 'Continue',
  },
  notifications: {
    title: 'Notifications',
    body: 'The next prompt asks to send notifications. One on One uses them only to tell you a message or call arrived while the app was closed. Nothing else.',
    cta: 'Continue',
  },
}

export function ensurePermissionRationale(kind: PermissionKind): Promise<boolean> {
  if (shown.has(kind)) return Promise.resolve(true)

  return new Promise((resolve) => {
    let proceeded = false
    const copy = COPY[kind]

    const box = document.createElement('div')
    box.className = 'notice-popup'
    box.innerHTML = `
      <div class="report-dialog__title"></div>
      <p class="report-dialog__text"></p>
      <div class="report-dialog__actions">
        <button type="button" id="perm-cancel">Not now</button>
        <button type="button" id="perm-go" class="primary"></button>
      </div>
    `
    box.querySelector('.report-dialog__title')!.textContent = copy.title
    box.querySelector('.report-dialog__text')!.textContent = copy.body
    box.querySelector('#perm-go')!.textContent = copy.cta

    const modal = openModal(box, {
      onClose: () => resolve(proceeded),
    })
    box.querySelector<HTMLButtonElement>('#perm-cancel')!.addEventListener('click', () => modal.close())
    box.querySelector<HTMLButtonElement>('#perm-go')!.addEventListener('click', () => {
      proceeded = true
      shown.add(kind)
      modal.close()
    })
  })
}
