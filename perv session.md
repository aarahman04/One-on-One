USER - BUG HUNTER -

  Act as a ruthless Principal QA and Security Engineer. Perform a deep, exhaustive bug audit of the provided codebase or selected files. Do not look for style or naming preferences. Focus strictly on finding real functional failures, crashes, and vulnerabilities.

  Analyze the code across these 5 core dimensions:
  1. LOGIC & EDGE CASES: Off-by-one errors, unhandled null/undefined states, race conditions, incorrect mathematical or business logic assumptions, and broken state management.
  2. ERROR HANDLING: Silent failures, empty catch blocks, unhandled promise rejections, and raw/cryptic technical error messages shown to users instead of helpful guidance.
  3. SECURITY & DATA: Injection flaws, broken authentication/authorization checks, exposed secrets or API keys, and insecure direct object references.
  4. PERFORMANCE: Memory leaks, unoptimized loops, redundant re-renders, and missing database query limits or N+1 fetch patterns.
  5. FRAGILE ASSUMPTIONS: Places where the code assumes network requests always succeed, data types never change, or user input is always sanitized.

  For every bug you find, output your findings in a clear markdown table or list using this format:
  - SEVERITY: [Critical / High / Medium / Low]
  - CATEGORY: [1-5 from above]
  - LOCATION: [File name and line number or function name]
  - ISSUE: [Clear description of why it breaks]
  - FIX: [Exact, production-ready code snippet to replace the broken logic]

  Do not summarize or skip files. Be definitive and exhaustive.


AI AGENT-

  Read 1 file

● 2 background agents launched (↓ to manage)
Backend bug + security audit
Frontend bug audit

  Read 2 files, ran 8 shell commands

I've manually audited every backend and client file. Waiting on the two Explore agents to cross-check the frontend before I compile. Preliminary high-severity findings so far:

- getHistory (backend/src/services/messageService.ts:74) — no LIMIT/pagination; fetches every message ever + a giant .in(message_ids) reaction query. Breaks (PostgREST row cap / URL length) on a long-lived chat, and with ascending: true a silent 1000-row cap would show the oldest 1000 and hide recent messages.
- Long-press picker (client/src/pages/ChatPage.ts) — opens the menu inside the 450ms timer while the finger is down; the trailing synthetic click on touchend immediately triggers the outside-click handler and closes it. Pre-existing; my rewrite kept it. Likely why long-press "was never confirmed to feel right."
- cleanup() (ChatPage.ts:60) — doesn't call closeCtxMenu(); navigating away with the picker open orphans the menu <div> on document.body and leaks its window/document/visualViewport listeners.
- Message send during a socket blip (InternetTransport.ts:43) — emit with ack callback and no timeout; if disconnected the promise never settles, entry.sent stays true, message silently lost with no retry.
- requestConnection member-insert (connectionService.ts:64) — no if (error) throw; connection row can exist with no connection_members.
- Account deletion broken — messages.sender_id / connections.user_*_id reference users(id) with no ON DELETE rule, so deleting a user who ever sent a message fails (Play/GDPR concern).

Continuing once the agents report.

✻ Baked for 5m 10s · done Saturday 9:10 PM

● Agent "Backend bug + security audit" finished · 6m 32s

Backend agent done — confirms my findings and adds blind SSRF via unvalidated push endpoint (H4) and live secrets in backend/.env (service-role key, DB password, VAPID keypair). Waiting on the frontend agent, then I compile.

✻ Brewed for 8s · done Saturday 9:12 PM

● Agent "Frontend bug audit" finished · 11m 5s

● Updated plan
/plan to preview

● User answered Claude's questions:
· The audit found ~50 real issues (3 Critical, 13 High, ~25 Medium, ~10 Low). Full report + fix snippets are in the plan file. How much do you want fixed now? → Critical + all High
· Batch 0 (secrets) is largely your action, not code. The VAPID keypair is in the tracked `backend/.env.example` in your working tree, and `backend/.env` holds a live Supabase service-role key + DB password. What should I do? → Revert + add gitleaks hook

● Updated plan
/plan to preview

● User approved Claude's plan
Plan saved to: ~\.claude\plans\fix-chat-responsive-layout-splendid-babbage.md · /plan to edit
One-on-One — Deep Bug & Security Audit + Remediation Plan

Context

