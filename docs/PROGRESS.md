# Progress Log

One entry per completed part. Newest at top. Format:

```
## [Phase.Stage.Part] Title — YYYY-MM-DD
Status: done | in-progress | blocked
What shipped:
Notes/deviations:
```

---

## [Emergency] /alarm command — 2026-09-02
Status: done. PR #40 merged to `main` (3 commits: message type/validation/push
plumbing, controller + confirm dialog + slash wiring, renderer + live
trigger + glow + ack flow). Migration 027 applied to the live DB.
What shipped: dedicated `alarm` message type (raise = empty payload; an
acknowledgement is a separate reply-linked alarm message with `{ack:<id>}` —
same raise/reply shape as `/ask` and `/thisorthat`, no message-mutation path).
Confirm-before-send dialog; per-user 3min cooldown on raises (acks exempt).
In-app alert while the tab is open: looping synthesized siren
(`client/public/alarm.wav`) + repeating `navigator.vibrate` + a pulsing red
inset glow on the chat screen (`.chat--alarm`). Hybrid clear: focusing/
opening the chat stops the sound/vibration; the glow persists until the
recipient taps Acknowledge or a 2min no-ack auto-clear. Reopening the chat
with the most recent alarm-type message still an unacknowledged raise resumes
the glow (and sound, if it's the other side's). Push fallback for a closed/
backgrounded app sets `requireInteraction`+`vibrate`+`renotify` on Android via
an `urgent` flag threaded through `syncDelivery` → `PushPayload` → `sw.js`.
Notes/deviations: **No platform lets a PWA bypass OS Do Not Disturb** —
`urgent` push is still an ordinary, OS-mediated notification. **iOS PWA push
ignores `vibrate` and cannot play a custom sound at all** (same restriction as
the pre-existing iOS notification-parity gap above); Android push vibration
is OS-driven from the notification's `vibrate` option, not app JS. **The
custom alarm sound is reliable only while the tab is open and foregrounded —
confirmed, not fixable within web-platform limits.** Investigated a report of
the sound "sometimes" not playing when the recipient's phone was
backgrounded/locked: root cause is mobile browsers throttling or fully
suspending a hidden tab's timers/audio and potentially dropping its WebSocket
during that window, combined with autoplay engagement policy — none of which
a web page can query or override, and none of which affects vibration/glow
(vibration felt while backgrounded is the OS-driven push `vibrate`, not the
in-page controller; the glow is only ever seen once the app is reopened,
whether via the live socket path or the history-resume-on-load scan). No
code fix exists for this; `audio.play()` rejections are now logged
(`console.warn`) so a future *regression* stays distinguishable from this
expected inconsistency. This was investigated via code/platform-behavior
analysis, not reproduced on a physical backgrounded device.

## [Security] Message encryption at rest (Option C) — 2026-09-02
Status: code complete on branch `feat/message-encryption-at-rest` (4 commits);
all `tsc` clean, crypto/wiring/backfill logic verified with throwaway scripts.
**Live steps pending (user-owned):** manual two-account Chunk 3 pass → deploy →
backfill dry-run → `--apply`. PR held until the backfill is confirmed clean.
What shipped (application-layer AES-256-GCM, key only in backend env — full
rationale in `docs/DECISIONS-encryption-at-rest.md`):
- **Chunk 1** migration 026 — drops the plaintext `char_length(content)` check
  so `content` can hold ciphertext; `content`/`payload` column types unchanged.
  Applied + verified on the live DB.
- **Chunk 2** `backend/src/services/crypto.ts` — `encrypt`/`decrypt`/
  `isEncrypted`, envelope `v{N}:base64(iv|tag|ct)`, version-tagged for rotation
  (highest `ENCRYPTION_KEY_V<n>` = write key), GCM tamper detection, fails fast
  if unconfigured. Documented in `.env.example`.
- **Chunk 3** wiring — `saveMessage` encrypts `content` + `payload` (jsonb
  `{enc}`) on write and returns the in-memory plaintext `Message`, so socket
  broadcast + push preview are unchanged; `getHistory` decrypts on read with
  legacy-plaintext passthrough. `reportService` snapshot stores ciphertext
  verbatim (decrypt-on-review), no logic change.
- **Chunk 4** `backend/src/database/backfillEncryption.ts` (`npm run
  backfill:encrypt`) — one-off, dry-run by default, `--apply` to write,
  idempotent; covers `messages` + `message_reports` snapshots.
Notes/deviations: Protects a DB leak (logical dump / stolen service-role key /
backup), NOT a full backend compromise — same trust boundary as before, strictly
more protection; **not E2EE, don't overclaim**. Backend-reads-plaintext model
preserved (spec §20) — every membership/live/reply-target/media-path check is
unchanged. Two documented, accepted plaintext gaps: **push previews**
(`mediaNoticeFor` sends up to 120 chars of a text message post-decrypt) and
**attachment bytes** (Storage disk-at-rest only; app-layer would break
signed-URL delivery — only attachment *metadata* in `payload` is encrypted).
Rotation constraint: never destroy a key version while a report snapshot still
references it. A subtle "encrypted at rest" UI indicator is proposed separately,
held for sign-off.

## [UI/UX fixes batch] Dark theme, viewport zoom, footer regression, send button, logout, /thisorthat — 2026-09-01
Status: code complete; client (`tsc`/`vite build`) and backend (`tsc`) both
build clean. Migration 025 written but **not yet applied to the live DB**
(this batch adds no auto-migrate hook — same manual step as 024). Several
items are visually inspectable directly; two are flagged below for a manual
mobile/two-account pass (Chrome extension unavailable this session).
What shipped, in commit order:
- **Dark-theme CSS fixes** — added a global `textarea{}` rule mirroring the
  existing `input{}` one (fixed white background on the `/checkin` note and
  `/ask` answer fields — both are textareas, which had no dark rule of their
  own). `.chat__reaction-badge` background → `transparent` (was
  `var(--bg-raised)`, read as solid black). `.chat--bubbles
  .chat__receipt--seen` → `var(--accent-you)` (light green) — **scoped to the
  plain text/voice/file bubble only**; the image-overlay tick and Love-
  wallpaper tick keep their own already-correct colors for their own
  (non-blue) backgrounds, left untouched. `.voice-bubble__play` gets
  `padding: 0` (was inheriting the base button's `10px 18px`, forcing an
  oval) and its `▶`/`⏸` text glyphs became small centered inline SVGs.
- **Mobile zoom-on-focus fix** — `.checkin-compose__note` and
  `.ask-compose__answer` set `font-size: 14px` outside the existing
  `@media(max-width:480px)` zoom-prevention rule, later in source order, so
  equal-specificity tie-breaking always favored the 14px rule. Added
  compound-class selectors (`.msg-compose__field.checkin-compose__note` /
  `.msg-compose__field.ask-compose__answer`, matching the real two-class DOM)
  inside that media rule for guaranteed higher specificity — same fix
  already applied once for `.chat__input-bar textarea`.
