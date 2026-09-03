// Shared "loading" skeleton for pages that fetch before they have anything
// to render (nickname, chat, connection request, export, leave) — a small
// spinner instead of a bare line of text, consistent across the app.
export function loadingScreenHtml(): string {
  return `<div class="screen"><div class="screen__loading"><svg class="screen__spinner" width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="40 56.5"/></svg>Loading…</div></div>`
}
