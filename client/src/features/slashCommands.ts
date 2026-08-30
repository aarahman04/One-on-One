// Slash-command system: type "/" in the composer to get a drop-up menu.
// Adding a command is a one-liner in COMMANDS below (groundwork for more later).

export interface SlashContext {
  input: HTMLTextAreaElement
  writeLetter: () => void
}

interface SlashCommand {
  name: string
  description: string
  run: (ctx: SlashContext) => void
}

const insert = (ctx: SlashContext, text: string): void => {
  // Replace only the leading "/token", keep anything else already typed, and
  // fire an input event so the composer's autoGrow (and the slash menu) update.
  ctx.input.value = ctx.input.value.replace(/^\/\S*/, text)
  ctx.input.dispatchEvent(new Event('input', { bubbles: true }))
  ctx.input.focus()
}

const COMMANDS: SlashCommand[] = [
  { name: 'letter', description: 'Write a letter', run: (ctx) => { ctx.input.value = ''; ctx.writeLetter() } },
  { name: 'shrug', description: '¯\\_(ツ)_/¯', run: (ctx) => insert(ctx, '¯\\_(ツ)_/¯') },
  { name: 'flip', description: '(╯°□°)╯︵ ┻━┻', run: (ctx) => insert(ctx, '(╯°□°)╯︵ ┻━┻') },
]

// Exact "/command" match. Backs `runIfCommand`, which ChatPage's form-submit
// handler calls so a mobile soft keyboard's Send/Go key (which never fires a
// catchable Enter keydown) still opens the command instead of sending the
// literal "/letter" text.
export function matchCommand(value: string): SlashCommand | undefined {
  const v = value.trim()
  if (!v.startsWith('/')) return undefined
  const name = v.slice(1).toLowerCase()
  return COMMANDS.find((c) => c.name === name)
}

export function runIfCommand(value: string, ctx: SlashContext): boolean {
  const cmd = matchCommand(value)
  if (!cmd) return false
  cmd.run(ctx)
  return true
}

// Wires the composer input to a drop-up menu. Returns nothing; self-manages.
export function mountSlashCommands(composer: HTMLElement, input: HTMLTextAreaElement, ctx: SlashContext): void {
  let menu: HTMLElement | null = null
  let filtered: SlashCommand[] = []
  let active = 0

  const hide = (): void => {
    menu?.remove()
    menu = null
  }

  const run = (cmd: SlashCommand | undefined): void => {
    if (!cmd) return
    hide()
    cmd.run(ctx)
  }

  const render = (): void => {
    const val = input.value
    if (!val.startsWith('/')) {
      hide()
      return
    }
    const q = val.slice(1).toLowerCase()
    filtered = COMMANDS.filter((c) => c.name.startsWith(q))
    if (!filtered.length) {
      hide()
      return
    }
    if (active >= filtered.length) active = filtered.length - 1
    if (active < 0) active = 0

    if (!menu) {
      menu = document.createElement('div')
      menu.className = 'slash-menu'
      composer.append(menu)
    }
    menu.innerHTML = ''
    filtered.forEach((c, i) => {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'slash-item' + (i === active ? ' slash-item--active' : '')
      const name = document.createElement('span')
      name.className = 'slash-item__name'
      name.textContent = `/${c.name}`
      const desc = document.createElement('span')
      desc.className = 'slash-item__desc'
      desc.textContent = c.description
      item.append(name, desc)
      item.addEventListener('click', () => run(c))
      menu!.append(item)
    })
  }

  input.addEventListener('input', render)
  input.addEventListener('keydown', (e) => {
    if (!menu) return
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      active = (active - 1 + filtered.length) % filtered.length
      render()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      active = (active + 1) % filtered.length
      render()
    } else if (e.key === 'Enter') {
      // Take Enter before the composer's submit handler AND ChatPage's own
      // desktop enter-to-send listener (also bound to this element) run.
      e.preventDefault()
      e.stopImmediatePropagation()
      run(filtered[active])
    } else if (e.key === 'Escape') {
      hide()
    }
  })
}