- **Bubble footer regression fix** — `.chat__bubble-time` is `display: none`
  at the base (line mode has its own left-column clock); the `.chat--bubbles`
  override only set color/size and never restored `display`, so the
  per-bubble timestamp never rendered. Separately, the previous batch's
  float-based footer (`.chat__meta` floated right *inside*
  `.chat__message-text`, which is `display: inline`) escaped to the top of
  the nearest block ancestor instead of hugging the last line, since a float
  inside an inline box isn't contained by it. Fixed by restoring `display:
  inline` on `.chat__bubble-time` and replacing the float with `display:
  inline-flex` on `.chat__meta` for text bubbles, so it flows as a trailing
  inline unit and wraps with the last line naturally. Card types never used
  the float path and are unaffected.
- **Send button redesign** — replaced the spark/comet glyph (read as a
  comment icon) with a filled paper-plane SVG. Added a "launch" animation
  synced to the message actually sending: `triggerSendAnimation()` fires
  from `send()` right after the empty-content guard (never on an empty
  submit or the slash-command branch), toggling a `--launch` class with a
  forced reflow so rapid sends restart it cleanly; the icon flies out and
  fades, then a fresh one drops back in, respecting
  `prefers-reduced-motion`. The existing `:active` press-nudge is untouched
  (separate, instant tap feedback).
- **Removed chat-screen logout** — the app's model is block-based, not
  logout-based. Removed the "Log out" item from the chat `•••` menu
  (`MenuDropdown`), its handler, the `onLogout` param, and the now-orphaned
  `signOut` wiring/import from `ChatPage.ts`. The `ConnectionIdPage` (home
  screen) logout is a separate button and is untouched.
- **`/daily` replaced with `/thisorthat`.** `/daily`'s once-a-day plain-text
  prompt insert didn't meet the bar the other three slash commands hit (no
  card, no type, no lasting interaction) — removed along with its 12-prompt
  bank and the `insert()` helper it was the last user of. Added
  **`/thisorthat`**: a new keepsake-card type following the `/ask` sealed-
  reveal pattern exactly — `features/thisorthat.ts` (composer + answer
  modal), `thisorthatCard` in `ChatPage.ts`, `.thisorthat-card` /
  `.thisorthat-pick-opt` CSS (own gradient, unflattened in bubble mode).
  Sender writes two options and picks their own favorite in one step
  (sealed); recipient taps one of the two options (no free text — the
  format's whole point is a single tap) and both picks reveal side by side.
  Payload `{optionA, optionB, pickSender, pickRecipient?}`; sent as two
  ordinary reply-linked messages, same no-new-live-update-path approach as
  ask. Migration 025 widens `messages_type_chk` to add `'thisorthat'`.
Notes/deviations: **migration 025 still needs manual application** to the
live DB (same as 024) before `/thisorthat` can actually insert — code paths
are in place and typecheck clean either way. **Two items need a manual
mobile/two-account check**, not just build verification: the zoom-on-focus
fix (needs an actual phone/emulator) and the bubble footer fix (novel
layout, worth eyes-on beyond the CSS reasoning) — flagged to the user rather
than assumed working from build success alone.

---

## [Slash commands refresh, batches 4-6] /countdown, /checkin, /ask — 2026-09-01
Status: code complete, both projects build clean (`tsc`/`vite build`); pending
manual two-account walkthrough (migration 024 already applied to the live DB
per PR #36).
What shipped — three new compose modules mirroring `letters.ts`'s split
(feature module owns compose/answer UI, `ChatPage.ts` owns the inline card),
each slotted in via the confirmed 5-step pattern (`SlashContext` field +
`COMMANDS` entry, feature module, `slashCtx` callback + card builder + dispatch
branch):
- **`/countdown`** — `features/countdown.ts`. One-step compose (label +
  datetime-local, no letter-style write/preview split needed for structured
  data). `countdownCard` in `ChatPage.ts` runs a live `setInterval` ticker that
  self-clears the first time it finds its own card detached from the DOM,
  rather than needing new page-level teardown tracking.
- **`/checkin`** — `features/checkin.ts`. Mood picker (5-point scale) + a short
  note; the picker is the "permission-giver" that makes the honest line easier
  to send.
- **`/ask`** — `features/ask.ts`. The mutual sealed-reveal mechanic, built as
  two *ordinary* messages rather than a mutated one: the sender's sealed
  original (`{question, answerA}`) renders locked; tapping it as the recipient
  opens an answer modal that sends a second `ask` message reply-linked
  (`replyTo`) to the original with `{question, answerA, answerB}` filled in.
  That second message renders revealed (both answers, labeled by sender) —
  reusing the pre-existing generic reply/quote system (any message with a
  `replyTo` already gets a quote block in `buildMessageRow`) instead of adding
  any new live-update plumbing, exactly the "lite mechanic" the plan called
  for. No compose-time question re-validation against the original on answer
  submit — out of scope for lite (a double-answer just renders a second
  revealed card; accepted for v1).
- All three get their own "keepsake card" look in `global.css` (own gradient
  accent, unflattened in bubble mode) — the `.letter-card` family, not the
  flattened `.file-card`/`.voice-bubble` one — since they're meant to feel
  special/memorable, not utilitarian. Shared compose-modal classes
  (`.msg-compose__title/__field/__actions`) added by extending the existing
  `.letter-compose__*` selectors rather than duplicating rules, since all
  three (and letter) need the identical title/field/actions shape.
- `mediaLabel()` in `ChatPage.ts` gained cases for `countdown`/`checkin`
  (reply-quote snippets); `ask` deliberately has none — its `content` already
  *is* the question, so the existing fallback (`original.content`) already
  reads correctly in a reply quote.
Notes/deviations: batches 4-6 of 7, bundled into one PR (client-only, same
shape, same risk level) — same reasoning as batches 0-2. This closes out the
slash-commands-refresh plan
(`~/.claude/plans/brainstorming-planning-phase-virtual-spark.md`).

---

## [Slash commands refresh, batch 3] Migration 024 + ask/countdown/checkin type plumbing — 2026-09-01
Status: code complete, both projects build clean (`tsc`); **migration 024 not
yet applied to the live DB** — apply before batch 4 (`/countdown`) lands, since
that's the first batch that actually sends one of the new types.
What shipped:
- **Migration `024_message_types_widen.sql`** — widens `messages_type_chk`
  (currently `text,letter,voice` per migration 017) to the full 8-type union.
  Written idempotently (`drop constraint if exists` + recreate) since this
  session's sandbox couldn't reach the live DB directly (Supabase's
  direct-connect host is IPv6-only, unresolvable here) to confirm its current
  state — **worth a manual check**: `image`/`file` media messages already
  shipped and were verified working (PR #31/#32), which implies the live
  constraint already permits them via some out-of-band change, since no
  migration in this repo's history ever added them before now. This migration
  is safe either way, but that gap is worth understanding, not just papering over.
- **`MessageType` union widened** to include `'ask' | 'countdown' | 'checkin'`
  in both `messageService.ts` (backend) and `Transport.ts` (client) — kept in
  sync per the existing three-place pattern.
- **Payload validators added** (`messageService.ts`, structural only — no
  compose/render UI yet): `validateCountdownPayload` (`{label, targetIso}`,
  label 1-100 chars, targetIso must parse as a date), `validateCheckinPayload`
  (`{mood, note}`, mood from a fixed 5-point scale, note 1-300 chars),
  `validateAskPayload` (`{question, answerA, answerB?}`, question 1-300,
  answers 1-500 each). Each new type's primary display string (label / note /
  question) lives in `content` too, same shape as `text`/`letter` — no change
  needed to `saveMessage`'s content-length branch.
- `mediaLabel()` in `ChatPage.ts` already has a `default: null` case, so the
  widened union type-checks with no client renderer changes required yet.
Notes/deviations: this is batch 3 of 7. `/countdown`, `/checkin`, `/ask`
(compose UI + card renderers) are batches 4-6, staged next.

---

## [Slash commands refresh, batch 0-2] Remove /shrug+/flip, add /daily, spark send button — 2026-09-01
Status: code complete, client builds clean (`tsc`/`vite build`); pending visual
confirmation of the send-button icon (Chrome extension unavailable this
session — verify via Vercel preview) and manual composer walkthrough.
What shipped:
- **Removed `/shrug` and `/flip`** — both were plain-text composer inserts with
  no lasting value, unlike `/letter`. Deleted from `COMMANDS` in
  `slashCommands.ts`; `ARCHITECTURE.md`'s stale mention updated.
- **Added `/daily`** — question-of-the-day. Lite scope: a curated bank of
  12 prompts specific to two people who already know each other (not generic
  icebreakers), picked deterministically by day-of-year so both partners land
  on the same prompt, inserted into the composer via the existing `insert`
  helper (kept alive by this addition after shrug/flip's removal). No new
  message type, no migration — plain `text` message once sent.
- **Spark/comet send button** — replaced the plain `&uarr;` glyph with an
  inline feather-style SVG (curved tail + filled head, matching the existing
  attach/mic icon language) in `renderChat`'s composer markup. Button made
  round (`.chat__send-btn`, 40px) to match the attach/mic buttons it sits
  beside; a small "launch" transform on `:active`, respecting
  `prefers-reduced-motion`. Continues to tint via the existing
  `button.primary` → `var(--accent-you)` wallpaper-accent binding — no new
  theming work needed.
Notes/deviations: this is batches 0-2 of the 7-batch slash-command-refresh
plan (`~/.claude/plans/brainstorming-planning-phase-virtual-spark.md`) —
`/ask`, `/countdown`, `/checkin` and their enabling migration are separate,
higher-risk batches, staged after this one lands.

---

## [Chat UX batch] Receipts, reactions, logout, timestamps, wallpaper-1 — 2026-08-31
Status: code complete, both projects build clean (`tsc`/`vite build`); pending
migrations 021–023 applied to the live DB and a two-account manual walkthrough.
What shipped:
- **Read receipts → WhatsApp 3-state.** New `connection_members.last_delivered_at`
  (migration 021), server-maintained: bumped on socket connect/join
  (`socketServer.ts`) and, inline on `message:send`, when the recipient already
  has a live socket in the room (`syncDelivery`, replaces the old
  `notifyIfOffline` — same fetchSockets() call now also drives delivery, not
  just the offline-push decision). `connectionService.markDelivered` mirrors
  `markRead`; surfaced as `otherLastDeliveredAt` on `/connections/current`
  (no new Transport method — stays off-Transport like `markRead`/read receipts
  always have). Client `applyReceipt` now derives pending/delivered/seen;
  bubble-mode ticks: ✓ sent, ✓✓ gray delivered, ✓✓ **#53bdeb** (WhatsApp blue) seen.
- **Reactions → one per user per message.** Migration 022 drops the old
  `unique(message_id,user_id,emoji)` for `unique(message_id,user_id)`
  (dedup'd first); `reactionService.addReaction`'s upsert conflicts on
  `message_id,user_id` so picking a new emoji replaces the old row server-side
  too. Client `applyReactionUpdate` strips a user's other emoji on `add`; a
  `toggleReaction` revert bug this introduced (reverting a "switch emoji" op
  only undid the new emoji, not the replaced one) was caught and fixed before
  building. Reaction UI moved out of the bubble into a `.chat__reaction-badge`
  — a small pill absolutely positioned overlapping the bubble's bottom corner,
  Instagram-DM style (bottom-right for mine, bottom-left for the other's).
- **Logout.** `authService.signOut()` already existed but had no user-facing
  entry point — added a "Log out" button on `ConnectionIdPage` (home) and a
  "Log out" item in the chat `•••` menu (`MenuDropdown`), both following the
  existing `signOut()` → `location.assign('/')` reload pattern.
- **Per-message timestamp.** New `formatMessageTime()` (12-hour, e.g. "3:59 AM")
  in `utils/formatTime.ts`; renders in the *viewer's* local timezone for free
  (no `timeZone` option, same as the file's other formatters) since `createdAt`
  is stored as an ISO/UTC string. Shown as `.chat__bubble-time` under every
  bubble (was previously only visible via tap-to-expand full timestamp).
- **Wallpaper option "1" removed** (the picker's other three options —
  off/love/samurai — and the whole wallpaper system stay). Removed the option
  button, its `chat--wallpaper-1` CSS, and `'1'` from the backend
  `ALLOWED_WALLPAPERS`. Migration 023 resets any connection still on `'1'`
  back to `'off'`.
- **Android composer scrollbar removed** — `scrollbar-width: none` +
  `::-webkit-scrollbar { display: none }` on the message textarea; auto-grow
  to `MAX_INPUT_HEIGHT` and scroll-past-cap behavior unchanged.
Notes/deviations: "Delivered" fidelity depends on the recipient having a live
socket — a fully-closed PWA won't flip to delivered until its next socket
(re)connect (push alone doesn't bump it). Accepted for V1 per plan sign-off.
Planned in `~/.claude/plans/planning-phase-only-squishy-fog.md`.

## [Code-quality cleanup] Dead code, dedup, query reduction — 2026-08-30
Status: done. Both projects build clean; two-account walkthrough passed on the
dev stack (send/receive text+letter+reply, reactions, report at every
connection state incl. post-termination, rename during active + leave_pending,
mutual leave, solo termination, token-refresh reconnect). Migration 020 applied
to the live DB and verified. Branch `chore/codebase-cleanup`, 9 commits.
Audit report: `~/.claude/plans/lucky-drifting-engelbart.md`.
What shipped (batches ordered lowest→highest risk):
- **0** — removed committed cruft (`Love.webp`, `perv session.md`, `prompt.md`,
  `graphify-out/` cache, duplicate `wallpapers/*.jpg`); `.gitignore` hygiene
  (`graphify-out/`, `!*.env.example` negation); doc fixes (CLAUDE.md notes
  reactions/`/letter` as ratified §29 overrides; README drops the
  never-created `shared/` dir; stale `Modal.ts` / `slashCommands.ts` comments).
- **1** — dead code: `req.authUserId` (write-only), `ConnectionRow.leave_requested_*`
  interface fields; tightened ~11 over-broad `export`s to internal; `openReportModal`
  defined before use; `messageService` re-exports `Transport`/`ReactionUpdate`
  so `ChatPage` stops reaching into `transport/`.
- **2** — shared backend helpers: `utils/pgErrors.ts`, `utils/connections.ts`
  (`isLiveStatus`, `otherMemberId`), `withUniqueConnectionCode` (folds the
  duplicated code-gen retry loop), socket handshake reuses `currentLiveConnectionId`.
- **3** — `state/nextScreen.ts` `nextScreenFor()` replaces the routing logic
  inlined+drifted across `main.ts` / `ConnectionIdPage` / `WaitingPage`
  (WaitingPage now also routes on `leave_pending`); **G1 fix** — rename no
  longer bounces the user out during a pending leave; report dialog gets its
  own `report-dialog__*` CSS instead of borrowing `letter-compose__*`.
- **4** — `services/connectionAccess.ts`: one `getConnectionForMember` /
  `getConnectionByMessageId` replacing the membership+live check hand-written
  5× across connectionService/messageService/reactionService/reportService
  (error codes preserved exactly; `everMember` keeps the report-after-leave
  path). `ConnectionError` moved to `utils/connectionError.ts` (re-exported from
  connectionService — no other imports changed).
- **5** — `services/authToken.ts` `resolveUserFromToken()` shares the 15s
  token→user cache between the HTTP middleware and the socket handshake
  (reconnects skip the GoTrue round-trip). `message:send` resolves the
  connection once (`getLiveConnectionForUser`, 1 query) and threads the row
  into `saveMessage` + `notifyIfOffline` — **query count 6→3 online, 8→4
  offline**. `saveMessage` trusts the just-resolved row (no insert-time
  re-fetch; the ~ms TOCTOU window is self-cleaning via cascade-delete).
- **6** — `getCurrentConnection` embeds `connection_members` (PostgREST reverse
  embed, verified against live Supabase) and only fetches `users.connection_code`
  when `status === 'pending'` — **the 4s active poll drops 3 queries → 1**
  (`otherConnectionCode` is `''` for non-pending, read only by
  `ConnectionRequestPage`). `advanceLeave` / `confirmEndLeave` fetch both
  member rows in one query (`getMemberLeaveRows`).
- **020** — DB migration dropping `connections.leave_requested_by` /
  `leave_requested_at` (A2).
Notes/deviations: **B9** (shared error-banner helper across 7 form pages) —
deferred, non-uniform pattern, cosmetic. **F1** (`pg` prod→dev dependency) —
not done, gated on confirming how Railway runs migrations. Everything in the
audit's "leave alone" list untouched (ChatPage.ts decomposition, overlay/
dismiss unification, linkify/highlighter merge, transport abstraction,
`syncViewport`, applied-migration squashing, CI migration step).

## [UX smoothness pass, Batch 6 — final] Per-page polish, button/page transitions — 2026-08-30
Status: done. Client builds clean; device verification pending. This is the
last planned batch — the UX/UI smoothness pass (started as a separate track
from the security audit) is now feature-complete pending final device
sign-off. Plan: `~/.claude/plans/new-track-separate-from-async-stardust.md`.
What shipped:
- **Button transitions app-wide** — hover/press were instant everywhere
  (a B1 audit finding). Added a transition on border/background/filter/
  transform plus a small `:active` press-scale, reduced-motion guarded.
- **Page-entrance animation** — the router's `innerHTML` swap between screens
  was a hard instant cut (a B4 audit finding). `.screen` and `.chat` now
  fade+rise in on mount (`screen-enter`, reused across both), softening
  every navigation without touching the router itself.
- **Shared `.screen__input` class** — replaced two different inline
  width/text-align style blobs (Connect's 200px ID field, Nickname's 220px
  name field) with one token-driven class (`width:100%; max-width:240px`)
  plus a `--code` modifier for the uppercase/letter-spaced connection-ID
  variant. Removes the last two hardcoded pixel widths (B7).
- **`.connection-id` elevation** — added `box-shadow: var(--elevation-1)`,
  the intended "signature element" treatment from the Batch 1 design plan
  (the code you share to connect — the thing this app is actually about).
- **New `button.danger` class** — replaced `LeavePage.ts`'s inline
  `style="border-color: var(--danger); color: var(--danger)"` on the
  "Leave now" button with a real reusable class.
Notes/deviations: did not add a dedicated 481-720px breakpoint — the
`.screen`-based pages are already fluid/centered with per-element max-widths
and no concrete breakage was found at that range (unlike the ≤480px case
PR #22 fixed); adding one would have been speculative. The Export page's
downloadable HTML template has its own embedded inline styles by design
(a static export artifact, not live app UI) and was left untouched.

## [UX smoothness pass, Batch 5] Menu exit animation, safe-area insets, menu IA fix — 2026-08-30
Status: done. Client builds clean; device verification pending. Plan:
`~/.claude/plans/new-track-separate-from-async-stardust.md`.
What shipped:
- **Menu exit animation** — the nav dropdown and message context menu (both
  share `.menu`) got a pop-IN animation in Batch 4 but closed instantly
  (`panel.remove()`/`ctxMenu.remove()`), which read as abrupt right after a
  smooth open. New shared `utils/animateOut.ts` (`animateOutAndRemove`) adds
  a `.menu--closing` class, waits for `animationend` (with a safety timeout
  fallback, and an immediate-remove path under `prefers-reduced-motion`),
  then removes the element. Wired into `MenuDropdown.ts`'s `close()` and
  `ChatPage.ts`'s `closeCtxMenu()`.
- **Safe-area insets** — `.chat__nav`, `.modal-overlay`, and `.screen` now
  add `env(safe-area-inset-*)` on top of their existing padding (composer
  already had this on its bottom edge). Matters most in installed-PWA mode
  (no browser chrome to reserve the notch/home-indicator area) and landscape.
- **Menu duplicate-label fix** — `MenuDropdown.ts` had two identical
  "CONNECTION" group headers (one for Rename, a second for the unrelated
  Leave action), read as a mistake. Removed the redundant second label; the
  existing divider + danger-red styling already separate Leave visually.
- **iOS notification parity (#2) — confirmed descoped by user decision**,
  no further work; left hidden on iOS Safari tabs (installed-PWA-only
  platform limit).
Notes/deviations: none.

## [UX smoothness pass, Batch 4 fix] Long-press menu race on Android — 2026-08-30
Status: done, folded into the still-open Batch 4 PR (#26). Client builds clean.
What shipped: the long-press message menu (emoji/Copy/Report) would flash
open big, then instantly shrink, on Android — Android fires a native
`contextmenu` event around the same ~450ms threshold as our own JS long-press
timer, racing to build a second popover (the `contextmenu` handler always
included Reply, since that path didn't know it was actually a touch gesture)
on top of the first, cutting off the batch-4 pop-in animation mid-flight.
Fixed by having the `contextmenu` handler bail immediately on a coarse
pointer — long-press already owns this gesture on touch; right-click only
exists on desktop. The existing `suppressClickUntil`/`lastMenuFor` guard
stays for the hybrid-device edge case (a touchscreen laptop whose primary
pointer is a mouse).
Notes/deviations: none.

## [UX smoothness pass, Batch 4] Toasts — 2026-08-30
Status: done. Client builds clean; device verification pending. Plan:
`~/.claude/plans/new-track-separate-from-async-stardust.md`.
What shipped: New `components/Toast.ts` — a lightweight, auto-dismissing
(3.2s), tap-to-dismiss toast, stacked top-of-screen with a fade+slide
transition, `role="status"`/`aria-live="polite"`. `ChatPage.ts`'s `showNotice`
(push on/off feedback) now calls it instead of opening a modal — a status
message doesn't need a Tab-trapped decision dialog. `openTrackedModal`, which
existed only for `showNotice`'s modal, is now orphaned by that change and was
removed; the report-message and letter-composer modals track their own
overlays directly and are unaffected.
Notes/deviations: none.

## [UX smoothness pass, Batch 4 prep] Animation timing tweaks + menu-open animation — 2026-08-30
Status: done. Client builds clean. Small follow-ups from live-device feedback
on the (merged) Batch 3b, ahead of Batch 4 (toasts). Plan:
`~/.claude/plans/new-track-separate-from-async-stardust.md`.
What shipped:
- Reply-bar reveal slowed from `--duration-base` (200ms) to 360ms — a quick
  reveal read as a flicker rather than a visible confirmation of the swipe.
- Message send/receive pop slowed from 260ms to 340ms.
- **Menu-open animation added** — `.menu` (shared by the nav dropdown and the
  message context menu) previously appeared instantly with no transition at
  all. Now fades + scales in (`menu-pop` keyframe), `transform-origin`
  anchored per menu type (top-right for the nav dropdown, center for the
  context menu, which can appear above or below a message).
Notes/deviations: none.

## [UX smoothness pass, Batch 3b] iOS keyboard gap, keyboard-stays-open, animation polish — 2026-08-30
Status: in-progress (continues Batches 0-3, all merged). Client builds clean;
device verification pending. Plan:
`~/.claude/plans/new-track-separate-from-async-stardust.md`.
What shipped, from live device retest of Batch 3:
- **iOS black gap was only half-fixed.** Batch 3 synced `--app-height` from
  `visualViewport` but not its position — iOS shifts the *visual* viewport
  when the keyboard opens (via `offsetTop`) without reflowing the layout
  viewport, so `#app` (sized but not repositioned) stayed anchored above a
  now-scrolled-away area, leaving the gap between the composer and the
  keyboard the user was actually typing into. Fixed by making `#app`
  `position: fixed` and pinning `top` to `visualViewport.offsetTop` as well,
  tracked via both its `resize` and `scroll` events (`main.ts` `syncViewport`).
  This is the standard pattern other web chat apps use for this iOS quirk.
- **Keyboard was dismissing on send** — tapping the send `<button>` moves
  focus to it on most mobile browsers, closing the keyboard (unlike
  WhatsApp/iMessage, which keep it open). Fixed with `pointerdown`
  `preventDefault()` on the send button (stops the focus steal without
  blocking the click) plus `input.focus()` after send as a safety net.
- **Reply-bar animation felt janky on phones** — `startReply` opened the
  keyboard (`input.focus()`) in the same tick as the reply-bar's slide-in
  transition, so they competed for the main thread. Deferred the focus call
  one frame so the transition gets a head start.
- **Message entrance animation tuned toward WhatsApp's send "pop"**: bigger
  scale drop (0.6 vs 0.92) with an overshoot easing
  (`cubic-bezier(0.34, 1.56, 0.64, 1)`) instead of a flat fade, and
  `transform-origin` anchored to the bottom-right for your own messages
  (bottom-left for received) so it visually grows from the composer's side
  rather than popping from its own center.
Notes/deviations: iOS Safari's viewport/keyboard interaction is a well-known
inconsistency across versions — implemented the established fix pattern but
could not verify live; needs a real retest specifically for the gap and for
whether the keyboard now stays open through a send.

## [UX smoothness pass, Batch 3] Message/reply animation, iOS viewport gap, swipe icon — 2026-08-30
Status: in-progress (continues the Batches 0-2 PR, #23, now merged). Client
builds clean; device verification pending. Plan:
`~/.claude/plans/new-track-separate-from-async-stardust.md`.
What shipped, from live device testing of the merged Batch 0-2 work:
- **Message send/receive had no entrance animation** ("appears out of thin
  air") — `appendMessage` now takes an `animate` flag, scale+fade via
  `@keyframes message-enter`, applied ONLY to a message arriving live this
  session (the optimistic send, and incoming `onIncoming`) — never to initial
  history load or `loadOlder` pagination, which would otherwise cascade-
  animate every past message on open. Respects `prefers-reduced-motion`.
- **Reply-bar had no animation** — was a hard `display:none`/`flex` toggle.
  Now a class-toggled `max-height`/`opacity`/`transform` transition, so it
  slides in above the composer instead of snapping.
- **iOS Safari black gap below the composer on cold load**, disappearing only
  after the keyboard opens once: `100dvh`'s first paint on iOS can use the
  toolbar-collapsed height while the toolbar is still expanded, leaving a gap
  of page background until some event forces a recompute. Added a
  `visualViewport`-driven `--app-height` custom property (`main.ts`,
  `syncAppHeight`) that `#app` now prefers over the dvh fallback chain.
- **Swipe-to-reply icon** was a `↩` text glyph (looked like an emoji/informal).
  Replaced with a plain inline SVG reply-arrow using `currentColor`.
- **iOS notification parity (#2) — descoped by user decision.** Web Push
  requires an installed PWA on iOS Safari; user decided not to invest in a
  disabled+explanation treatment for now — left as-is (hidden on iOS tabs).
Notes/deviations: the Grammarly-style icons visible in the composer on one
screenshot are a browser extension overlay, not app UI — nothing to fix.
Remaining batches: toasts, safe-area insets + menu IA dup-label fix, per-page
redesign application. Still needs iOS/Android device confirmation for this
batch specifically (send/reply animation feel, and whether the viewport gap
is actually gone on cold load).

## [UX smoothness pass, Batches 0-2] Context-menu bug, gesture fix, design tokens — 2026-08-30
Status: in-progress (batches 0-2 of a 7-batch plan; client builds clean; device
verification pending). Plan: `~/.claude/plans/new-track-separate-from-async-stardust.md`.
What shipped: A deeper UX/UI audit beyond PR #22 found 2 of 4 user-reported
issues didn't match current source (traced and corrected the report), 1 iOS
menu item genuinely gated by a platform limit, and 1 new bug from live testing.
- **Context-menu full-width bug (real, found live):** `.chat__ctx-menu` was
  declared *before* `.menu` in `global.css` — equal specificity, so the later
  `.menu` rule won the cascade, clobbering `position:fixed`/`right:auto`/
  `z-index:40`. Combined with the JS's inline `left`, the menu ended up
  constrained by both `left` (inline) and `right:20px` (from `.menu`) with
  `width:auto`, so CSS stretched it to fill the gap — full viewport width.
  Fixed by reordering the rule after `.menu`.
- **Context-menu position also now anchors to the message bubble** (not
  `e.clientX/Y`) — previously right-clicking near a bubble's left vs. right
  edge shifted the menu, since it centered on the raw cursor point. Long-press
  already anchored to the bubble; right-click now matches (`ChatPage.ts`
  `contextmenu` handler).
- **Swipe-to-reply had no real direction lock:** the axis check existed but
  `touchmove` was `{ passive: true }`, so `preventDefault` was impossible and
  native scroll could run alongside a horizontal swipe. Added
  `touch-action: pan-y` on `.chat__log` and made `touchmove` non-passive,
  calling `preventDefault()` once the gesture commits horizontal.
- **Timestamp toggled on any click in a message row**, including empty space
  beside short text — the click listener was on the whole row/body, and
  `.chat__message-body` is `flex:1` (full row width) in line mode. Moved the
  listener onto the actual text/letter-card element (which is `display:inline`
  or its own bounded card), so only the visible content is clickable.
- **Menu/iOS parity re-scoped:** code only ever gated Notifications (via
  `isPushSupported()`/`PushManager`), confirmed live — Export/Search/Appearance
  already show on iOS. Approved fix (not yet built): show Notifications
  disabled + explanation on iOS instead of hidden.
- **Design foundation (Batch 1):** token system added to `global.css` — spacing
  scale, radii, elevation, type scale, motion vars; three type voices
  (`--font-display` Fraunces serif for titles, `--font-body` Figtree sans for
  reading, `--font-mono` JetBrains Mono — now actually loaded via Google Fonts,
  previously named but never loaded, silently falling back to system mono) —
  app-wide light theme via `prefers-color-scheme` (previously only the Chat
  page had a light variant; added a `.chat[data-theme='dark']` re-pin so the
  chat's own manual theme picker still overrides correctly under a light OS).
Notes/deviations: Design direction is "Hybrid" (approved) — mono kept as the
data voice for codes/timestamps/receipts, serif+sans for display/reading, not
a full skin replacement. Remaining batches: micro-interactions/animations,
toasts, iOS notification treatment + safe-area insets + menu IA fix, per-page
redesign application. Real iOS/Android device confirmation still needed for
the gesture fix specifically (user tested pure-axis swipes only, not diagonal).

## [UI/layout polish] Fix visibly-broken screens — 2026-08-30
Status: done, client builds clean; branch `fix/ui-layout-polish` (PR #22); in-app
visual pass across widths still pending (rides with live verification).
What shipped: A CSS/layout audit found 17 on-screen defects unrelated to the
security audit; this fixes them. Almost all in `client/src/styles/global.css`.
- **Chat header:** a long nickname pushed the ⋯ menu button off-screen (clipped,
  unreachable) — `.chat__nav > div { min-width:0 }`, title/status ellipsis,
  `flex-shrink:0` on the button.
- **`.screen__actions`** now wraps (was a rigid row) — ExportPage's 3-button row
  and wide single buttons no longer overflow phones. `.screen__title` gets
  `max-width` + `text-wrap:balance`; hard `<br />` removed from Login / Nickname /
  Leave titles.
- **Line style + Light theme** was a dead toggle (light palette only existed for
  bubble mode). Added `.chat[data-theme='light']` with the full token set +
  darkened YOU/other/danger accents for legibility on white.
- **Modals vs. mobile keyboard:** pin-to-top + scroll (`align-items:flex-start`,
  `overflow-y:auto`, `margin:auto`, `max-height:90dvh`) so the action row stays
  reachable. `#app` gets `-webkit-fill-available` where `dvh` is unsupported.
- `.menu` / `.slash-menu` height clamps (clipped `Leave connection` on short
  viewports); `.chat__quote-snippet` `280px`→`100%`; new `.letter-card__text`
  wrap rule; appearance wallpaper row wraps; empty chat shows a start-of-convo
  line; flash animates the bubble not the row; ctx-menu z-index above the slash
  menu; mobile popover insets match the 12px bars; failed messages hide the
  stray receipt dot.
Notes/deviations: pure CSS + 4 trivial DOM edits, no behaviour/logic change.
Wallpaper + Light-theme interaction (dark scrim under a light UI) left as a
pre-existing edge case.

## [Ops] Secret rotation — 2026-08-30
Status: done (dashboard + Railway + Vercel by user; local `.env` + verification by
Claude). Not a code change — recorded for history.
What happened: Rotated per the Aug-29 audit (CR-1). Git history was verified
clean — no secret was ever committed; exposure was `backend/.env` on disk + a
brief working-tree paste. Supabase moved to the **new API-key model**: legacy
anon + service_role JWTs **disabled**, new `sb_secret_…` / `sb_publishable_…`
keys issued (old `sb_secret` also revoked). Postgres password reset. VAPID
keypair regenerated — and this fixed a latent bug: `backend/.env` and
`client/.env` had held **mismatched** VAPID pairs, so push had been silently
100% broken. `push_subscriptions` table emptied. All old keys verified dead
(HTTP 401 on Supabase REST); new keys verified live (200). `backend/.env`
cleaned (had a duplicate service-key line).

## [Security & correctness audit] Batches 4–9 (Medium + Low tier) — 2026-08-30
Status: done, builds clean; **apply migration 019**; branch `fix/audit-medium-low`
What shipped: The deferred remainder of the Aug-29 audit — the frontend Mediums and
the Low tier (all 10 backend Mediums + L-B3 already landed in Batches 0–3). Six
stacked commits on `fix/audit-medium-low` (branched off `fix/audit-critical-high`,
which reached `main` via PR #20 after the original PR #18 merged into the wrong
base). No behaviour changed beyond the fixes; no style churn.
- **Batch 4 — overlays & downloads:** `Modal.ts` is now a modal stack — one shared
  keydown listener, only the top modal takes Escape and traps Tab; focus is saved
  and restored; backdrop dismiss only fires when the mousedown started on the
  backdrop (M-F4). `download.ts` appends the anchor before click and defers
  `revokeObjectURL` 10s (M-F5).
- **Batch 5 — chat page:** auto-scroll only when already near the bottom / the
  message is mine (M-F2); search input debounced ~120ms (M-F9); highlight splits
  text nodes only so linkified `<a>` survive a search (M-F10); `CSS.escape`
  guarded (L-F1); history sorted by `createdAt` before render (L-F5).
- **Batch 6 — form pages:** NicknamePage trims + disables Save (M-F13);
  LeavePage / ConnectionRequestPage disable their action buttons during the
  request (M-F14); `otherConnectionCode` escaped (M-F15); ConnectionIdPage Copy
  feature-detects clipboard with an execCommand fallback + feedback (M-F18).
- **Batch 7 — push / service worker:** `getRegistration` races
  `serviceWorker.ready` with a 3s timeout (the Notifications click no longer hangs
  when `/sw.js` is missing) (M-F6); `subscribeToPush` unsubscribes the browser
  sub if the server save fails (M-F7).
- **Batch 8 — util polish:** `formatTime` invalid-Date guards + ChatPage skips a
  separator for a bad timestamp (L-F2); `linkify` runs length-bounded and the
  phone branch needs a leading `+` (L-F3); `/shrug` `/flip` replace only the
  leading token and fire an input event (L-F4); an OAuth `?error=` / `#error=`
  redirect is surfaced on the login screen (L-F6).
- **Batch 9 — backend lows:** `requireAuth` resolves + caches the app user per
  access token (15s, never past exp) and exposes `req.appUser`; routes stop
  re-calling `getOrCreateUser` — the 4s poll drops from ~4–5 external round-trips
  to ~1 (L-B1). UUID-shape assert before the PostgREST `.or()` interpolation
  (L-B2). `removeSubscription` deletes by endpoint alone (L-B4). Migration 019:
  `advance_leave_step()` RPC does the leave advance entirely in SQL — from-step
  pin + 24h cooldown vs `now()` — instead of a JS `Date.now()` cutoff (L-B5).
Notes/deviations: **L-B1** kept Supabase GoTrue as the token-verification
authority (short-TTL cache) rather than local HS256 signature verification — the
latter needs a `SUPABASE_JWT_SECRET` the deploy doesn't currently set, and the
cache delivers the same round-trip saving at far lower lockout/bypass risk.
**L-B6** (soft-delete on terminate) skipped — contradicts the deliberate spec §25
"export first, nothing retained" decision. **L-F7** (`supabaseClient` throws at
import) left as the audit's own "acceptable fail-fast". Compile/build verified
only; the DB-dependent items (migration 019, the leave gate, the 2-account race,
browser leak/reconnect checks) still need a running stack + scratch Supabase
branch.

## [Security & correctness audit] Batches 0–3 (Critical + all High) — 2026-08-29
Status: done, builds clean; **apply migrations 016, 017, 018**; rotate secrets (see below)
What shipped: Remediation of the ruthless full-repo audit (3 Critical, 13 High, plus folded-in
Mediums). Four stacked commits on `fix/audit-critical-high` (branched off the reaction-picker PR).
- **Batch 0 — secrets:** `backend/.env.example` had the real VAPID keypair pasted in → reverted.
  Added `.githooks/pre-commit` (gitleaks + `.env.example`-has-no-values), `.gitleaks.toml`,
  `.github/workflows/gitleaks.yml`. **Manual:** rotate the Supabase service-role key, Postgres
  password, and VAPID keypair — they were on disk in `.env` and briefly in the tracked template.
- **Batch 1 — backend correctness:** `getHistory` paginates newest-first (limit 50) + `before`
  cursor + client "Load older" button (past ~1000 messages PostgREST's row cap was returning the
  *oldest* 1000 and hiding everything recent). Migration 016: partial unique indexes +
  advisory-locked trigger so concurrent requests can't create two live connections;
  `getCurrentConnection` tolerates >1 row instead of 500ing and locking the user out. Conditional
  state transitions (accept/decline/advanceLeave pin the from-state) so accept can't resurrect a
  declined row and the 24h leave gate can't be raced. Migration 017: `ON DELETE CASCADE` on
  `connections.user_*`/`messages.sender_id` (user deletion was impossible) + `type`/`emoji`
  CHECKs. `connection_members` insert now error-checked + rolled back.
- **Batch 2 — backend hardening:** push endpoint host-allowlist (was blind SSRF); `crypto.randomInt`
  8-char codes (was `Math.random`); `express-rate-limit` (global 240/min + 10/min on request/
  subscribe/report) + 32kb json + per-socket flood guard; socket events re-resolve the live
  connection per event (not the handshake pin); `requestConnection` returns one generic error
  (no enumeration oracle); `POST /connections/:id/cancel` for the requester + WaitingPage Cancel
  button; `connection:ended` broadcast on terminate; `reportMessage` works after termination and
  snapshots the message (migration 018: unique per reporter, `message_id` nullable + SET NULL,
  `message_content` column); error middleware `headersSent` guard + socket acks no longer leak
  raw PG strings.
- **Batch 3 — frontend reliability:** `ChatPage.cleanup()` tears down the popover + its global
  listeners, the menu dropdown, the appearance panel, and open modals (were leaked every visit);
  startup try/catch + global handlers (no more blank page on a cold-load blip); 401 → sign out +
  login; reconnect supervisor + 10s ack timeout + fresh-token socket auth (messages no longer
  stuck forever); optimistic reconcile on a client `tempId` echoed by the server (was matched on
  content → duplicates) + incoming dedup; `disposed` guards after every await; long-press picker
  no longer dismissed by the trailing synthetic click; self-scheduling poll.
Notes/deviations: ~25 Medium and ~10 Low findings from the audit are documented in the plan file
(`~/.claude/plans/fix-chat-responsive-layout-splendid-babbage.md`) for a follow-up pass — this
batch was scoped to Critical + High.

## [Post-launch fixes] Reaction-picker viewport clamp, responsive hardening, Copy/Report — 2026-08-29
Status: done (**apply migration 015**); builds clean; needs live testing across viewports
What shipped:
- **Root cause of the mobile "zoomed page / misaligned header / blank right strip":** the reaction/context popover. `openPopover()` in `ChatPage.ts` placed the `.menu.chat__ctx-menu` (`position:fixed`, inheriting `.menu { min-width:200px }`) at the raw touch/click coordinates — no viewport clamp, no flip, no dimension measurement. Near the right/bottom edge the box overflowed the viewport; on iOS Safari off-screen fixed content lets the visual viewport pan/zoom. The normal layout chain was already sound (no `100vw`, no `overflow-x`, no forced widths).
- **`openPopover` rewritten** to take an anchor rect (the message bubble, or a zero-size rect at the cursor on desktop) instead of `(x, y)`. It measures the built menu, then clamps `left`/`top` into the visual viewport with an 8px safe margin and flips above↔below the message when there isn't room. Repositions on `visualViewport` + window resize, dismisses on log scroll / Escape / outside click. CSS: `.chat__ctx-menu { min-width:0; max-width:calc(100vw - 16px) }`, `.chat__emoji-picker { flex-wrap:wrap }`.
- **Viewport meta corrected** to `width=device-width, initial-scale=1, viewport-fit=cover` — dropped `maximum-scale=1.0, user-scalable=no` (restores pinch-zoom; the 16px composer font on ≤480px is the real iOS focus-zoom fix and stays).
- **Touch text selection suppressed on message bubbles** (`@media (pointer: coarse)` — `user-select:none` + `-webkit-touch-callout:none`) so long-press-to-react doesn't fight native selection/callout. Desktop keeps selection. `.chat__log { overflow-x:hidden }` contains the reply-swipe `translateX`.
- **Copy + Report actions** added to the message menu (both touch and desktop), via a shared `buildMessageMenu()`. Copy uses the clipboard API (text messages only). Report opens a modal (reuses `components/Modal.ts`) with an optional reason → `POST /api/messages/:id/report` → new `message_reports` table (migration 015, RLS enabled). `reportService.reportMessage` re-verifies connection membership server-side via `assertMemberOfMessageConnection` (now exported from `reactionService`), never trusting the client (spec §20). No moderation UI in V1 — rows are for manual review; satisfies the Play Store UGC reporting requirement (blocking is already the one-connection / leave model).
Notes/deviations: Picker dismisses rather than repositions on log scroll — matches native context-menu behaviour.

## [Post-launch fixes] Samurai wallpaper, drop wallpaper "2" — 2026-08-27
Status: done, builds clean
What shipped: Replaced the generic gradient wallpaper option ("2") with a real second photo wallpaper — **Samurai** (`client/public/samurai.jpg`), bubble colors pulled from its own crimson/charcoal palette (`wallpapers/samurai wallpaper description.txt`): mine = crimson gradient, white text; them = charcoal black, pale ivory text. Wallpaper options are now Off / 1 / Love / Samurai everywhere they're validated: `appearancePreview.ts` popover, `applyAppearance`'s class toggles, and backend `ALLOWED_WALLPAPERS`.
Notes/deviations: The user reported "Could not update the wallpaper" when picking Love — almost certainly because **migration 014 (`connections.wallpaper`) hadn't been applied in Supabase yet** (the update would fail with a missing-column error server-side, surfacing as the client's generic failure popup). Flagged to the user; not something more code can fix.

## [Post-launch fixes] Notification popup, shared wallpaper, mobile input zoom — 2026-08-27
Status: done (**apply migration 014**; builds clean; needs live testing after deploy)
What shipped:
- **Mobile zoom/jump on typing, fixed.** Root cause: `.chat__input-bar textarea { font-size: inherit }` (specificity 0,1,1) was silently overriding the `@media (max-width:480px) { input, textarea { font-size:16px } }` rule (specificity 0,0,1) — CSS specificity beats media-query source order, so the composer stayed at the inherited 15px on phones, triggering iOS Safari's auto-zoom-on-focus-under-16px. Added `.chat__input-bar textarea` explicitly into the mobile rule so it actually wins. Also locked `maximum-scale=1.0, user-scalable=no` on the viewport meta as a second layer against any residual pinch/auto-zoom.
- **Notification feedback is now a popup**, not the easy-to-miss in-chat system line — reuses `components/Modal.ts`. Shows the actual error message on failure (not a generic one) so it's diagnosable. Backend `pushService.sendToUser` also gained `console.log`/`console.error` on every send attempt (visible in Railway logs) instead of silently swallowing non-404/410 failures.
- **Wallpaper is now shared per-connection** (either member's pick applies to both) — a genuinely new architectural split, since everything else in Appearance (message style, light/dark theme) stays a per-device localStorage preference on purpose. New `connections.wallpaper` column (migration 014), `PATCH /connections/:id/wallpaper` (membership-checked like every other connection write), included in `getCurrentConnection`. `appearancePreview.ts` no longer owns wallpaper state at all — `applyAppearance`/`openAppearance` now take it as a param from `ChatPage.ts`, which applies it optimistically on change and re-syncs it off the existing 4s connection poll (no new socket event needed — reuses the same poll leave-state/read-receipts already ride).
Notes/deviations: The actual "notifications not sending" root cause is still unconfirmed — most likely culprit is that `VITE_VAPID_PUBLIC_KEY` was only added to Vercel *after* the last deploy, and Vite bakes `VITE_*` vars in at build time, not runtime, so a redeploy is required for the client to even see the key (if the "Notifications" menu item isn't appearing at all, this is almost certainly it). The popup + server-side logging in this fix are meant to make the actual failure point visible next time, not a guaranteed fix on their own. Verified compile/build only.

## [Phase D] Web Push notifications — 2026-08-27
Status: done, but **not live** — needs VAPID keys generated and set (see below) and migration 013 applied; builds clean; two devices to verify
What shipped:
- **DB:** `push_subscriptions` table (migration 013) — one row per device/browser, unique on `endpoint`, RLS enabled.
- **PWA shell:** `client/public/manifest.webmanifest`, `client/public/sw.js` (handles `push` → `showNotification`, and `notificationclick` → focuses or opens the app), `client/public/icon.svg` (a simple two-circle mark in the app's own accent colors), linked from `index.html` + registered in `main.ts`. This also makes the app installable — required for iOS to deliver push at all (Apple only allows it for a site Added to Home Screen).
- **Backend:** `web-push` dependency; `pushService.ts` (`saveSubscription`/`removeSubscription`/`sendToUser` — prunes a subscription on a 404/410 from the push service); `routes/push.ts` (`POST /api/push/subscribe`, `/unsubscribe`). If `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` aren't set, push silently no-ops (logs a warning) rather than crashing — safe for local dev without keys.
- **Send path:** in `socketServer.ts`, after a `message:send` broadcasts, `notifyIfOffline()` checks whether the recipient has a live socket in the connection's room (rooms are exactly the two 1:1 members, so "anyone else present" = the recipient is here); if not, it looks up "what the recipient calls the sender" (nicknames are stored on the *other* member's row, per spec §11 — so that's the sender's own `connection_members.nickname`) and pushes a notification with that as the title.
- **Client subscribe flow:** `features/pushNotifications.ts` (`isPushSupported`/`isPushSubscribed`/`subscribeToPush`/`unsubscribeFromPush`) wired to a new **Notifications** item in the `•••` menu (only rendered when the browser supports push) — a deliberate toggle, not an automatic prompt-on-load, since browsers/users auto-deny unsolicited permission prompts. Confirmation reuses the existing `appendSystemLine` in-chat pattern (same one leave-lifecycle events use).
Notes/deviations: **This phase needs user action before it does anything**: (1) apply migration 013 in Supabase, (2) generate VAPID keys with `npx web-push generate-vapid-keys`, (3) set `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` on the backend and `VITE_VAPID_PUBLIC_KEY` (the public half) on the client, both documented in the respective `.env.example`. Reactions don't trigger a push (out of scope — the plan only asked for message notifications). iOS Safari push only works after "Add to Home Screen"; no in-app hint for that yet (flagged as a follow-up in the original plan). Verified compile/build only — needs the keys set and two real devices (one with the app closed) to confirm delivery end-to-end.

## [Phase C] Emoji reactions: long-press (phone) / right-click React (desktop) — 2026-08-27
Status: done (builds clean; **apply migration 012**; two accounts to verify)
What shipped:
- **DB:** new `reactions` table (`012_reactions.sql`) — one row per `(message_id, user_id, emoji)`, unique constraint so a user can't double-react with the same emoji; RLS enabled with no policies (same default-deny net as migration 006 — backend uses the service_role key).
- **Backend:** `reactionService.ts` — `addReaction`/`removeReaction` resolve the message's connection and re-verify live membership before writing (never trusts the client, spec §20); a fixed 6-emoji allowlist (❤️ 👍 😂 😮 😢 🙏) is validated server-side too. `getReactionsForMessages` aggregates rows into `{ emoji, userIds }[]` per message, attached to `Message.reactions` in `getHistory`. Socket gained `reaction:add`/`reaction:remove` handlers that broadcast `reaction:update` (`{ messageId, emoji, userId, op }`) to the connection room.
- **Transport:** `sendReaction`/`onReaction` added to the interface and `InternetTransport` — additive, matches the existing message-send/receive shape.
- **UI, per user's interaction spec (explicit: "long press message to react in phone, in PC right click to react or reply"):** phone = long-press a row (~450ms, cancelled by real movement so it doesn't fight the reply-swipe) opens a 6-emoji picker at the touch point; desktop = the same right-click context menu from Phase B gained a **React** item that opens the identical picker. Both routes go through a new shared `openPopover()` helper. Tapping an emoji (in the picker, or an existing chip) toggles your own reaction — optimistic local update, reverted if the server call fails.
- **Rendering:** reaction chips render under the message body (`chat__reactions`), grouped by emoji with a count once >1, highlighted when you're among the reactors; updates apply live to the right row via an in-memory `reactionsByMessage` map keyed by message id (same id-lookup pattern as Phase B's reply quotes).
Notes/deviations: This explicitly overrides spec §29's V1 non-goals list (Reactions) — user confirmed this trade-off during planning, before any code was written. Reactions on a still-pending (unsent) message aren't offered, for the same reason replies aren't — no server id yet. Verified compile/build only; needs two accounts to confirm the long-press timing feels right and doesn't fire spuriously during scroll.

## [Phase B] Quoted replies: swipe (phone) / right-click (desktop) — 2026-08-27
Status: done (builds clean; **apply migration 011** — already applied by user in Supabase; two accounts to verify)
What shipped:
- **DB:** `messages.reply_to` (nullable, `references messages(id) on delete set null`) via `011_message_reply.sql`.
- **Backend:** `saveMessage(..., replyTo)` validates the target is a real message **in the same connection** (never trusts a client-supplied id, spec §20) before storing; `getHistory`/`toMessage` return `replyTo`. Socket `message:send` reads `replyTo` off the payload.
- **Transport:** `Transport.sendMessage` gained an optional `replyTo` 4th arg; `IncomingMessage`/`HistoryMessage` gained `replyTo`. Additive — `BluetoothTransport` (V3) just needs to plumb the same field.
- **Reply UI, per user's interaction spec:** phone = right-swipe a message row (translateX + a fading "↩" icon, ~60px trigger); desktop = right-click a row opens a small context menu with **Reply** (`.chat__ctx-menu`, reuses `.menu` styling) — built as a shared menu so Phase C's **React** can be added as a second item without rebuilding it. Both call `startReply(id)`, which shows a quoted-reply bar above the composer (sender + snippet, ✕ to cancel); the next send carries `replyTo` and clears the bar.
- **Rendering:** replied-to messages show a small quoted block above their text (`quoteBlock()`) — sender + one-line snippet, resolved from an in-memory `messagesById` map populated as messages render (history load, live incoming, and pending→confirmed). Tapping the quote scrolls to the original and briefly flashes it (`chat__message--flash`).
Notes/deviations: Reply is disabled on still-pending (not-yet-confirmed) rows — they have no server id yet, so `dataset.id` is unset and the swipe/right-click handlers no-op; this is implicit, not a special-cased guard. Letters don't carry reply context (composing `/letter` while a reply is staged just clears the reply bar rather than attaching it) — a deliberate scope cut, not a bug. Verified compile/build only; needs two accounts to confirm the swipe threshold feels right and the desktop context menu behaves.

## [Phase A] Appearance overhaul + multi-line composer + linkify + mobile `/letter` fix — 2026-08-27
Status: done (client-only, no migration; builds clean; browser + phone testing pending)
What shipped:
- **Bubbles is now the default** (`appearancePreview.ts` `DEFAULT.style`), not line/terminal.
- **iMessage-style bubble palette + Light/Dark theme.** New `--bubble-mine-*`/`--bubble-other-*` CSS vars: "me" is a fixed saturated blue (`#0a84ff`) with white text in both themes (like iOS); "them" flips grey-dark (`#26262a`) ↔ grey-light (`#e9e9eb`) via a new `data-theme` attribute on `.chat`, driven by a third **Theme (Light/Dark)** row added to the existing Appearance popover — stays a 3-row, uncrowded panel (Wallpaper / Message style / Theme), all in the same `appearancePreview` localStorage object.
- **"Love" wallpaper.** `client/public/love.jpg` (Vite's static dir — newly created, no `vite.config.ts` needed) served at `/love.jpg`; new `chat--wallpaper-love` option renders it behind the log with a legibility scrim, and swaps bubble colors to a palette pulled from the artwork itself (a dusk couple-silhouette scene) so bubbles read against the art instead of clashing. Went through two iterations with the user: first a placeholder pink wallpaper (later swapped for the final dusk image + a matching gold/steel-blue palette), and the receiver bubble color was corrected once for washing out against the art.
- **Read-tick contrast fix** (this was about legibility, not size, per user correction mid-session): ticks render white (`rgba(255,255,255,.65)` sent, solid white seen) against the always-saturated "mine" bubble, instead of a near-black tint that could wash out.
- **Multi-line messages / paragraph gaps work.** The single-line `<input>` composer is now an auto-growing `<textarea>` (capped ~120px, then scrolls); `.chat__message-text` gained `white-space: pre-wrap; overflow-wrap: anywhere`, so blank-line gaps between paragraphs survive send→render. Desktop: Enter sends, Shift+Enter newlines. Touch (`pointer:coarse`): Enter always newlines; the send button sends — this is what makes typing paragraph gaps possible from a phone keyboard.
- **Clickable links + phone numbers.** New `utils/linkify.ts` — splits message text into text nodes + `<a>` nodes (never `innerHTML`, stays XSS-safe like the existing search highlighter) for `http(s)://…`, `www…`, and phone-number-shaped digit runs (→ `tel:`), opened `target="_blank" rel="noopener noreferrer"`. Wired into `appendMessage()`; the search-highlight `clearHighlights()` path was fixed to re-linkify (not flatten to plain text) so links survive a search open/close cycle.
- **`/letter` fixed on mobile.** Root cause was twofold: `.slash-menu` had no positioned ancestor (`.chat__input-bar` now `position: relative`, so the drop-up renders on-screen instead of off the top of the viewport), and Android soft keyboards fire `keydown 229`/`Unidentified` instead of a catchable `Enter`/arrow keys, so selecting `/letter` via keyboard silently failed and the literal text got submitted. Added `slashCommands.ts` `matchCommand`/`runIfCommand` — the composer's `submit` handler now checks for an exact `/command` match before falling back to a normal send, covering the keyboard-Send-key path regardless of what keydown events actually fired.
Notes/deviations: Reactions (Phase C) and Web Push (Phase D) are explicitly out of scope for this part — see the plan at `~/.claude/plans/below-i-have-given-dazzling-elephant.md`. Reactions override spec §29's V1 non-goals list; user explicitly confirmed this trade-off before planning began. Verified compile/build only so far; needs a browser (both themes, both wallpapers) and a real phone for the `/letter` + composer verification.

## [1.x] Message-type foundation + `/letter` slash command (+ bubble tick) — 2026-08-27
Status: done (builds clean; **apply migration 010**; two accounts to verify)
What shipped:
- **Message-type groundwork (reusable):** `messages` gains `type` ('text'|'letter'|future 'voice') + `payload` (jsonb) via migration `010_message_types.sql` (**user applies**). The shape is threaded additively through the whole pipeline — backend `Message`/`saveMessage`/`getHistory` (letter body stays in `content`, so the length CHECK/search/export keep working; appearance+from+to go in `payload`, validated like nicknames), the socket `message:send`, `Transport.sendMessage(content, type?, payload?)` + `IncomingMessage`, `connectionsApi.HistoryMessage`, and `ChatPage` render. Adding voice later is now additive.
- **Slash commands:** new `features/slashCommands.ts` — a registry + drop-up menu on the composer (arrow/Enter/click, filters as you type). `/letter` (special), `/shrug` + `/flip` (text-insert). Grow the registry for more.
- **`/letter` end-to-end:** compose modal (write → preview with **2 appearances** `dawn`/`botanical`) → sends as a **folded letter card** in chat ("to X, from Y") → recipient taps → styled letter opens in a modal → **Download .html** (self-contained). "To" auto = sender's nickname for recipient; "From" = typed signature (remembered per device). New `components/Modal.ts` (reusable overlay), `features/letters.ts` (themes/compose/view/`buildLetterHtml`), `utils/download.ts` (shared `downloadFile`+`escapeHtml`, extracted from ExportPage).
- **Export is type-aware:** TXT/JSON/HTML each render letters sensibly (HTML export shows a styled letter block).
- **Bubble tick darkened** (`rgba(4,23,10,0.55)`→`0.85`) so ✓ stands out on the green bubble.
Notes/deviations: Letter bodies aren't in the in-chat text search yet (card, not `.chat__message-text`) — minor. Optimistic dedup now keys on content+type. Image/PDF letter download deferred (needs a library). Master plan updated with the message-type foundation + voice-note/custom-wallpaper/extra-slash plans. Verified compile/build only; needs migration 010 + two accounts to confirm runtime.

## [1.D/1.F polish] Read-dot receipts, desktop centering, appearance preview — 2026-08-27
Status: done (builds clean; **apply migration 009**; two accounts to verify)
What shipped:
- **Read receipts — root cause fixed + redesigned.** The grey-forever-old-messages bug was *data, not logic*: `last_read_at` was nullable/no-backfill and written only by `markRead` (viewer poll), so reads that happened before the read-receipt route existed were never recorded. Fixes: (1) **`saveMessage` now advances the sender's `last_read_at`** to the message's DB `created_at` — replying proves you read the prior messages, and avoids app/DB clock skew; (2) **backfill migration `009_backfill_last_read.sql`** seeds existing members to `now()` (**user applies in Supabase**). Visual: a small **per-message read receipt at the end of my messages**, rendered by mode — **line/terminal mode: a dot** (green filled = seen, hollow = not seen); **bubble mode: WhatsApp ticks** (✓ sent, blue ✓✓ read). "Seen" is gated behind delivered (fixes the audit bug where a still-sending optimistic row could flash blue).
- **Desktop centering.** `.chat` is now a centered `max-width:720px` bordered "app column" (`margin-inline:auto` + `border-inline`), so it no longer hugs the far left on wide monitors. Mobile (<480px) unaffected — the cap is inert; scroll shell (`100dvh`/`min-height:0`/`overscroll`) untouched.
- **Premium preview (temporary, removable).** New `client/src/features/appearancePreview.ts` + an "Appearance" item in the ••• menu: switch **Wallpaper** (off / 1 / 2, self-contained CSS gradients with a contrast scrim) and **Message style** (Line ↔ Instagram-style **Bubbles** — mine right/accent, theirs left, keyed off `data-mine`). Remembered per device via localStorage. To remove later: delete the module, its ChatPage/MenuDropdown wiring, and the `/* PREVIEW */` CSS block.
- **Styling polish:** removed the brittle tick CSS and the duplicate `.chat__nav` rule.
Notes/deviations: Held the optional audit items (clientId-based optimistic dedup + message idempotency index, minor socket re-pin) — available if wanted. Read-marking still means "chat on screen" = seen (mark-all), which is acceptable for a single 1:1 conversation. Verified compile/build only; the read-dot flip and preview need a browser + two accounts (and migration 009) to confirm.

## [1.D polish] Search navigation (highlight + jump) + presence indicator — 2026-08-27
Status: done (client-only, builds clean)
What shipped:
- **Search is now useful** — instead of just opening a box, it highlights every message containing the query (substring, case-insensitive) with `<mark>`, shows a live `n/m` counter, and gives ▲/▼ arrows to jump between matches (▲ older, ▼ newer; Enter / Shift+Enter also step), scrolling each into view and emphasising the current one. Highlighting is built via DOM text nodes (no innerHTML) so message content stays XSS-safe. ✕ clears and closes.
- **Presence indicator** — the nav now shows **"in chat"** (green dot) vs **"away"** (grey dot) for the other person, not just a static "connected". Derived from their `last_read_at` heartbeat: since each side marks-read every ~4s while the chat is on screen, a reading within the last 15s means they're actually here. No new backend route — reuses `otherLastReadAt`.
Notes/deviations: **Presence and "Seen" both depend on the `/connections/:id/read` route being live on Railway.** Production is currently serving a stale backend (the leave + read routes 404), so until the backend is redeployed from `main`, presence will read "away" and ticks stay grey. Code + build verified; this is an infra redeploy, flagged to the user.

## [1.D/1.E polish] Tick placement, working "Seen", leave-flow OK button, in-chat Search — 2026-08-27
Status: done (builds clean; client-only, no migration; two accounts to verify)
What shipped:
- **Tick placement** — ticks sat at the far-right edge of the wide message body; moved them **inline right after the message text** (text is now `display:inline`, tick an inline-block sibling before the hidden full-timestamp). Reads right where the message ends.
- **"Seen" now actually flips to blue** — the receipt logic was correct, but the reader only marked-read on discrete events (connect / incoming socket message / focus), so an already-loaded message often never got marked. Now the reader **marks read continuously while the chat is visible** (poll-driven every 4s, `visibilityState==='visible'`) plus once at mount — self-healing, so the sender's tick reliably goes blue ✓✓. No backend change.
- **Leave flow** — the disabled "Next step available in ~24h" **button** did nothing; it's now **info text** and the action is a working **"OK"** button (advances the countdown when allowed, just returns during the 24h cooldown). Cancel/Keep connection unchanged. The acting user now **sees their own leave line in chat** ("You moved to leave — N days remaining") — leave step tracking moved to `sessionStorage` so the system line survives the navigate-to-Leave-and-back round trip.
- **Search works** — the ••• menu "Search" was inert; it now opens an in-chat search bar that live-filters the log to messages containing the query (date separators + system lines hidden while searching), with a ✕ to close. `mountMenuDropdown` takes an optional `onSearch`; ChatPage owns the filter.
Notes/deviations: Search is a client-side substring filter over loaded history (no server search) — fine for V1's single conversation. Continuous mark-read means while both are viewing, messages read as seen almost immediately (correct — both online + on-screen = seen).

## [1.D polish] WhatsApp-style read ticks (replaces "Seen" text) — 2026-08-26
Status: done (builds clean; needs migration 008 + two accounts to see live)
What shipped: The subtle grey "Seen" text under the last message was too quiet, so replaced it with per-message ticks on your sent messages: dim ✓ while sending, grey ✓ once delivered (saved server-side / echo received), blue ✓✓ once the other person has viewed it (their `last_read_at ≥ the message time`). Ticks live in the message body (right-aligned), recomputed on echo-confirm and on the 4s `/connections/current` poll. No backend change — reuses `otherLastReadAt` from the prior read-receipt work.
Notes/deviations: "Delivered" = reached the server (our model doesn't separately track the other device receiving it), so a single grey tick means saved+broadcast, not a device-level ACK. Removed the old `.chat__seen` element/CSS.

## [1.D/1.E/1.F polish] Instant messaging, read receipts, delete-on-leave, ID rotation, HTML export — 2026-08-26
Status: done (compiles + builds clean; **NOT runtime-tested** — needs migration 008 applied + two accounts)
What shipped:
- **Messaging feels instant** — root cause of the 15-20s first-message delay: the sender only saw their own message when the server's `message:new` echo returned (full round-trip, worst on a cold Railway/Supabase first hit), and `connectMessaging()` was awaited *before* the chat rendered (a flaky first handshake bounced the user to connection-id — the "not going through"). Fix in `ChatPage`: **optimistic local echo** (message renders immediately, dim until the echo confirms, reconciled by content match — no duplicate), chat **renders before the socket connects** (never blocks/bounces), and messages typed pre-connect are **queued and flushed on connect**. Failed sends get a subtle "· not sent" and retry on reconnect.
- **Enter / iOS send** — composer is now a `<form>` with `enterkeyhint="send"`; submit handles both desktop Enter and the iPhone keyboard's Go/Send key (was a manual keydown listener that iOS didn't reliably fire).
- **Read receipts ("Seen")** — subtle "Seen" under your latest message once the other person has viewed it; no ticks, no color-shifting `>` (user rejected that). New `connection_members.last_read_at` (migration `008_last_read.sql` — **apply to Supabase**), `POST /connections/:id/read` (marked on open, on receiving, on window focus), `getCurrentConnection` returns `otherLastReadAt`, "Seen" recomputed on the 4s poll.
- **Delete on termination** — `terminate()` now **deletes the `connections` row** instead of flipping status; `on delete cascade` wipes `connection_members` + `messages`. Both users freed, nothing retained (they export first).
- **Regenerate connection ID** — one-tap "Get a new ID" on the ID screen (`POST /me/connection-code/regenerate`); old ID stops resolving. For when a code gets shared too widely. Never affects an existing connection (those run off user ids).
- **HTML export** — added alongside TXT/JSON: a self-contained, readable left/right-layout HTML document (escaped). `ExportPage` now offers HTML (primary) / TXT / JSON.
Notes/deviations: The 15-20s tail on the *receiver* side (and slow first load) is Railway/Supabase cold-start — code changes make sending feel instant and stop the bounce-out, but a fully warm first receive needs an infra keep-warm (flagged, not done). Read receipts + leave state + termination all ride the single 4s `/connections/current` poll — deliberately kept off the message `Transport` (they're connection state, not messages). Verified compile + build only; needs migration 008 + two accounts to confirm runtime.

## [1.E] Leave/termination lifecycle + mobile scroll fix + nickname placeholder — 2026-08-26
Status: done (compiles + builds clean; **NOT runtime-tested** — needs migration 007 applied + two accounts)
What shipped:
- **Stage E leave lifecycle** — reconciled model confirmed with user, **overrides spec §25's passive auto-expire**: a deliberate, solo-completable **5-step countdown**, one step per 24h (server-gated). Per-member progress on `connection_members.leave_step` / `leave_last_step_at` (migration `007_leave_progress.sql` — **must be applied to Supabase manually**, like prior migrations). Backend `connectionService`: `advanceLeave` (24h-gated; own step→5 terminates solo, no agreement needed), `cancelLeave` (step→0; both cleared ⇒ back to active), `confirmEndLeave` (mutual fast-path when both leaving). Routes: `POST /connections/:id/leave`, `/leave/cancel`, `/leave/confirm-end`. `getCurrentConnection` now returns `myLeaveStep`/`otherLeaveStep`/`daysRemaining`/`bothLeaving`/`canAdvanceLeave` (replaced vestigial `leaveRequestedByMe`/`leaveRequestedAt`).
- **Frontend** — real `LeavePage` (advance / keep / mutual "This conversation is going to end. Do you want to leave it?"). `ChatPage` polls `/connections/current` every 4s: red leave banner ("You're leaving — N days remaining" / "{name} is leaving…" / both-leaving), live in-chat **system lines** on each transition, and auto-routes to connection-id when the connection terminates. Leave stays connection-state (polled), deliberately NOT routed through the message `Transport`.
- **Mobile scroll jank fix** (groundwork before Android): the shell was double-`100vh` (`#app` + `.chat`) with a flex scroll child lacking `min-height:0`, no `overscroll-behavior`, and <16px inputs → page pan + rubber-band + iOS focus-zoom. Fixed in `global.css` (locked non-scrolling shell, `100dvh`, `overscroll-behavior: contain/none`, `min-height:0` on flex scroll containers, 16px inputs on mobile, safe-area input padding) + `viewport-fit=cover`.
- **Nickname placeholder** `Arjun` → `Type a nickname`.
- **Premium features foundation** written into the master plan (Phase 2P): chat wallpapers, custom wallpaper upload, opt-in Instagram-style left/right bubbles — **plan only, not built**, with the cheap V1 seams noted (appearance-prefs model, single message-render path, wallpaper layer). Default stays the §16 no-bubble terminal aesthetic.
Notes/deviations: Design decision recorded — solo exit is the anti-trap guarantee (user picked it over §25 as-written and over strict-mutual). System leave events are shown as live state, NOT persisted message rows (keeps the hot `messages` table/RLS/export untouched) — trade-off: leave events aren't in the export. I can verify compile/build only; the 24h gate, termination, and two-way system lines need the migration applied and a second account to test.

