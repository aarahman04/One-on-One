# Progress Log

One entry per completed part. Newest at top. Format:

```
## [Phase.Stage.Part] Title — YYYY-MM-DD
Status: done | in-progress | blocked
What shipped:
Notes/deviations:
```

---

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