Full ruthless QA/security pass over the whole repo (every file under backend/src, client/src,
all 15 migrations) requested after the reaction-picker/layout PR (#17). This file is the audit
report and a tiered remediation plan. Nothing here is style — every item is a real functional
failure, crash, race, leak, or vulnerability. Line numbers are approximate (the PR shifted
ChatPage.ts).

Auth is mostly done right: every REST route and socket event resolves the user from the JWT
server-side and re-checks membership from the DB; :id params and client-sent
connectionId/senderId are never trusted. No classic IDOR found. The damage is concentrated
in secrets hygiene, state-machine races, missing query limits, error swallowing, FK design,
and client lifecycle/leak bugs.

Format per finding: SEV · CAT · LOCATION then ISSUE / FIX. CAT = 1 logic·edge, 2 error-handling,
3 security, 4 performance·leak, 5 fragile-assumption.

---

CRITICAL

CR-1 · 3 · backend/.env (whole file) + backend/.env.example (working tree)

ISSUE: Live secrets on disk: Supabase service-role key (full RLS bypass, no expiry),
Postgres connection string with a real-looking personal password, and the VAPID private key.
git status shows backend/.env.example modified — the real VAPID public+private keypair has
been pasted into the tracked template. One git add -A && commit && push publishes the push
signing key (anyone can then forge notifications to every user). The service-role key in .env
(gitignored, but present in the repo dir → CI caches, backups, this audit) is total DB compromise.
FIX: git checkout backend/.env.example (restore empty placeholders). Rotate now: Supabase
service-role key, Postgres password, VAPID keypair. Add a gitleaks/git-secrets pre-commit
hook and a CI check that .env.example contains no values. Serve prod secrets from the platform
env, never a file in the tree.

CR-2 · 4/1 · backend/src/services/messageService.ts getHistory

ISSUE: .select(...).eq('connection_id', id).order('created_at', { ascending: true }) — no
.limit(), no pagination. PostgREST caps result rows (Supabase default 1000). With ascending
order, once a chat passes 1000 messages the history reload returns the oldest 1000 and
permanently hides every recent message. Then getReactionsForMessages builds one
.in('message_id', [<=1000 uuids>]) request (~40 KB URL) that can 414/500 the whole call.
FIX: page newest-first + reverse for display:
const PAGE = 50
let q = supabaseAdmin.from('messages').select('id, sender_id, content, created_at, type, payload, reply_to')
  .eq('connection_id', connectionId).order('created_at', { ascending: false }).limit(PAGE)
if (before) q = q.lt('created_at', before)
const { data, error } = await q
if (error) throw error
const rows = (data ?? []).reverse()
Add a before cursor param up the call chain (routes/messages.ts, connectionsApi.getMessages,
ChatPage "load older" affordance). Chunk getReactionsForMessages in batches of ~200.

CR-3 · 4/2 · client/src/pages/ChatPage.ts cleanup()

ISSUE: cleanup() (runs on every navigation via router.ts cleanup?.()) does not call
closeCtxMenu(), does not close open modals (openModal/showNotice/openReportModal append
to document.body, not root), and does not dispose mountMenuDropdown/openAppearance.
router.ts only does root.innerHTML = ''. Result: (a) navigating with the reaction picker
open orphans the menu <div> on document.body and leaks its window + document +
visualViewport(×2) listeners forever, each retaining the whole page closure
(messagesById, reactionsByMessage, pending, log). (b) An open letter composer / report
modal / notice stays painted over the next screen. (c) Modal.ts keydown listener leaks the
same way. Every chat visit adds another full leaked set.
FIX: track every dismissable overlay in a Set<() => void>; cleanup() calls
closeCtxMenu() then every disposer. Give mountMenuDropdown and openAppearance a returned
disposer and call them in cleanup().

---

HIGH — backend

H-B1 · 1/4 · connectionService.ts requestConnection + acceptConnection + declineConnection + migration 005

ISSUE: Single-active-connection is check-then-write in JS; the DB trigger
enforce_single_active_connection() is the only backstop and it runs select count(*) under
READ COMMITTED with no locking — two concurrent requestConnection (or request racing accept)
both pass and both commit. There is no unique/exclusion constraint (migration 002). Once a
user has ≥2 rows in ('pending','active','leave_pending'), getCurrentConnection's
.maybeSingle() (and thus the socket handshake) throws PGRST116 → /connections/current
500s and the websocket refuses every connect → user permanently locked out, no self-recovery.
acceptConnection/declineConnection also do a read-check then an UPDATE with no
.eq('status','pending') guard, so accept can resurrect a just-declined row.
FIX: (a) partial unique indexes so the race can't persist:
create unique index connections_one_live_a on connections(user_a_id)
  where status in ('pending','active','leave_pending');
create unique index connections_one_live_b on connections(user_b_id)
  where status in ('pending','active','leave_pending');
(b) getCurrentConnection / hasActiveOrPendingConnection: .order('updated_at',{ascending:false}).limit(1) then read data?.[0] — tolerate multiple rows.
(c) conditional state transitions, 0 rows = 409:
const { data } = await supabaseAdmin.from('connections')
  .update({ status: 'active', updated_at: new Date().toISOString() })
  .eq('id', connectionId).eq('status', 'pending').eq('user_b_id', userId)
  .select().maybeSingle()
if (!data) throw new ConnectionError(409, 'connection is no longer pending')
(d) same conditional-update pattern for advanceLeave (.eq('leave_step', mine.leave_step)) so
the 24h gate can't be bypassed by parallel requests; ideally move the interval check into SQL.

H-B2 · 1/3 · migrations 002, 004 — FK columns have no ON DELETE

ISSUE: connections.user_a_id/user_b_id and messages.sender_id reference users(id) with
default NO ACTION. users.auth_user_id cascades from auth.users. So deleting a Supabase auth
user (account deletion / GDPR erasure) tries to delete the users row, hits the FK from
connections/messages, and fails entirely — any user who ever made a connection can never
be deleted.
FIX: migration choosing explicit semantics, e.g. on delete cascade for
connections.user_a_id, user_b_id, and messages.sender_id (drop + re-add each constraint).

H-B3 · 3 · routes/push.ts + pushService.ts — blind SSRF via endpoint

ISSUE: /api/push/subscribe accepts any string as endpoint (only typeof checked). On the
next message to that user, webPush.sendNotification({ endpoint: <attacker value>, ... }) makes a
server-side POST to an arbitrary URL — http://169.254.169.254/…, http://localhost:6379/,
internal services. Blind (encrypted body, no response returned) but a real internal request +
timing/port oracle on demand.
FIX: validate on subscribe:
const ALLOWED = [/\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /\.push\.apple\.com$/]
const u = new URL(endpoint)          // throws → 400
if (u.protocol !== 'https:' || !ALLOWED.some(re => re.test(u.hostname)))
  throw new ConnectionError(400, 'unsupported push endpoint')

H-B4 · 3 · backend/src/utils/connectionCode.ts

ISSUE: Math.random() (non-CSPRNG) for the connection code, which is a capability token.
State is recoverable from a few outputs → codes issued to other users near the same time are
predictable. 7×31 ≈ 34 bits, enumerable with no rate limit (H-B5).
FIX: import { randomInt } from 'node:crypto' → ID_CHARS[randomInt(ID_CHARS.length)], 8 chars.

H-B5 · 3/4 · backend/src/index.ts — no rate limiting anywhere

ISSUE: No express-rate-limit, no per-socket throttle. Enables: connection-code brute force,
message:send flood (each → membership check + insert + fetchSockets + push), push/subscribe
spam growing the table unbounded, report spam (reportService explicitly allows unlimited
reports per user per message — a message_reports bloat vector and a Play-policy weak spot),
100 KB JSON bodies on every route.
FIX: express-rate-limit global + stricter on /connections/request, /push/subscribe,
/messages/:id/report; token-bucket per socket for message:send/reaction:*;
express.json({ limit: '32kb' }); add unique (message_id, reporter_id) to message_reports
or a per-day cap.

---

HIGH — frontend

H-F1 · 2 · client/src/main.ts:42

ISSUE: const initialScreen = await resolveInitialScreen() — top-level await, no try/catch,
no error UI, no global unhandledrejection/error handler. Any transient network failure on
cold load (getSession / getCurrentConnection) → mountRouter never runs → permanent white
screen until manual reload.
FIX: wrap in try/catch → fall back to mountRouter(app, 'login') or a retry screen; add
window.addEventListener('unhandledrejection', …) and 'error'.

H-F2 · 2 · services/apiClient.ts authedFetch + connectionsApi.ts unwrap

ISSUE: authedFetch never inspects res.status; unwrap turns 401 into
throw new Error('request failed (401)'). Nothing routes a 401 to re-auth. Stale/revoked session
(sign-out in another tab, JWT rotation) → every call 401s → red error text forever, or silent
dead poll. authService.onAuthStateChange exists but is imported nowhere.
FIX: in authedFetch, on res.status === 401 → supabase.auth.signOut() + route to login +
throw a typed error. Wire onAuthStateChange(signedIn => { if (!signedIn) go('login') }) in main.ts.

H-F3 · 2/5 · ChatPage.ts trySend / connect .catch / poll; InternetTransport.ts

ISSUE: Pending messages flush exactly once, in the .then after connectMessaging(). If that
rejects, transport stays null forever — the .catch comment says "flush on a later
poll-triggered reconnect" but poll() never touches transport/connect/trySend; there is no
reconnect path anywhere. Open chat offline → type → reconnect → messages stuck --pending
until reload. Also InternetTransport.sendMessage emit has no ack timeout — a drop
mid-flight leaves the Promise unsettled forever, entry.sent stuck true, never retried.
FIX: reconnecting supervisor; in poll or on socket reconnect, if !transport retry
connectMessaging() and on success for (const e of pending) if (!e.sent) trySend(e). Add a
10 s ack timeout in InternetTransport (setTimeout → reject).

H-F4 · 4/2 · InternetTransport.connect

ISSUE: socket.io defaults reconnection: true. connect_error rejects the connect promise
on the first attempt, but the socket keeps retrying in the background forever, never
disconnect()ed (nothing holds a reference to call it). The captured auth.token is reused on
every reconnect → after ~1 h it's expired and every reconnect fails silently.
FIX: on reject, socket.disconnect() before rethrow. Use a token-refreshing auth callback:
io(API_URL, { auth: cb => supabase.auth.getSession().then(({data}) => cb({ token: data.session?.access_token })) }).
Add a connect timeout.

H-F5 · 1 · ChatPage.ts onIncoming optimistic reconciliation

ISSUE: Matches pending → echo by content === message.content && type && replyTo. If the
server normalizes content at all (trim, NFC, emoji variation selectors) the match fails → the
echo appendMessages a duplicate and the optimistic row stays --pending forever. A failed
send stays in pending (only gets --failed class), so a later identical successful send
matches the old failed entry and stamps the server id on the wrong row. No incoming
messagesById.has(id) dedup either → duplicates on any socket.io reconnect that re-emits recent
message:new.
FIX: generate a client tempId (crypto.randomUUID()) per send, echo it back in
message:new, reconcile on tempId. Remove failed entries from pending into a separate list
with a Retry affordance. Add if (message.id && messagesById.has(message.id)) return at the top
of the non-mine branch of onIncoming.

H-F6 · 1/4 · ChatPage.ts async IIFE — disposed not checked after the first await

ISSUE: disposed is checked after getMessages and after connectMessaging, but not
after the first await getCurrentConnection(). Navigate away during that await → cleanup()
ran, disposed = true, next page mounted — then the IIFE resumes, renderChat(root, …)
overwrites the current page's DOM, wires listeners, and pollTimer = setInterval(…) which
cleanup() already finished so is never cleared — a 4 s getCurrentConnection + markRead
loop runs for the tab's life and can go('connection-id') out from under the user.
FIX: if (disposed) return immediately after every await in the IIFE, and right before
pollTimer = setInterval.

H-F7 · 1 · ChatPage.ts long-press vs contextmenu vs trailing synthetic click

ISSUE: The long-press timer opens the popover at 450 ms while the finger is still down.
openPopover schedules document.addEventListener('click', closeCtxMenu, { once: true }) via
setTimeout(0). When the finger lifts, the browser fires a synthetic click on the row →
closes the just-opened popover (and toggles chat__message--expanded). On Android a long-press
also fires native contextmenu → the menu is built twice, nondeterministically with/without
"Reply". Net: the reaction picker flickers open then closed on mobile — the core gesture of
PR #17 is broken in practice. Touch listeners are { passive: true } so preventDefault isn't
available.
FIX: set suppressClickUntil = Date.now() + 500 when the long-press fires; a capturing
click handler on log does if (Date.now() < suppressClickUntil) { e.stopImmediatePropagation(); e.preventDefault() }. Guard timer-vs-contextmenu with a single menuOpenForId. Track the
{once:true} doc-click listener in menuCleanup (see H-F8).

H-F8 · 1/4 · ChatPage.ts openPopover / closeCtxMenu (introduced in PR #17)

ISSUE: The { once: true } document click listener scheduled in openPopover is not
captured, so menuCleanup() (run on Escape / log-scroll dismiss) never removes it. It stays
armed: open picker A → Esc → open picker B → the next stray click anywhere invokes the old
closeCtxMenu and dismisses B prematurely.
FIX: name it (const onDocClick = () => closeCtxMenu()), remove it in menuCleanup.

---

MEDIUM — backend

- M-B1 · 2/1 · connectionService.ts requestConnection line ~64 — connection_members
  insert has no if (error) throw and isn't in a txn with the connections insert. Failure →
  connection row with 0/1 member rows → getMemberLeave .single() 500s every leave* call and
  getCurrentConnection silently reads leave steps as 0. FIX: check error + compensating delete,
  or move creation into one Postgres RPC/txn.
- M-B2 · 1/5 · socketServer.ts — socket.data.connectionId pinned at handshake. User who
  opens the app before a connection exists has connectionId = null and every message:send
  returns "no active connection" until reload; after terminate + new connection in one session
  the socket is stuck on the old (deleted) id. FIX: re-resolve current connection per event (or a
  connection:refresh event that re-joins rooms).
- M-B3 · 3 · connectionService.ts requestConnection lines 42–51 — three distinguishable
  responses (404 not found, 409 that person already has…, 201) = user-existence +
  relationship-status enumeration oracle (with H-B4/H-B5 and no rate limit). Also lets an
  attacker plant an unsolicited pending request. FIX: single generic failure response; log
  specifics server-side only.
- M-B4 · 1 · connectionService.ts — nothing clears stale pending. An unaccepted request
  blocks both users forever; the requester has no cancel endpoint (accept/decline both
  require user_b_id === userId). FIX: POST /connections/:id/cancel for
  user_a_id === userId && status === 'pending'; optional cron expiring old pending.
- M-B5 · 1/2 · connectionService.ts terminate + socketServer.ts — terminate hard-DELETEs
  the connection (cascading messages/reactions/reports); the other member gets no
  connection:ended event or push, their client still shows the chat, next send fails with a
  bare "connection not found". FIX: capture member ids, emit connection:ended to the room after
  delete; clients leave room + reset.
- M-B6 · 2/4 · messageService.ts saveMessage lines ~137–142 — the sender last_read_at
  update has no error check and is a second round-trip per message. FIX: check + console.error;
  ideally an AFTER INSERT ON messages trigger bumps the sender's member row.
- M-B7 · 2/5 · .single() where a row may be absent — getMemberLeave (connectionService.ts:206),
  getCurrentConnection's users … .single() (line ~162). Missing row → opaque PGRST116 500
  instead of a clean 404/409. FIX: .maybeSingle() + explicit null → ConnectionError.
- M-B8 · 1 · L9 — reportMessage blocked once the connection isn't active/leave_pending
  (assertMemberOfMessageConnection). The moment a user wants to report abuse and leave is
  exactly when reporting stops working. FIX: allow reporting for any past member regardless of
  connection status; don't cascade-delete message_reports on terminate (repoint FK
  on delete set null + snapshot message content into the report row at report time).
- M-B9 · 2 · index.ts:27 error middleware — no if (res.headersSent) return next(err);
  socket handlers ack?.({ error: err.message }) leak raw Postgres/PostgREST strings (constraint
  names, columns) to the client. FIX: headersSent guard;
  ack?.({ error: err instanceof ConnectionError ? err.message : 'internal error' }) + log rest.
- M-B10 · 1 · L3 — setWallpaper / setNickname / markRead call getConnectionForMember
  which accepts any status (declined, terminated, pending). FIX: add the
  active|leave_pending guard (allow markRead on leave_pending).

MEDIUM — frontend

- M-F1 · 1 · ChatPage.ts applyReactionUpdate / appendMessage — a reaction that arrives
  before its message is stored in reactionsByMessage but renderReactionChips bails (row not
  in DOM); appendMessage only re-renders chips if (message.reactions?.length), which a live
  message:new lacks → the reaction never draws until reload. FIX: in appendMessage, after
  messagesById.set, if (reactionsByMessage.has(message.id)) renderReactionChips(message.id).
- M-F2 · 1 · ChatPage.ts appendMessage log.scrollTop = log.scrollHeight fires on every
  append — a message/system-line/reaction arriving while the user reads history yanks them to the
  bottom. FIX: const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80; scroll
  only if (atBottom || isMine).
- M-F3 · 4 · MenuDropdown.ts:78 / appearancePreview.ts — document click listeners only
  removed by the component's own close(); navigating while open (poll termination, etc.) leaks
  them + retained closures. FIX: return disposers, call from ChatPage cleanup(); in
  appearancePreview toggle-close branch also remove the listener.
- M-F4 · 5/1 · components/Modal.ts — no focus trap, no focus restore, and every openModal
  adds its own document keydown so one Escape closes all stacked modals (report modal +
  notice). Backdrop-click test closes on a text-selection drag ending on the backdrop. FIX:
  modal stack, only top modal's onKey acts, trap Tab, restore document.activeElement, ignore
  backdrop mouseup when mousedown began inside the panel.
- M-F5 · 5 · utils/download.ts — URL.revokeObjectURL(url) synchronously right after
  a.click() races the download (Safari/old Firefox → empty file); anchor never appended
  (Firefox needs it in-DOM). Affects letter + all 3 Export buttons. FIX: append a, click,
  remove; setTimeout(() => URL.revokeObjectURL(url), 10000).
- M-F6 · 2 · main.ts:27 + pushNotifications.ts — void navigator.serviceWorker.register
  swallows rejection (unhandledrejection on missing /sw.js/MIME/http:); then getRegistration
  awaits navigator.serviceWorker.ready which never resolves if registration failed → the
  "Notifications" menu click hangs forever. FIX: .catch(() => {}) on register; race
  serviceWorker.ready with a 3 s timeout.
- M-F7 · 1 · pushNotifications.ts subscribeToPush — browser subscription succeeds, then
  the server save throws → orphan browser sub, UI shows "on", user gets nothing. FIX: on server
  failure await sub.unsubscribe() then rethrow.
- M-F8 · 2 · ChatPage.ts toggleNotifications — only the subscribe branch has try/catch;
  isPushSubscribed() / unsubscribeFromPush() rejection is an unhandledrejection (caller is
  () => void toggleNotifications()). FIX: wrap the whole body, showNotice on failure.
- M-F9 · 4 · ChatPage.ts runSearch — un-debounced on every keystroke; clearHighlights
  re-runs linkifyInto on every marked element, then runSearch rebuilds text nodes for every
  match. Multi-pass DOM + regex per keystroke → janky on long chats. FIX: debounce ~120 ms; keep
  a Map<HTMLElement,string> of original text to restore without re-linkifying.
- M-F10 · 1 · ChatPage.ts runSearch — replacing a matched message's content with plain
  text + <mark> discards its linkified <a> children, so links in matched messages are dead
  until the next keystroke/close. FIX: split only existing text nodes, leave <a> intact.
- M-F11 · 2 · connectionsApi.ts + ChatPage.ts:486 — unwrap<{messages:[]}> does no shape
  validation; {} / {messages:null} / a 200 error page → for (const m of history) throws
  not iterable → caught → go('connection-id'), ejecting the user from a fine chat. FIX:
  Array.isArray(body.messages) ? body.messages : []; inline "couldn't load history" state.
- M-F12 · 4 · ChatPage.ts:965 setInterval(() => void poll(), 4000) (also
  ConnectionIdPage, WaitingPage) — fires regardless of whether the last poll finished; on a
  slow/hung network (no fetch timeout, M-F16) requests stack. FIX: self-scheduling
  setTimeout loop with finally.
- M-F13 · 1 · pages/NicknamePage.ts — sends input.value raw (no trim, no empty check, no
  length cap); Save not disabled during the request (double-click → 2 PATCHes). An empty/space
  nickname accepted server-side makes the other user's otherNickname falsy → routed back to
  nickname every load. FIX: const v = input.value.trim(); if (!v) return; disable Save around
  the await. (Backend setNickname does validate 1–40 after trim — but the client should too and
  must disable the button.)
- M-F14 · 1 · pages/LeavePage.ts / pages/ConnectionRequestPage.ts — #ok-btn
  (advanceLeave), #end-btn, #accept-btn, #decline-btn not disabled during the request →
  double-tap fires two POSTs (for advanceLeave, an attempt to burn two leave steps at once,
  relying only on the server cooldown). FIX: disable synchronously at handler top, re-enable in
  catch.
- M-F15 · 3 · pages/ConnectionRequestPage.ts:~17 — ${current.otherConnectionCode}
  interpolated into innerHTML without escapeHtml. Server-generated today so not currently
  exploitable, but it's the one spot raw server data reaches innerHTML undefended — a field
  repurpose becomes stored XSS. FIX: textContent or escapeHtml.
- M-F16 · 2/4 · services/apiClient.ts — no AbortController / timeout on any fetch. A
  server that accepts the socket but never responds hangs every call forever; ChatPage sits on
  "Loading…" indefinitely. FIX: signal: AbortSignal.timeout(15000).
- M-F17 · 1 · ChatPage.ts poll termination path — cleanup(); go('connection-id') then
  go runs cleanup?.() again; cleanup nulls nothing, so unsubscribe/disconnect/
  clearInterval all fire twice. Harmless now, fragile. FIX: null every handle in cleanup,
  early-return if already disposed; in poll just call go().
- M-F18 · 2/5 · pages/ConnectionIdPage.ts:~43 — navigator.clipboard.writeText(code)
  unguarded → TypeError (undefined on http:/LAN/old browsers), unhandled rejection, button
  looks broken. (ChatPage Copy uses ?. but then silently no-ops with no feedback.) FIX:
  feature-detect + document.execCommand('copy') fallback + a "copied / copy manually" toast.

---

LOW

- L-B1 · 4 · every route — requireAuth does supabaseAdmin.auth.getUser(token) (network to
  GoTrue) and then each route calls getOrCreateUser (another query). /connections/current =
  4–5 external round-trips before real work; poll does this every 4 s per user. FIX: verify the
  JWT signature locally; resolve the app user once in requireAuth → req.appUser; short-TTL
  in-process cache.
- L-B2 · 5/3 · connectionService.ts:35,151 — .or(\user_a_id.eq.${userId},…`)` string
  interpolation. Not exploitable (userId is a DB UUID) but zero defense in depth. FIX: assert
  UUID shape first, or use two queries / an RPC.
- L-B3 · 5 · migrations 010, 012 — no CHECK on messages.type or reactions.emoji; only
  the app constrains them. FIX: check (type in ('text','letter','voice')),
  check (emoji in ('❤️','👍','😂','😮','😢','🙏')).
- L-B4 · 1 · pushService.ts removeSubscription filters .eq('user_id', userId) — if an
  endpoint was reassigned to another user by the onConflict:'endpoint' upsert, the original
  owner's unsubscribe silently no-ops and stale rows linger. FIX: delete by endpoint alone.
- L-B5 · 5 · connectionService.ts canAdvance — compares Date.now() to a stored
  timestamp; NTP skew / server time change advances or blocks a step wrongly. FIX: gate in SQL
  (now() - leave_last_step_at >= interval '24 hours').
- L-B6 · 1 · terminate() — hard delete, comment says "they can export first" but nothing
  enforces/offers it; confirm-end (either party, when both leaving) irreversibly destroys the
  conversation + all message_reports (moderation evidence) instantly. FIX: soft-delete
  (status='terminated', retain N days, cron purge) or require an export ack.
- L-F1 · 5 · ChatPage.ts:~235,307 — CSS.escape assumed present (absent on old Safari) →
  TypeError breaks reactions / reply-scroll. IDs are UUIDs so escaping is unneeded. FIX:
  feature-detect or hand-escape ["\\].
- L-F2 · 2 · utils/formatTime.ts — invalid Date renders literal "Invalid Date";
  isSameDay returns false for two invalid dates → date-separator spam. FIX: Number.isNaN(d.getTime())
  guards.
- L-F3 · 1/4 · utils/linkify.ts:5 — (\+?\d[\d\s().-]{6,}\d) linkifies any 8+ digit run
  (dates, IDs) as tel:; unbounded \S+ in the URL alternatives forces a full linear scan on a
  huge token (no catastrophic backtracking — the classes don't nest). Linkify is otherwise
  XSS-safe (regex-constrained scheme, nodes built with createTextNode). FIX: bound runs
  (\S{1,2000}), stricter phone shape.
- L-F4 · 1 · features/slashCommands.ts:15 — /shrug, /flip do ctx.input.value = text,
  wiping anything already typed, and don't dispatch input so autoGrow doesn't run. FIX:
  replace only the leading /token, then dispatchEvent(new Event('input')).
- L-F5 · 5 · ChatPage.ts:~340,486 — date-separator + receipt logic assume history is
  ascending by createdAt; an out-of-order response yields wrong separators/seen states. FIX:
  history.sort((a,b) => a.createdAt.localeCompare(b.createdAt)).
- L-F6 · 2 · pages/LoginPage.ts / main.ts — an OAuth redirect back with
  ?error=access_denied just re-shows login silently. FIX: read URLSearchParams error, surface it.
- L-F7 · 5 · services/supabaseClient.ts / backend/src/database/supabaseAdmin.ts — throw at
  import time on missing env, console-only, blank screen / crash. Acceptable fail-fast; a fallback
  message would help.

Also noted (not bugs)

- No automated tests anywhere; no migration-on-deploy (start = node dist/index.js) — the
  recurring "apply migration N" operational pain (and the "Could not update wallpaper" incident)
  stems from this. Consider a release step running npm run migrate.
- backend/package.json "typescript": "~6.0.2" — builds pass in this environment, leave as is.



APPROVED SCOPE — Critical + all High (Batches 0–3 + picker fix)

Medium/Low stay documented above for a later pass. Each batch = its own branch + PR off main.

Batch 0 — secrets  ·  git + .githooks/ + .github/workflows/

- I run git checkout backend/.env.example (removes the leaked VAPID keypair from the working tree).
- Add a gitleaks pre-commit hook: .githooks/pre-commit running gitleaks protect --staged,
  plus a core.hooksPath note in README / a npm run setup-hooks.
- Add .github/workflows/gitleaks.yml (gitleaks-action on PR) and a step asserting
  backend/.env.example has only KEY= empty values (grep -E '=.+' → fail).
- User action (I cannot do — no dashboard): rotate the Supabase service-role key, the
  Postgres password, and the VAPID keypair; update the deploy platform env + local .env.
  Documented in the PR body as a required manual step.

Batch 1 — backend correctness  ·  branch fix/backend-correctness

Files: backend/src/services/messageService.ts, backend/src/services/connectionService.ts,
backend/src/routes/messages.ts, client/src/services/connectionsApi.ts,
client/src/pages/ChatPage.ts (load-older), new database/migrations/016_*.sql,
database/migrations/017_*.sql.
- CR-2 getHistory → newest-first .limit(50) + before cursor; thread before through
  the route, connectionsApi.getMessages, and a "load older messages" affordance at the top of
  ChatPage's log. Chunk getReactionsForMessages in batches of 200.
- H-B1 migration 016: partial unique indexes connections_one_live_a/b. Make
  getCurrentConnection + hasActiveOrPendingConnection use
  .order('updated_at',{ascending:false}).limit(1) → data?.[0] (tolerate multiple rows).
  Conditional state transitions in acceptConnection, declineConnection, advanceLeave
  (.eq('status', …) / .eq('leave_step', …), 0 rows → 409/429).
- H-B2 migration 017: drop/re-add connections.user_a_id, connections.user_b_id,
  messages.sender_id FKs with on delete cascade.
- M-B1 requestConnection: check the connection_members insert error, compensating-delete
  the connection on failure.
- M-B6 saveMessage: check the last_read_at update error (console.error, don't throw).
- M-B7 getMemberLeave + getCurrentConnection users lookup → .maybeSingle() + explicit
  null → ConnectionError(404/409).
- M-B10 add active|leave_pending status guard to setWallpaper, setNickname, markRead.
- L-B3 migration 017 also adds the messages.type and reactions.emoji CHECKs.

Batch 2 — backend hardening  ·  branch fix/backend-hardening

Files: backend/src/index.ts, backend/src/routes/push.ts, backend/src/routes/connections.ts,
backend/src/services/pushService.ts, backend/src/utils/connectionCode.ts,
backend/src/services/connectionService.ts, backend/src/services/reportService.ts,
backend/src/websocket/socketServer.ts, new database/migrations/018_*.sql, backend/package.json
(+express-rate-limit).
- H-B3 push/subscribe: new URL() + https + host-allowlist (*.googleapis.com,
  *.push.services.mozilla.com, *.notify.windows.com, *.push.apple.com) → 400 otherwise.
- H-B4 connectionCode.ts → crypto.randomInt, 8 chars.
- H-B5 express-rate-limit global + stricter on /connections/request, /push/subscribe,
  /messages/:id/report; express.json({ limit: '32kb' }); migration 018 adds
  unique (message_id, reporter_id) to message_reports; per-socket token bucket for
  message:send / reaction:*.
- M-B2 socketServer message:send / reaction:*: re-resolve the user's live connection
  per event (via getCurrentConnection) instead of the handshake pin; socket.join the current
  room.
- M-B3 requestConnection: collapse 404 / 409 that person… into one generic response;
  log specifics server-side.
- M-B4 new POST /connections/:id/cancel (requester, status==='pending' → declined);
  add cancelRequest to connectionsApi + wire the "waiting" screen's cancel button.
- M-B5 terminate path: capture member ids, io.to(room(id)).emit('connection:ended')
  after delete; client (ChatPage transport onConnectionEnded) leaves the room + gos out
  cleanly.
- M-B8 reportMessage: allow for any past member regardless of connection status; migration
  018 repoints message_reports.message_id FK to on delete set null and adds a
  message_content snapshot column filled at report time.
- M-B9 index.ts error middleware: if (res.headersSent) return next(err); socket handlers
  send err instanceof ConnectionError ? err.message : 'internal error' and console.error rest.

Batch 3 — frontend reliability  ·  branch fix/frontend-reliability

Files: client/src/main.ts, client/src/services/apiClient.ts,
client/src/services/transport/InternetTransport.ts, client/src/services/messageService.ts,
client/src/pages/ChatPage.ts, client/src/state/router.ts (disposer contract),
client/src/components/MenuDropdown.ts, client/src/features/appearancePreview.ts.
- CR-3 ChatPage: overlays: Set<() => void> populated by openModal/showNotice/
  openReportModal/openPopover; cleanup() runs closeCtxMenu() + every disposer. Return
  disposers from mountMenuDropdown / openAppearance.
- H-F1 main.ts: try/catch around resolveInitialScreen → fallback screen;
  window.addEventListener('unhandledrejection' / 'error', …).
- H-F2 authedFetch: res.status === 401 → supabase.auth.signOut() + hard-route to login;
  wire onAuthStateChange in main.ts.
- H-F3 reconnect supervisor: poll (or socket reconnect) retries connectMessaging() when
  !transport and re-runs trySend for unsent pending; 10 s ack timeout in
  InternetTransport.sendMessage / sendReaction.
- H-F4 InternetTransport.connect: socket.disconnect() on reject; token-refreshing
  auth: cb => …getSession()…; connect timeout.
- H-F5 client tempId (crypto.randomUUID) per send, echoed in message:new, reconcile on
  it; if (message.id && messagesById.has(message.id)) return dedup; evict failed entries from
  pending into a failed list with a Retry control. (needs a matching backend echo of
  tempId — small socketServer + messageService change, folded into this batch's PR or
  Batch 2.)
- H-F6 if (disposed) return after every await in the IIFE and before
  pollTimer = setInterval.
- H-F7 long-press: set suppressClickUntil = Date.now() + 500 on fire; capturing click
  handler on log swallows clicks within that window; single menuOpenForId guard so the
  timer and native contextmenu don't double-build.
- H-F8 name the openPopover {once:true} doc-click listener, remove it in menuCleanup.
- M-F11 getMessages / history: Array.isArray(body.messages) ? … : []; inline "couldn't
  load history" instead of go('connection-id').
- M-F12 ChatPage poll → self-scheduling setTimeout loop with finally + disposed check.
- M-F16 authedFetch: signal: AbortSignal.timeout(15000).
- M-F17 null every handle in cleanup(), early-return if already disposed; poll termination
  path just calls go().

Not in this pass (documented above, deferred)

M-B*/M-F* not listed under Batch 2/3, and all L-* — tracked in the sections above for a follow-up.

Verification

- Per batch: cd backend && npm run build / cd client && npm run build clean.
- Batch 0: git status shows .env.example reverted; gitleaks protect --staged blocks a
  test commit containing a fake key; CI workflow present.
- Batch 1: apply 016/017 to a scratch Supabase branch; two concurrent accept → one
  active, one 409; advanceLeave ×2 in parallel → one 429; seed >1000 messages → history
  returns the newest 50 + "load older" pages back; delete a test auth user who has sent messages
  → succeeds.
- Batch 2: push/subscribe with endpoint:"http://localhost:6379/" → 400; 20 rapid
  /connections/request → 429 after the limit; second identical report → still 1 row
  (unique); terminate a connection, other client receives connection:ended and leaves cleanly;
  report a message on a terminated connection → recorded with snapshot.
- Batch 3: cold-load with the API blocked → fallback screen, not blank; open the reaction
  picker → navigate away → document.body has no orphan .chat__ctx-menu and
  getEventListeners(window) count is steady across 5 chat visits; kill the socket mid-send →
  row goes --failed within 10 s and re-sends on reconnect; 401 from a revoked token → routed
  to login; long-press on an Android emulator → picker opens and stays; scroll up in history,
  receive a message → not yanked to the bottom.

Proceeding. Scope: Batches 0–3 + picker fix, stacked on the PR #17 branch (so each new PR diffs clean and auto-retargets to main when #17 merges).

Audit result

~50 real findings: 3 Critical, 13 High, ~25 Medium, ~10 Low. Auth model itself is sound (no IDOR — every route/socket re-verifies membership from the DB). Damage was in secrets hygiene, state-machine races, missing query limits, silent errors, FK design, and client lifecycle leaks.

Fixed now (Critical + all High + some Medium)

┌────────────────┬────────────────────────────────────────────────────────────────────────────────────────────────┐
│     Batch      │                                              What                                              │
├────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 0 secrets      │ Reverted VAPID keypair from tracked .env.example; gitleaks pre-commit hook + CI                │
├────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1 backend      │ getHistory pagination (was hiding all recent messages past ~1000); migration 016 race-proofs   │
│ correctness    │ single-active-connection + stops the lockout 500; conditional state transitions; migration 017 │
│                │  FK ON DELETE CASCADE (account deletion was impossible)                                        │
├────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 2 backend      │ push-endpoint SSRF allowlist; CSPRNG codes; express-rate-limit + socket flood guard; per-event │
│ hardening      │  connection resolve; enumeration oracle closed; requester cancel endpoint; connection:ended;   │
│                │ report-after-terminate + snapshot; error sanitization                                          │
├────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 3 frontend     │ cleanup() tears down leaked popover/menu/modal listeners; startup try/catch + global handlers; │
│ reliability    │  401→login; reconnect supervisor + ack timeout; tempId optimistic reconcile (was dup'ing on    │
│                │ content); disposed guards; long-press picker no longer self-dismisses                          │
└────────────────┴────────────────────────────────────────────────────────────────────────────────────────────────┘

Both backend and client build clean.

You must do before merge

1. Rotate the Supabase service-role key, Postgres password, and VAPID keypair — they were on disk and briefly in the tracked template.
2. Apply migrations 016, 017, 018 (npm run migrate).
3. git config core.hooksPath .githooks (needs gitleaks); npm install in backend/.

Not done

- Live verification (DB migrations, 2-account socket flows, browser leak/reconnect checks) — needs a running stack + Supabase branch. Per-batch test plan is in the plan file.
- ~25 Medium + ~10 Low findings — documented in the plan file for a follow-up pass (Modal focus-trap, download revoke race, search perf, button-disable guards, auth round-trips, etc.).


CI green now — both gitleaks and the renamed env-examples-have-no-secrets job pass (run 33264896327).

What caused the failure

Not a secret. backend/.env.example has never contained one. The job failed because my Batch 0 check was wrong:

grep -Eq '^[A-Za-z_][A-Za-z0-9_]*=.+' backend/.env.example   # fails on ANY KEY=value

That rejects every non-empty value, so the legitimate non-secret defaults in the template tripped it:

- PORT=3000
- CLIENT_ORIGIN=http://localhost:5173
- VAPID_SUBJECT=mailto:you@example.com (a placeholder)

A template is supposed to carry defaults like PORT=3000. The rule should be "sensitive keys are blank", not "all keys are blank".

Tasks

1–4. backend/.env.example — inspected; no secrets present, no changes needed. All sensitive keys already blank:

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
PORT=3000
CLIENT_ORIGIN=http://localhost:5173
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com

Net diff for backend/.env.example across this PR: none (Batch 0's git checkout already restored it to the clean committed template; the leaked VAPID keypair only ever existed in the uncommitted working tree).

5. Other tracked files — clean:
- client/.env.example — sensitive keys blank, only VITE_API_URL=http://localhost:3000 default.
- git grep for JWT / postgres-URL / private-key / sk_live / AWS patterns across tracked code+config → nothing.
- .env, .env.local — not tracked (gitignored), never committed.
- Full history of backend/.env.example (3 prior versions) → only PORT / CLIENT_ORIGIN / VAPID_SUBJECT placeholder, no real secrets. So the gitleaks history scan is clean too.

6. Local validation — new shared script, passes:

$ sh scripts/check-env-examples.sh
env examples OK — no sensitive values.

Negative-tested: injecting VAPID_PRIVATE_KEY=xxx / SUPABASE_SERVICE_ROLE_KEY=xxx → exit 1 as expected.

7. The actual fix (backend/.env untouched):

- scripts/check-env-examples.sh (new) — fails only when a key matching _KEY|_SECRET|_TOKEN|_PASSWORD|PRIVATE|SERVICE_ROLE|DATABASE_URL carries a value, across both .env.example files. CR-tolerant.
- .github/workflows/gitleaks.yml — job renamed to env-examples-have-no-secrets, now just run: sh scripts/check-env-examples.sh.
- .githooks/pre-commit — same check via the shared script.
- .gitattributes (new) — pins *.sh, .githooks/*, *.env.example to LF so a CRLF checkout can't break the shell scripts on Linux.

Pushed as c96562f on fix/audit-critical-high (PR #18)