## [1.D + bug fixes] Real-time chat, request-lock, empty chat — 2026-08-26
Status: done (verified end-to-end via real active connection)
What shipped: Stage D real messaging over Socket.IO with the transport abstraction (spec §22): client `services/transport/Transport.ts` (interface) + `InternetTransport.ts` (Socket.IO impl) + `messageService.ts` (factory — the only place that names a concrete transport). Backend: `websocket/socketServer.ts` (JWT-auth handshake, pins the user's live connection server-side, `message:send` → validate membership+state → persist → broadcast `message:new` to the connection room), `services/messageService.ts` (getHistory/saveMessage, re-verifies membership on every write per §20), `routes/messages.ts` (GET history), HTTP server now created explicitly so Socket.IO can attach. `/api/me` and current-connection now return the app `userId`/`myUserId` so the client can tell YOU from the other sender.
Bug fixes from user report: (1) removed all fake seed messages — chat starts empty; (2) send actually sends now (was a no-op) — real bidirectional delivery verified: sent a message, confirmed persist + broadcast echo + history reload; (3) recipient no longer stuck able to fire a duplicate request — ConnectionIdPage now polls and auto-routes to the request/chat screen when connection state changes. Also implemented real TXT/JSON export (was referencing the deleted fake data) and Enter-to-send.
Notes/deviations: Verified against the real active connection left from the user's earlier friend test (my user ↔ ARFAH). Broadcast is `io.to(room).emit`, so the other member receives identically to the sender's own echo (which I confirmed). Message content and nicknames now rendered via textContent (no HTML injection). NOT yet built: Stage E leave/termination is still a UI-only stub — the "Leave connection" menu item shows a fake "request sent" screen and does not actually end the connection server-side. Flagged for the user; it's the next stage.

## [1.B.2 + 1.C] Real database, users, connection system — 2026-08-26
Status: done (pending two-account test)
What shipped: 4 tables live in Supabase (`users`, `connections`, `connection_members`, `messages`) via manual SQL Editor run (direct `db.*.supabase.co` connection is IPv6-only and unreachable from this dev network — `pg`/`migrate.ts` kept for environments that can reach it, e.g. Railway may work; local dev applies migrations manually for now). Single-active-connection enforced by a DB trigger (spec §19), not just app logic. Backend: `database/supabaseAdmin.ts` (service-role client, HTTPS-based — sidesteps the IPv6 issue entirely for runtime queries), `services/userService.ts` (get-or-create user + connection code on first login), `services/connectionService.ts` (request/accept/decline, nickname — nicknames are stored on the *other* member's row since I set what I call them, not what I call myself, per spec §11), routes mounted at `/api/me` and `/api/connections/*`, all behind `requireAuth` (verifies Supabase JWT via `supabaseAdmin.auth.getUser`). Client: `connectionsApi.ts`, real ConnectPage/ConnectionRequestPage/NicknamePage/ChatPage wired to the backend, new WaitingPage (requester's pending view, polls every 2.5s), `main.ts` boot now resolves the real screen from connection state instead of a hardcoded default. Router got a cleanup-callback mechanism so polling pages clear their interval on navigation.
Notes/deviations: Verified end-to-end — real login → real generated Connection ID (`VN9SYUY`) → own-ID rejection → not-found rejection, all through the actual UI, no console errors. Have NOT verified the accept/decline path since it needs a second real account — that's the next thing to test with your friend. `client/package.json`/`backend/package.json` also picked up `@supabase/supabase-js`, `pg`, `cors` from npm installs along the way.

## [1.B.1] Supabase Auth wired (Google OAuth) — 2026-08-26
Status: done
What shipped: `@supabase/supabase-js` client (`services/supabaseClient.ts`), `services/authService.ts` (signInWithGoogle, getSession, onAuthStateChange), LoginPage now triggers real Google OAuth via Supabase instead of faking navigation, `main.ts` checks for an existing session on boot and routes signed-in users past login. Split env files: `client/.env` (VITE_SUPABASE_URL/ANON_KEY) and `backend/.env` (SUPABASE_URL/SERVICE_ROLE_KEY/DATABASE_URL) — removed the old root-level `.env`. Also renamed `server/` → `backend/` to match the Railway project's configured root directory.
Notes/deviations: Verified end-to-end up through Google's real consent screen (correct redirect_uri pointing at Supabase's callback, correct redirect_to back to localhost) — did not complete an actual sign-in myself, since that requires the user's Google credentials. User to test a real login themselves before 1.B.2 (users table + real Connection ID generation) starts, so there's an authenticated user to build against.

