import { openModal } from '../components/Modal'
import { showToast } from '../components/Toast'

export function openEmojiPicker(onPick: (emoji: string) => void, onClose: () => void): () => void {
  const box = document.createElement('div')
  box.className = 'emoji-dialog'
  const heading = document.createElement('h2')
  heading.textContent = 'Choose a reaction'
  heading.id = 'emoji-picker-title'
  const search = document.createElement('input')
  search.type = 'search'
  search.placeholder = 'Search emoji…'
  search.setAttribute('aria-label', 'Search emoji')
  const category = document.createElement('select')
  category.setAttribute('aria-label', 'Emoji category')
  const grid = document.createElement('div')
  grid.className = 'emoji-dialog__grid'
  grid.setAttribute('aria-label', 'Emoji')
  box.append(heading, search, category, grid)
  let closed = false
  const modal = openModal(box, { onClose: () => { closed = true; onClose() } })
  modal.panel.setAttribute('aria-labelledby', heading.id)
  void import('./emojiData').then(({ default: groups }) => {
    if (closed) return
    let recents: string[] = []
    try { recents = JSON.parse(localStorage.getItem('reactionRecents') ?? '[]') } catch { /* private mode */ }
    const all = groups.flatMap((g) => g.emoji)
    recents = Array.isArray(recents) ? recents.filter((e) => all.some(([emoji]) => emoji === e)).slice(0, 24) : []
    for (const name of ['Recent', ...groups.map((g) => g.name)]) category.add(new Option(name, name))
    category.value = recents.length ? 'Recent' : groups[0].name
    const render = (): void => {
      grid.replaceChildren()
      const query = search.value.trim().toLowerCase()
      const entries = query ? all.filter(([emoji, name]) => name.includes(query) || emoji === query) :
        category.value === 'Recent' ? all.filter(([emoji]) => recents.includes(emoji)).sort((a, b) => recents.indexOf(a[0]) - recents.indexOf(b[0])) :
        groups.find((g) => g.name === category.value)?.emoji ?? []
      const fragment = document.createDocumentFragment()
      for (const [emoji, name] of entries) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = emoji
        button.title = name
        button.setAttribute('aria-label', name)
        button.addEventListener('click', () => {
          try { localStorage.setItem('reactionRecents', JSON.stringify([emoji, ...recents.filter((e) => e !== emoji)].slice(0, 24))) } catch { /* private mode */ }
          onPick(emoji)
          modal.close()
        })
        fragment.append(button)
      }
      if (!entries.length) fragment.append(document.createTextNode(query ? 'No emoji found.' : 'Your recent reactions will appear here.'))
      grid.append(fragment)
      grid.scrollTop = 0
    }
    search.addEventListener('input', render)
    category.addEventListener('change', render)
    render()
  }).catch(() => { if (!closed) { showToast('Could not open the emoji picker. Try again.'); modal.close() } })
  return modal.close
}
