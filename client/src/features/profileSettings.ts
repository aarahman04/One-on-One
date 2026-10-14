import { openModal } from '../components/Modal'
import { getAvatars, putAvatar, removeAvatar } from '../services/profileGifApi'
import { privatePhoto } from './stickerLibrary'
import { readPhoto } from './stickerMaker'

export function renderAvatar(el: HTMLElement, url: string | null, name: string): void {
  el.replaceChildren(document.createTextNode(Array.from(name.trim())[0]?.toUpperCase() ?? '?'))
  if (!url) return
  const image = new Image(); image.alt = ''; image.src = url
  image.addEventListener('error', () => { if (el.contains(image)) el.textContent = Array.from(name.trim())[0]?.toUpperCase() ?? '?' }, { once: true })
  el.replaceChildren(image)
}
export function openProfileSettings(owner: string, connectionId: string, onChanged: () => void): () => void {
  const box = document.createElement('div'); box.className = 'profile-settings'
  box.innerHTML = `<h2>Settings</h2><h3>Your profile photo</h3><div class="profile-settings__avatar"></div><div class="report-dialog__actions"><button type="button" data-pick="mine">Upload photo</button><button type="button" data-remove="mine">Remove photo</button></div><h3>Private partner photo</h3><p>Only in this browser. Takes priority over their profile photo.</p><div class="report-dialog__actions"><button type="button" data-pick="other">Choose photo</button><button type="button" data-remove="other">Remove private photo</button></div><p class="media-error" role="status"></p><button type="button" data-close>Done</button><input type="file" accept="image/jpeg,image/png,image/webp" hidden/>`
  let closed = false, target = 'mine'
  const modal = openModal(box, { onClose: () => { closed = true } }); modal.panel.setAttribute('aria-label', 'Profile settings')
  const input = box.querySelector<HTMLInputElement>('input')!, error = box.querySelector<HTMLElement>('.media-error')!
  const load = async (): Promise<void> => {
    const [avatars, photo] = await Promise.all([getAvatars(), privatePhoto(owner, connectionId)])
    if (closed) return
    renderAvatar(box.querySelector('.profile-settings__avatar')!, avatars.mine, 'You')
    box.querySelector<HTMLButtonElement>('[data-remove="mine"]')!.disabled = !avatars.mine
    box.querySelector<HTMLButtonElement>('[data-remove="other"]')!.disabled = !photo
  }
  const action = async (run: () => Promise<unknown>): Promise<void> => {
    const buttons = box.querySelectorAll<HTMLButtonElement>('[data-pick], [data-remove]')
    buttons.forEach((b) => { b.disabled = true }); error.textContent = ''
    try { await run(); if (closed) return; onChanged(); await load() }
    catch (err) { if (!closed) error.textContent = err instanceof Error ? err.message : 'Could not update photo.' }
    finally { if (!closed) buttons.forEach((b) => { b.disabled = false }) }
  }
  for (const button of box.querySelectorAll<HTMLButtonElement>('[data-pick]')) button.addEventListener('click', () => { target = button.dataset.pick!; input.click() })
  box.querySelector('[data-remove="mine"]')!.addEventListener('click', () => void action(removeAvatar))
  box.querySelector('[data-remove="other"]')!.addEventListener('click', () => void action(() => privatePhoto(owner, connectionId, null)))
  input.addEventListener('change', () => {
    const file = input.files?.[0]; input.value = ''; if (!file) return
    void action(async () => {
      const canvas = await readPhoto(file), blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .85))
      if (!blob || blob.size > 2 * 1024 * 1024) throw new Error('Choose a smaller photo (maximum 2 MB).')
      if (closed) return
      if (target === 'mine') await putAvatar(blob)
      else await privatePhoto(owner, connectionId, blob)
    })
  })
  box.querySelector('[data-close]')!.addEventListener('click', modal.close)
  void load().catch((err) => { if (!closed) error.textContent = err instanceof Error ? err.message : 'Could not load photos.' })
  return modal.close
}