## [1.A] Visual prototype (fake data, no backend) — 2026-08-26
Status: done
What shipped: Full click-through prototype — Login, Connection ID (generated fake ID + copy), Connect, Connection Request (accept/decline), Nickname, Chat (date separators, no-bubble line format, color-coded sender names, click-to-expand full timestamp), top-nav ••• menu, Export screen, Leave/termination flow (request + pending state). Router (`state/router.ts`) is a minimal registered-page map, no framework. Design tokens (colors, font) in `styles/global.css`, mobile responsive breakpoint at 480px.
Notes/deviations: Verified by scripting clicks through the full flow and asserting rendered text/DOM state (screenshots from the browser tool were unreliable — cropped past ~1050px of the 1280px viewport, a tool quirk, not confirmed as an app bug via getBoundingClientRect checks). Export TXT/JSON buttons are inert (real export logic is Stage F). Search menu item is disabled (later feature per spec §27).

## [0.2] Client + server tooling init — 2026-08-26
Status: done
What shipped: `client/` — Vite + vanilla TS scaffold (package.json, tsconfig.json, index.html, src/main.ts), boots on `npm run dev` (verified HTTP 200 on :5173). `server/` — Node + TS + Express (package.json, tsconfig.json, src/index.ts with `/health` route), boots on `npm run dev` via tsx watch (verified `{"status":"ok"}` on :3000). `shared/` left empty for now, populated starting Stage B when auth/connection types exist.
Notes/deviations: Kept both minimal — no demo boilerplate (Vite's counter/assets), no Socket.IO yet (belongs to Stage 1.D.1 per plan), no Supabase client wiring yet (Stage B).

## [0.3] Env setup + secrets fix — 2026-08-26
Status: done
What shipped: User provided Supabase credentials. Real secrets had been pasted into `.env.example` (not gitignored) — moved to `.env` (gitignored, confirmed via `git check-ignore`), replaced `.env.example` with placeholder-only template. Never committed/pushed, no rotation needed. GitHub remote confirmed: https://github.com/aarahman04/One-on-One.git. Accent colors picked (YOU #7EE787 green, other #79C0FF cyan, bg #0D1117).
Notes/deviations: Google Cloud OAuth + Railway/Vercel setup deferred to Stage B / Stage H respectively.
(Note: 0.3 was actually completed before 0.2 within this session — env/secrets fix happened first, tooling init followed.)

## [0.1] Project scaffold + CLAUDE.md + docs — 2026-08-26
Status: done
What shipped: Repo directory structure (client/server/shared/database/docs), merged user's CLAUDE.md template with project-specific rules, created this progress log and docs/ARCHITECTURE.md.
Notes/deviations: none.
