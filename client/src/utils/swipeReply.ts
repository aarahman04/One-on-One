export function swipeClaim(dx: number, dy: number, mine: boolean, scrolling = false): 'wait' | 'scroll' | 'reply' {
  if (scrolling) return 'scroll'
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return 'wait'
  if (Math.abs(dx) <= 2 * Math.abs(dy) || (mine ? dx >= 0 : dx <= 0)) return 'scroll'
  return 'reply'
}

export function swipeOffset(dx: number, mine: boolean): number {
  const distance = Math.max(0, (mine ? -1 : 1) * dx)
  return (mine ? -1 : 1) * (distance <= 60 ? distance : Math.min(80, 60 + (distance - 60) * .25))
}
