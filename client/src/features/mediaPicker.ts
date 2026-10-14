import { openModal } from '../components/Modal'
import { getGifs, type Gif } from '../services/profileGifApi'
import { deleteSticker, loadStickers, mediaEpoch, saveSticker, type Sticker } from './stickerLibrary'
import { openStickerMaker } from './stickerMaker'

export function openMediaPicker(opts: { owner: string; onSticker: (sticker: Sticker) => void; onGif: (gif: Gif) => void }): () => void {
  const box = document.createElement('div'); box.className = 'media-picker'
  box.innerHTML = `<div class="media-picker__header"><div class="media-tabs" role="tablist" aria-label="Media"><button type="button" role="tab" aria-selected="true" data-tab="stickers">Stickers</button><button type="button" role="tab" aria-selected="false" data-tab="gifs">GIFs</button></div></div>
    <div data-stickers role="tabpanel" aria-label="Stickers"></div><div data-gifs role="tabpanel" aria-label="GIFs" hidden><input type="search" placeholder="Search GIFs" aria-label="Search GIFs" maxlength="120"/><div class="gif-grid"></div><button type="button" data-more hidden>Load more</button><p class="giphy-credit">Powered by GIPHY</p></div><p class="media-error" role="status"></p><input type="file" data-photo accept="image/jpeg,image/png,image/webp" hidden/>`
  let closed = false, tab = 'stickers', sequence = 0, offset: number | null = 0, timer: ReturnType<typeof setTimeout> | undefined, hold: ReturnType<typeof setTimeout> | undefined
  let maker: (() => void) | undefined, action: (() => void) | undefined
  const urls: string[] = [], start = mediaEpoch()
  const modal = openModal(box, { onClose: () => { closed = true; sequence++; clearTimeout(timer); clearTimeout(hold); maker?.(); action?.(); urls.forEach(URL.revokeObjectURL) } })
  modal.panel.setAttribute('aria-label', 'Stickers and GIFs')
  const stickers = box.querySelector<HTMLElement>('[data-stickers]')!, gifs = box.querySelector<HTMLElement>('[data-gifs]')!, error = box.querySelector<HTMLElement>('.media-error')!
  const input = gifs.querySelector<HTMLInputElement>('input')!, grid = gifs.querySelector<HTMLElement>('.gif-grid')!, more = gifs.querySelector<HTMLButtonElement>('[data-more]')!
  const photo = box.querySelector<HTMLInputElement>('[data-photo]')!
  const fail = (err: unknown): void => { if (!closed) error.textContent = err instanceof Error ? err.message : 'Could not load. Try again.' }
  const renderStickers = async (): Promise<void> => {
    try {
      const all = await loadStickers(opts.owner)
      if (closed || mediaEpoch() !== start) return
      urls.splice(0).forEach(URL.revokeObjectURL); stickers.replaceChildren(); error.textContent = ''
      const sections: [string, Sticker[]][] = [
        ['Favourites', all.filter((s) => s.favourite).sort((a, b) => b.created - a.created || a.id.localeCompare(b.id))],
        ['Recent', all.filter((s) => s.used).sort((a, b) => b.used - a.used || a.id.localeCompare(b.id)).slice(0, 16)],
        ['My stickers', all.filter((s) => !s.pack).sort((a, b) => b.created - a.created || a.id.localeCompare(b.id))],
        ...['Cats', 'IT', 'Life', 'Little signals', 'Nature', 'Shapes'].map((pack): [string, Sticker[]] => [pack, all.filter((s) => s.pack === pack).sort((a, b) => b.created - a.created || a.id.localeCompare(b.id))]),
      ]
      for (const [title, entries] of sections) {
        const heading = document.createElement('h3'); heading.textContent = title
        const tiles = document.createElement('div'); tiles.className = 'sticker-grid'; tiles.setAttribute('aria-label', title)
        if (title === 'My stickers') {
          const add = document.createElement('button'); add.type = 'button'; add.className = 'sticker-tile'; add.textContent = '+'; add.setAttribute('aria-label', 'Make a sticker')
          add.addEventListener('click', () => photo.click()); tiles.append(add)
        }
        for (const sticker of entries) {
          const tile = document.createElement('button'); tile.type = 'button'; tile.className = 'sticker-tile'; tile.setAttribute('aria-label', sticker.title); tile.title = sticker.title
          const img = new Image(); img.alt = ''; img.src = URL.createObjectURL(sticker.blob); urls.push(img.src); tile.append(img)
          let suppress = 0
          const menu = (): void => {
            suppress = Date.now() + 600; clearTimeout(hold)
            const actions = document.createElement('div'); actions.className = 'notice-popup'
            actions.innerHTML = '<h2>Sticker</h2><div class="report-dialog__actions"><button type="button" data-favourite></button><button type="button" data-delete class="danger">Delete</button><button type="button" data-cancel>Cancel</button></div><p class="media-error" role="status"></p>'
            const dialog = openModal(actions); action = dialog.close
            const favourite = actions.querySelector<HTMLButtonElement>('[data-favourite]')!
            favourite.textContent = sticker.favourite ? 'Unfavourite' : 'Favourite'
            favourite.addEventListener('click', async () => { favourite.disabled = true; try { await saveSticker({ ...sticker, favourite: !sticker.favourite }, start); dialog.close(); void renderStickers() } catch (err) { favourite.disabled = false; actions.querySelector('.media-error')!.textContent = err instanceof Error ? err.message : 'Could not save.' } })
            actions.querySelector('[data-cancel]')!.addEventListener('click', dialog.close)
            actions.querySelector<HTMLButtonElement>('[data-delete]')!.addEventListener('click', (e) => {
              const button = e.currentTarget as HTMLButtonElement
              if (button.dataset.confirm !== 'true') { button.dataset.confirm = 'true'; button.textContent = 'Confirm delete'; favourite.hidden = true; return }
              button.disabled = true
              void deleteSticker(opts.owner, sticker.id).then(() => { dialog.close(); void renderStickers() }).catch((err) => { button.disabled = false; actions.querySelector('.media-error')!.textContent = err instanceof Error ? err.message : 'Could not delete.' })
            })
          }
          tile.addEventListener('contextmenu', (e) => { e.preventDefault(); menu() })
          tile.addEventListener('pointerdown', () => { clearTimeout(hold); hold = setTimeout(menu, 500) })
          for (const event of ['pointerup', 'pointercancel', 'pointerleave']) tile.addEventListener(event, () => clearTimeout(hold))
          tile.addEventListener('keydown', (e) => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); menu() } })
          tile.addEventListener('click', () => { if (Date.now() < suppress) return; modal.close(); opts.onSticker(sticker); void saveSticker({ ...sticker, used: Date.now() }, start).catch(() => {}) })
          tiles.append(tile)
        }
        stickers.append(heading, tiles)
      }
    } catch (err) { fail(err) }
  }
  const loadGifs = async (append = false): Promise<void> => {
    const current = ++sequence, q = input.value.trim(), at = append ? offset : 0
    if (at === null) return
    more.disabled = true; error.textContent = 'Loading GIFs…'
    try {
      const page = await getGifs(q, at)
      if (closed || current !== sequence || tab !== 'gifs') return
      if (!append) grid.replaceChildren()
      for (const gif of page.results) {
        // The contract promises GIPHY HTTPS previews; reject an unexpected origin before rendering.
        let url: URL
        try { url = new URL(gif.previewUrl) } catch { continue }
        if (url.protocol !== 'https:' || !url.hostname.endsWith('.giphy.com')) continue
        const tile = document.createElement('button'); tile.type = 'button'; tile.setAttribute('aria-label', gif.title || 'Send GIF')
        const img = new Image(); img.src = url.href; img.alt = gif.title; img.loading = 'lazy'; tile.append(img)
        tile.addEventListener('click', () => { modal.close(); opts.onGif(gif) }); grid.append(tile)
      }
      offset = page.next; more.hidden = offset === null; error.textContent = page.results.length ? '' : 'No GIFs found.'
    } catch (err) { fail(err) }
    finally { if (current === sequence) more.disabled = false }
  }
  for (const button of box.querySelectorAll<HTMLButtonElement>('[data-tab]')) button.addEventListener('click', () => {
    tab = button.dataset.tab!; sequence++; clearTimeout(timer); error.textContent = ''
    stickers.hidden = tab !== 'stickers'; gifs.hidden = tab !== 'gifs'
    for (const b of box.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String((b as HTMLElement).dataset.tab === tab))
    if (tab === 'gifs') void loadGifs()
  })
  input.addEventListener('input', () => { sequence++; clearTimeout(timer); timer = setTimeout(() => void loadGifs(), 300) })
  more.addEventListener('click', () => void loadGifs(true))
  photo.addEventListener('change', () => { const file = photo.files?.[0]; photo.value = ''; if (file) maker = openStickerMaker(opts.owner, file, () => void renderStickers()) })
  void renderStickers()
  return modal.close
}
