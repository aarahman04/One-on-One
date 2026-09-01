// Slash-command system: type "/" in the composer to get a drop-up menu.
// Adding a command is a one-liner in COMMANDS below (groundwork for more later).

export interface SlashContext {
  input: HTMLTextAreaElement
  writeLetter: () => void
  writeCountdown: () => void
  writeCheckin: () => void
  writeAsk: () => void
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

// Curated prompts for /daily — deliberately specific to two people who already
// know each other, not generic icebreakers. Picked deterministically by day of
// year so both partners land on the same prompt if they both reach for it.
const DAILY_PROMPTS: string[] = [
  "What's a small thing I did this week that you noticed?",
  'What moment today would you want to live in a little longer?',
  "What's something about me that took you time to learn to love?",
  "What are you looking forward to that we haven't talked about?",
  'What did you almost text me earlier but didn’t?',
  "What's a memory of us you replayed recently?",
  'What do you need more of from me this week?',
  "What's something you're proud of that you haven't said out loud?",
  'What made you laugh today, even a little?',
  "What's on your mind that you keep putting off saying?",
  'What do you wish I asked you more often?',
  "What's a version of the future with me you thought about recently?",
]

function dailyPrompt(): string {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000)
  return DAILY_PROMPTS[dayOfYear % DAILY_PROMPTS.length]
}

const COMMANDS: SlashCommand[] = [
  { name: 'letter', description: 'Write a letter', run: (ctx) => { ctx.input.value = ''; ctx.writeLetter() } },
  { name: 'daily', description: 'Question of the day', run: (ctx) => insert(ctx, dailyPrompt()) },
  { name: 'countdown', description: 'Start a shared countdown', run: (ctx) => { ctx.input.value = ''; ctx.writeCountdown() } },
  { name: 'checkin', description: 'How are you, really?', run: (ctx) => { ctx.input.value = ''; ctx.writeCheckin() } },
  { name: 'ask', description: 'A sealed question, revealed together', run: (ctx) => { ctx.input.value = ''; ctx.writeAsk() } },
]

// Exact "/command" match. Backs `runIfCommand`, which ChatPage's form-submit
// handler calls so a mobile soft keyboard's Send/Go key (which never fires a
// catchable Enter keydown) still opens the command instead of sending the
// literal "/letter" text.
function matchCommand(value: string): SlashCommand | undefined {
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
