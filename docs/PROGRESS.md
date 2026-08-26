# Progress Log

One entry per completed part. Newest at top. Format:

```
## [Phase.Stage.Part] Title — YYYY-MM-DD
Status: done | in-progress | blocked
What shipped:
Notes/deviations:
```

---

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
