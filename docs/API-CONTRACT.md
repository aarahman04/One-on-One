# API Contract (backend as of main @ 57e9a30)

Source of truth for the native Android app (and any other client). **Derived only from the backend code** (`backend/src/index.ts`, `routes/*.ts`, `services/*.ts`, `websocket/socketServer.ts`, `middleware/*.ts`); where behaviour is not visible in code it is not described. File references are given so a disagreement can be settled by reading the code.

Conventions
- Base URL: the Railway deployment origin (client reads `VITE_API_URL`). All REST routes are under `/api`, except `GET /health`.
- JSON in/out. `express.json({ limit: '32kb' })` applies to every route except the attachment upload.
- Timestamps are ISO-8601 strings (Postgres `timestamptz` / `Date.toISOString()`).
- Ids (`userId`, `connectionId`, message ids) are UUID strings. **`userId` is the app user id (`users.id`), not the Supabase auth uid.**
- Errors, REST: `{ "error": "<message>" }` with the HTTP status. Domain errors (`ConnectionError`) carry their own status; anything else is `500 {"error":"internal server error"}`.
- Errors, Socket.IO acks: `{ "error": "<message>" }` (domain message, or a generic fallback such as `failed to send message`; raw DB errors are never exposed).

---

## 1. Authentication

1. Sign in with Supabase Auth, provider Google. The web client uses `signInWithOAuth`; the native Capacitor app gets a Google ID token from Credential Manager and calls `supabase.auth.signInWithIdToken({ provider: 'google', token: idToken, nonce: rawNonce })`. The ID token must be requested with the Google **Web** OAuth client id as audience (`628827083956-au0n92v35p0un0kob10254j7rhc0tcft.apps.googleusercontent.com`, from `client/src/services/nativeGoogleAuth.ts`) and `nonce = sha256Hex(rawNonce)`; Supabase is given the raw nonce.
2. The result is a Supabase session. The **Supabase access token (JWT)** is the only credential the backend accepts.
3. REST: `Authorization: Bearer <access_token>`. Socket.IO: `auth: { token: <access_token> }` in the handshake.
4. The backend verifies the token with `supabaseAdmin.auth.getUser(token)` and then get-or-creates the app user row (first authenticated request creates the user and its 8-char connection code). Results are cached per token for up to 15 s (never past the token's `exp`). Refresh the token client-side; the socket handshake uses a callback so reconnects get a fresh token.
5. Failures: `401 {"error":"missing bearer token"}` (no/odd Authorization header), `401 {"error":"invalid or expired token"}`.

---

## 2. REST routes

All routes below require auth unless stated. "Live" = connection status `active` or `leave_pending`.

### Health
| | |
|---|---|
| `GET /health` | No auth, not under `/api`. `200 {"status":"ok"}` |

### Me (`routes/me.ts`)
| Route | Request | Success | Errors |
|---|---|---|---|
| `GET /api/me` | – | `200 {userId, connectionCode}` | 401 |
| `POST /api/me/connection-code/regenerate` | – | `200 {connectionCode}` (new 8-char code; existing connection unaffected) | 401 |
| `DELETE /api/me` | – | `204`. Deletes the Supabase auth user; cascades all app data. Best-effort deletes current connection's attachments first. | 401, 500 |
| `GET /api/me/blocks` | – | `200 {blocks: [{blockedUserId, createdAt}]}` newest first | 401 |
| `DELETE /api/me/blocks/:blockedUserId` | – | `204` (only removes the caller's own outbound block) | 401 |

Connection code alphabet: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, length 8.

### Connections (`routes/connections.ts`)

`Connection row` (returned by request/cancel/accept/decline) is the raw `connections` table row, snake_case: `id, user_a_id, user_b_id, status, created_at, updated_at, wallpaper, message_style` (legacy leave columns were dropped in migration 020) (`status` in `pending|active|leave_pending|terminated|declined`). `user_a_id` is the requester, `user_b_id` the recipient.

`CurrentConnection` (camelCase):
```
{ id, status, myUserId, isRequester, otherNickname|null,
  otherConnectionCode ("" unless status=pending),
  myLeaveStep, otherLeaveStep, daysRemaining|null, bothLeaving, canAdvanceLeave,
  otherLastReadAt|null, otherLastDeliveredAt|null,
  wallpaper ("off"|"love"|"samurai"), messageStyle ("line"|"bubbles") }
```
Statuses `pending`, `active`, `leave_pending` are returned. `otherNickname` is what **I** call the other person.

| Route | Body | Success | Errors |
|---|---|---|---|
| `GET /api/connections/current` | – | `200 {connection: CurrentConnection \| null}` | |
| `POST /api/connections/request` (strict limiter) | `{connectionCode}` (trimmed, upper-cased) | `201 {connection: Row}` | 400 `connectionCode is required` / `that's your own connection ID`; 404 `couldn't send a request to that connection ID` (unknown code, blocked pair, or target busy: deliberately indistinguishable); 409 `you already have an active or pending connection` / `connection already exists`; 429 |
| `POST /api/connections/:id/cancel` | – | `200 {connection: Row}` (status -> `declined`; requester only) | 403 `only the requester can cancel`; 404; 409 `connection is no longer pending` |
| `POST /api/connections/:id/accept` | – | `200 {connection: Row}` (-> `active`; recipient only) | 403 `only the recipient can accept`; 404; 409 |
| `POST /api/connections/:id/decline` | – | `200 {connection: Row}` (-> `declined`; recipient only) | 403; 404; 409 |
| `PATCH /api/connections/:id/nickname` | `{nickname}` 1-40 chars after trim | `204`. Sets what the caller calls the OTHER member (stored on the other member's row). Needs live. | 400 `nickname must be 1-40 characters`; 403; 404; 409 `connection is not active` |
| `POST /api/connections/:id/leave` | – | `200 {leave: LeaveResult}`. Advances MY leave countdown one step; allowed once per 24 h; step 5 terminates solo. Emits socket `connection:ended` if terminated. Needs live. | 403; 409; 429 `you can advance the countdown once every 24 hours` / `the countdown was already advanced` |
| `POST /api/connections/:id/leave/cancel` | – | `200 {leave}` (my step -> 0; connection -> `active` if the other isn't leaving either) | 409 `no leave in progress` |
| `POST /api/connections/:id/leave/confirm-end` | – | `200 {leave}`; terminates immediately; emits `connection:ended` | 409 `no leave in progress` / `both members must be leaving to end immediately` |
| `PATCH /api/connections/:id/wallpaper` | `{wallpaper: "off"\|"love"\|"samurai"}` | `204` (shared by both). If it changed, a debounced (1.5 s) `system` message is broadcast. Needs live. | 400 `invalid wallpaper` |
| `PATCH /api/connections/:id/style` | `{style: "line"\|"bubbles"}` | `204`, same notice behaviour | 400 `invalid message style` |
| `POST /api/connections/:id/block` | – | `204`. Records a permanent block, terminates the connection, emits `connection:ended`. Needs live. | 403; 409 |
| `POST /api/connections/:id/report` (strict) | `{category?, reason?}` | `204` (person-level report; duplicate = success). Works even after the connection ended for former members. | 403 |
| `POST /api/connections/:id/read` | – | `204`. Sets my `last_read_at = now`; pushes socket `receipt:update` to the other member. Needs live. | 403; 409 |

`LeaveResult = { status, myLeaveStep, daysRemaining|null, bothLeaving, terminated }`. There are 5 leave steps (`LEAVE_STEPS_TOTAL`), `daysRemaining = 5 - myLeaveStep`. Terminating **deletes the connection, its messages and its attachments**.

Report `category` is one of `harassment|hate|sexual|child_safety|spam|other` (any other string is stored as `other`; non-string = null). `reason` is trimmed, max 1000 chars.

### Messages (`routes/messages.ts`)
| Route | Notes |
|---|---|
| `GET /api/connections/:id/messages?before=<createdAt>&after=<createdAt>` | Needs live membership. Page size 50. No cursor: newest 50, returned oldest-first. `before`: the 50 newest older than that created_at (paging back). `after`: the 50 OLDEST newer than that created_at, oldest-first (reconnect resync; page forward until fewer than 50). `200 {messages: Message[]}`. Media payloads here carry `path` but **no `url`**: sign via the attachments endpoint. Errors 403/404/409. |
| `POST /api/messages/:id/report` (strict) | Body `{category?, reason?}` (same rules as above). `204`; duplicate = success. Works for a former member of a now-ended connection. Errors 403, 404 `message not found`. |

### Attachments (`routes/attachments.ts`)
| Route | Notes |
|---|---|
| `POST /api/connections/:id/attachments?kind=image\|voice\|file` (strict) | Body: **raw bytes**, `Content-Type` = the file's MIME (not JSON; limit 26 MB at the parser). Needs live. `201 {path, mime, size}` where `path = "<connectionId>/<uuid>.<ext>"`. Errors: 400 `invalid attachment kind` / `missing upload body` / `unsupported <kind> type` / `empty upload` / `<kind> exceeds size limit`. |
| `POST /api/connections/:id/attachments/signed` | Body `{paths: string[]}`; every path must start with `<connectionId>/` else `403 attachment does not belong to this connection`. Needs live. `200 {urls: {<path>: <signedUrl>}}`. Signed URLs are valid **3600 s**; paths that fail to sign are simply absent. |

Limits (kind -> max bytes, MIME -> stored extension):
- `image` 10 MiB: `image/jpeg`, `image/png`, `image/webp`, `image/gif`
- `voice` 16 MiB: `audio/webm`, `audio/mp4`, `audio/ogg`, `audio/mpeg`
- `file` 25 MiB: `application/pdf`, `text/plain`, `text/csv`, `application/msword`, docx, `application/vnd.ms-excel`, xlsx, `application/vnd.ms-powerpoint`, pptx (OOXML MIME types)

Flow: upload -> take `{path, mime, size}` -> send a `message:send` of type image/voice/file with that payload plus type-specific fields (section 4). The bucket is private; there is no durable URL.

### Push registration (`routes/push.ts`)
| Route | Body | Result |
|---|---|---|
| `POST /api/push/subscribe` (strict) | `{endpoint, keys:{p256dh, auth}}` web-push; endpoint must be https on googleapis.com / push.services.mozilla.com / notify.windows.com / push.apple.com | `204`; 400 `invalid subscription` / `invalid push endpoint` / `push endpoint must be https` / `unsupported push endpoint` |
| `POST /api/push/unsubscribe` | `{endpoint}` | `204`; 400 `invalid endpoint` |
| `POST /api/push/token` (strict) | `{token, platform?}` FCM registration token (opaque string). `platform` optional, `"android"` (default; the Capacitor app) or `"android-native"` (the Kotlin app) | `204`; 400 `invalid token` / `invalid platform`. Upserts on `token` (moves it to the caller if it was registered to someone else; re-registering with a different platform updates it). Requires migration 035 for the DB check constraint. |
| `POST /api/push/token/unregister` | `{token}` | `204`; 400 `invalid token`. Deletes only the caller's own row. |

### TURN (`routes/turn.ts`)
`GET /api/turn-credentials` -> `200 {iceServers: IceServer[]}` where `IceServer = {urls: string|string[], username?, credential?}`. Cloudflare TURN credentials, TTL 120 s, cached server-side 30 s; falls back to `[{urls:'stun:stun.cloudflare.com:3478'}]` when TURN is unconfigured or the vendor fails. Any authenticated user may call it. The same list is also returned in the acks of `call:invite` and `call:accept`.

---

## 3. Rate limits

REST (express-rate-limit, per client IP, `trust proxy` = 1; `RateLimit-*` draft-7 headers):
- All `/api`: 240 requests / 60 s -> `429 {"error":"too many requests — slow down"}`
- "strict" routes: 10 / 60 s each -> `429 {"error":"too many requests — try again in a minute"}`. Applied to: `POST /connections/request`, `POST /connections/:id/report`, `POST /messages/:id/report`, `POST /push/subscribe`, `POST /push/token`, attachment upload.

Socket.IO (in-memory, per socket unless stated):
- Any event except `call:signal`: more than 60 events in 10 s -> ack `{error:'slow down'}`
- `call:signal`: 250 events / 10 s
- Alarm **raise** (type `alarm` without `payload.ack`): one per user per 3 min -> `{error:'wait a bit before sending another alarm'}` (acks/cancels exempt)
- `call:invite`: one per user per 5 s -> `{error:'wait a moment before calling again'}`
- Ring timeout 45 s; `message:send` idempotency memory 5 min.

---

## 4. Messages

### Message object (REST history, `message:new`, send acks)
```
{ id, senderId, content, createdAt, type, payload|null, replyTo|null,
  reactions: [{emoji, userIds: string[]}] }
```
`message:new` and the `message:send` ack additionally carry `tempId?` (echo of the sender's tempId). Content and payload are encrypted at rest and always plaintext on the wire.

### Types and validators (`messageService.ts`)
`MessageType = text | letter | voice | image | file | ask | countdown | checkin | thisorthat | alarm | call | location | system`

`content` rules: for `voice|image|file` (caption), `alarm`, `call`, `system`: may be empty, max 4000 after trim. All other types: 1-4000 after trim. Content is trimmed.

`replyTo` (optional, any type): must be a message in the same connection (`400 reply target not found in this connection`) and not a `system` message (`400 cannot reply to a system message`).

| type | `payload` (client-sent) | `content` | notes |
|---|---|---|---|
| `text` | none (ignored, stored null) | the text | |
| `letter` | `{appearance:"dawn"\|"botanical", from: 1-40, to: 1-40}` | letter body | |
| `image` | `{path, mime, size, width, height}`; path must start `<connectionId>/`; mime in image allowlist; `1<=size<=10MiB`; width/height integers 1-20000 | caption (optional) | |
| `voice` | `{path, mime, size, duration}`; mime in voice allowlist; `size<=16MiB`; `0<duration<=3600` (seconds) | caption (optional) | |
| `file` | `{path, mime, size, name}`; mime in file allowlist; `size<=25MiB`; `name` 1-255 | caption (optional) | |
| `ask` | `{question 1-300, answerA 1-500, answerB? 1-500}` | the question (required) | |
| `countdown` | `{label 1-100, targetIso: valid date}` (stored as ISO) | the label (required) | |
| `checkin` | `{mood: great\|good\|okay\|down\|struggling, note 1-300}` | the note (required) | |
| `thisorthat` | `{optionA 1-100, optionB 1-100, pickSender:"a"\|"b", pickRecipient?:"a"\|"b"}` | e.g. "A vs B" (required non-empty) | |
| `alarm` | raise: none. ack: `{ack:<raise message id>}`. cancel: `{ack:<raise id>, cancelled:true}` | empty | see alarm rules below |
| `location` | `{lat -90..90, lng -180..180, accuracy? >=0}` | non-empty display string, e.g. "lat, lng" | |
| `call` | **server-authored only**: `{kind:"audio"\|"video", outcome:"missed"\|"declined"\|"cancelled"\|"completed"\|"failed"\|"unreachable", durationSec>=0}` | empty | `senderId` = the caller. Client send rejected: `call messages are server-authored` |
| `system` | **server-authored only**: `{event:"wallpaper"\|"style", value}` (wallpaper: off/love/samurai; style: line/bubbles) | empty | Client send rejected: `system messages are server-authored` |

Failure message for a bad payload is `400 <specific text above>` (socket ack `{error}`); an unknown `type` sent by a client is silently treated as `text`.

Broadcast difference: on `message:new` and the send ack, image/voice/file payloads additionally carry a signed `url` (best-effort). History responses do not.

#### Alarm rules (PR #91 `fix/alarm-ack-id` — NOT yet on main at the time of writing; on main today an ack with a missing/invalid id is simply rejected with 400 `invalid alarm acknowledgement`)
An ack/cancel must reference an existing alarm **raise** in the same connection; `cancelled:true` only by the raiser, plain ack only by the other member; rejected if the raise is older than 2 min; a repeat for an already-acked raise returns the existing ack (`{ok:true, duplicate:true, message}`) with no save/broadcast/push. Clients should set `replyTo` to the raise id on acks.

---

## 5. Socket.IO

Server: Socket.IO v4 on the same origin as REST (default path `/socket.io`). CORS allows the origins in `CLIENT_ORIGIN` plus `https://localhost`; non-browser clients (native) do not send an Origin and are not subject to it.

### Handshake
`io(API_URL, { auth: { token: <supabase access token> } })`. Middleware verifies the token, resolves the app user and the user's live connection. Failure -> `connect_error` with message `missing token` or `invalid or expired token`.

On connect: if the user has a live connection the socket joins room `conn:<connectionId>`, the server sets the user's `last_delivered_at` (-> sender's tick becomes "delivered", `receipt:update` emitted to the other member's sockets), and if a call is ringing for this user the server re-emits `call:incoming` to this socket. **A socket opened before the connection exists is not in the room until it reconnects, or until its first `message:send`** (the handler joins lazily); reconnect after a connection becomes active.

Every handler re-resolves the live connection from the DB; the client never names a connection or a peer. Acks: `{ok:true, ...}` or `{error}`. Common errors: `slow down`, `no active connection`.

### Client -> server
| Event | Payload | Ack |
|---|---|---|
| `message:send` | `{content?: string, type?: MessageType, payload?, replyTo?: string, tempId?: string}`; `tempId` must match `^[A-Za-z0-9-]{1,64}$` (else treated as absent) | `{ok:true, message}` ; repeat of the same `(user, tempId)` within 5 min -> `{ok:true, duplicate:true, message:<original>}` and nothing is saved/broadcast again; concurrent duplicate -> `{error:'send already in progress'}`. Errors listed in section 4. The server also `message:new`-broadcasts to the room (sender included) and bumps the sender's last_read. |
| `reaction:add` | `{messageId, emoji}` | `{ok:true}`. Emoji must be one of `❤️ 👍 😂 😮 😢 🙏`. One reaction per user per message (a new emoji replaces the old). `system` messages can't be reacted to. Errors: `invalid emoji`, 403/404/409 messages. |
| `reaction:remove` | `{messageId, emoji}` | `{ok:true}` |
| `call:invite` | `{kind?: "audio"\|"video"}` (anything else = audio) | `{ok:true, callId, iceServers}`. Errors: `a call is already in progress on this connection` (409); if the callee has no live socket **and no `android-native` push token**: `They're not reachable right now — they'll see that you called` (an `unreachable` call row is written and a text push is sent; no ring). If the callee has a native token the call rings normally (state is held server-side; the woken app reconnects and gets `call:incoming` replayed) and a data-only `call` FCM is sent (section 6). |
| `call:accept` | `{callId}` | `{ok:true, iceServers}`; errors `call is no longer active`, `not the callee` |
| `call:decline` | `{callId}` | `{ok:true}`; same errors |
| `call:signal` | `{callId, data}` opaque SDP/ICE, relayed untouched to the other participant's sockets only | `{ok:true}`; errors `call is no longer active`, `not a participant in this call` |
| `call:end` | `{callId}` | `{ok:true}` (no-op if the call already ended) |

Call state is in memory (one call per connection). Outcomes: `end` by caller before accept = `cancelled`, by callee before accept = `declined`, after accept = `completed`; no answer in 45 s = `missed`. The server writes the `call` message row on every resolution. A "missed/cancelled" resolution sends the callee a text push (title = caller nickname, body `Missed voice call` / `Missed video call`).

### Server -> client
| Event | Payload | When |
|---|---|---|
| `message:new` | Message + `tempId?` | every saved message in the room, to both members including the sender |
| `receipt:update` | `{userId, lastReadAt?, lastDeliveredAt?}` | sent to the OTHER member's sockets when `userId` marks read / delivered |
| `reaction:update` | `{messageId, emoji, userId, op:"add"\|"remove"}` | to the room |
| `connection:ended` | none | to the room when the connection is terminated (leave final step, confirm-end, block) |
| `call:incoming` | `{callId, kind, fromUserId}` | to the callee's sockets; also replayed on (re)connect while ringing |
| `call:accepted` | `{callId}` | to the whole room (so the callee's other devices drop their prompt) |
| `call:signal` | `{callId, data}` | to the other participant |
| `call:ended` | `{callId, reason}`; reason in `missed\|declined\|cancelled\|completed\|failed\|unreachable` | to the room |

Receipt semantics: a message is "delivered" when the other member's `lastDeliveredAt >= createdAt`, "seen" when `lastReadAt >= createdAt` (clients compute this from `CurrentConnection.otherLast*At` and `receipt:update`).

---

## 6. Push notifications

Server sends to every web-push subscription and every FCM token the recipient registered (`push_tokens`). Triggers:
- New message from the other member. If the recipient has **no live socket in the room**: web-push + FCM. If they do have one: the message is marked delivered and **FCM only** (a backgrounded Capacitor WebView keeps its socket alive). Web-push is never sent in the online case.
- Missed/cancelled call (text push, both transports, see section 5).
- Never pushed for: `call` / `system` rows written by the server, nor `declined`/`completed` calls.

Title = what the recipient calls the sender (nickname) or `New message`. Body (`mediaNoticeFor`): text types -> the first 120 chars of `content`; `letter` -> `sent you a letter`; `image` -> `sent you a photo`; `voice` -> `sent you a voice message`; `file` -> `sent you a file`; `location` -> `shared their location` (never coordinates); alarm raise -> `🚨 sent an emergency alarm`; alarm cancel -> `cancelled their alarm (all clear)`; alarm ack -> `acknowledged your alarm`.

Web-push payload (JSON string): `{title, body, urgent?: boolean, data?: {...}}`.

### FCM for `android-native` tokens (Kotlin app) — DATA-ONLY, always `android.priority: "high"`
No `notification` block is ever sent to these tokens for the sends below, so `FirebaseMessagingService.onMessageReceived` always runs (foreground, background or killed) and the app builds its own notification. All data values are **strings**.

New message, every type (`type` = the message type, e.g. `text|image|alarm|...`):
```
data: { type, messageId, connectionId,
        senderName,   // what the recipient calls the sender; "" if no nickname set
        preview,      // identical to the push body text above (mediaNoticeFor)
        urgent }      // "true" only for alarms
```
Alarms additionally carry `alarmId` (the RAISE's message id, also for ack/cancel), `ack` (`"true"|"false"`), `cancelled` (`"true"|"false"`), and are sent with `android.ttl = "120s"`. A raise is `ack="false"`, an acknowledge is `ack="true", cancelled="false"`, a cancel is `ack="true", cancelled="true"`. Native tokens get `high` priority for all three (the native app shows its own notification for an ack); only the legacy `android` tokens keep the plain-ack `normal` exception, see below. Non-alarm messages have no ttl set (FCM default).

Incoming call (sent at `call:invite` whenever the callee has any `android-native` token, in addition to the socket `call:incoming`; `android.ttl = "30s"`):
```
data: { type: "call", callId, kind: "audio|video", callerName }   // callerName "" if no nickname
```
Call over (sent to the callee's native tokens on every resolution: caller cancel, callee decline, ring timeout (45 s), end, forced end on connection termination; `ttl 30s`):
```
data: { type: "call_end", callId }
```
Reconnecting after a `call` push: the server holds the ringing call (45 s); a socket that connects while it rings receives `call:incoming` again, then use `call:accept` / `call:decline`. If the app was woken after the ring ended, `call:accept` fails with `call is no longer active`.

The missed/cancelled-call text push is still a normal `notification` message (title/body) and arrives in addition to `call_end`.

Tokens with `platform='android-native'` that receive a send with no `native` data (only the missed-call text push today) get the notification shape below.

### FCM for `android` tokens (Capacitor app) — unchanged
Non-alarm message:
```
message: { token,
  notification: { title, body },
  android: { priority: "high", notification: { channel_id: "messages", notification_priority: "PRIORITY_DEFAULT" } },
  data: { urgent: "false" } }
```
Alarm (data-only; no `notification` block; `android.ttl = "120s"`):
```
data: { urgent: "true", type: "alarm", ack: "true|false", cancelled: "true|false", alarmId: "<RAISE message id>" }
```
- `alarmId` is always the **raise's** message id (for an ack/cancel it is `payload.ack`).
- `android.priority` is `high` for every send **except**, for legacy `android` tokens only, a plain acknowledge (`ack=true, cancelled=false`), which is sent `normal`. Justification: the Capacitor app shows nothing for it (it only updates the raiser's UI), and Google downgrades the app's high-priority quota when high-priority data messages display no notification. The native app does display one, so its tokens are always `high`.
- Dead tokens (`UNREGISTERED`, `SENDER_ID_MISMATCH`, HTTP 404) are deleted server-side (all platforms).

---

## 7. Misc facts clients rely on
- One account, one live connection; enforced by DB trigger/index and checked on every request.
- Nicknames are local: `PATCH nickname` sets what *I* call the other member.
- `GET /connections/current` is polled every ~4 s by the web client as a fallback to sockets.
- Terminating a connection deletes all messages and attachments for both sides.
- `ALLOWED` emoji, wallpapers, styles, moods and report categories are the closed lists given above.
