# Architecture

Diagrams updated as the system grows. Additive — don't rewrite existing diagrams from scratch when a phase adds structure, extend them.

## System architecture (V1)

```mermaid
graph TD
    Client["Web Client<br/>HTML/CSS/TS + Vite"]
    Server["Railway<br/>Node + Express + Socket.IO"]
    DB["Supabase<br/>Auth + Postgres + RLS"]

    Client -- "HTTPS / WSS" --> Server
    Server -- "SQL" --> DB
```

## Message flow (V1)

```mermaid
sequenceDiagram
    participant You
    participant Server as Railway Backend
    participant DB as Supabase Postgres
    participant Other as Other User

    You->>Server: send message (WebSocket)
    Server->>Server: authenticate + verify connection membership
    Server->>DB: persist message
    Server-->>You: authoritative message record
    Server-->>Other: authoritative message record
```

**Message types (since 2026-08-27):** a message carries `type` ('text' | 'letter' | future 'voice') + `payload` (jsonb) alongside `content`. The whole pipeline (`saveMessage` → socket → `Transport.sendMessage(content, type?, payload?)` → `IncomingMessage`/`HistoryMessage` → `appendMessage`) threads these additively, so new types don't re-plumb the flow. **Letters:** body in `content`, `{ appearance, from, to }` in `payload`; rendered as a folded card that opens a styled letter (downloadable as HTML). **Slash commands** (`/letter`, `/shrug`, …) live client-side in `features/slashCommands.ts` — `/letter` is the only one that produces a special message.

**Replies (since 2026-08-27):** `messages.reply_to` (nullable FK to `messages.id`, `on delete set null`) rides the same pipeline — `Transport.sendMessage`'s optional 4th arg, threaded through `saveMessage`/socket/`IncomingMessage`/`HistoryMessage`. The backend re-validates the reply target is a real message in the same connection before storing (never trusts the client id, spec §20). Client-side, `ChatPage.ts` keeps an in-memory `messagesById` map (populated as messages render) to resolve a `reply_to` id into a "sender + snippet" quote block without a re-fetch. Triggering a reply: phone = right-swipe a row; desktop = right-click a row for a small context menu (`.chat__ctx-menu`, via a shared `openPopover()` helper) — the same menu reactions extend with a second "React" item.

**Reactions (since 2026-08-27, overrides spec §29's V1 non-goals — user-confirmed):** a separate `reactions` table (`message_id`, `user_id`, `emoji`, unique per triple) rather than piggybacking on `messages.payload`, since a message can carry many reactions from either member independent of who sent it. Not on the `Transport.sendMessage` path — a parallel `sendReaction`/`onReaction` pair on `Transport`, backed by socket events `reaction:add`/`reaction:remove` → broadcast `reaction:update`. `getHistory` attaches an aggregated `{emoji, userIds}[]` per message (via `reactionService.getReactionsForMessages`); live updates apply to an in-memory `reactionsByMessage` map and re-render just that message's chip row. Triggering: phone = long-press a row (opens a 6-emoji picker at the touch point); desktop = the reply context menu's "React" item opens the same picker.

## Connection state machine

```mermaid
stateDiagram-v2
    [*] --> pending: request sent
    pending --> active: accepted
    pending --> declined: declined
    active --> leave_pending: a member advances leave (step 1)
    leave_pending --> active: all leavers cancel (steps back to 0)
    leave_pending --> terminated: a member's own step reaches 5 (solo) OR both leaving + confirm-end
    terminated --> [*]
```

Leave model (Stage E) overrides spec §25's passive auto-expire: it is a deliberate, **solo-completable 5-step countdown**, one step per 24h (server-gated), tracked per-member on `connection_members.leave_step` / `leave_last_step_at`. Silence keeps the connection; a member can always exit alone by completing their own 5 steps; when both are leaving, either can `confirm-end` immediately. Chat reflects leave state via a banner + system lines by polling `/connections/current` (leave is connection state, deliberately kept out of the message `Transport`).

**Termination deletes the conversation**: reaching `terminated` deletes the `connections` row, which cascades (`on delete cascade`) to `connection_members` and `messages` — nothing is retained server-side. Participants export (TXT / JSON / HTML) before leaving; the data is theirs. Read receipts: `connection_members.last_read_at`; a sender's message is "Seen" once the other member's `last_read_at ≥ its created_at`, surfaced via the same `/connections/current` poll.

## Client appearance (V1, since 2026-08-27)

Client-only, no new data flow — `features/appearancePreview.ts` persists `{ wallpaper, style, theme }` to localStorage and toggles classes/attributes on `.chat` (`applyAppearance`), read by CSS in `styles/global.css`. Bubbles is the default `style`; `theme` (light/dark) only affects bubble-mode colors via `--bubble-mine-*`/`--bubble-other-*` custom properties, scoped under `.chat--bubbles[data-theme='light']`. `wallpaper: 'love'` serves `client/public/love.jpg` (Vite's static dir) and further overrides the bubble palette (colors pulled from the artwork's own palette) so bubbles read against the art. The composer (`ChatPage.ts`) is a `<textarea>`, not `<input>`, so messages can carry blank-line paragraph gaps; `utils/linkify.ts` turns URLs/phone numbers into `<a>`/`tel:` links via text-node splitting (same XSS-safe pattern as the existing search highlighter).

## Transport abstraction

Load-bearing for V3/V4 — every client message path routes through this, not directly through Socket.IO.

```mermaid
graph TD
    ChatScreen --> MessageService --> Transport
    Transport --> InternetTransport["InternetTransport (V1, implemented)"]
    Transport -.-> BluetoothTransport["BluetoothTransport (V3, future)"]
```
