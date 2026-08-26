# Progress Log

One entry per completed part. Newest at top. Format:

```
## [Phase.Stage.Part] Title — YYYY-MM-DD
Status: done | in-progress | blocked
What shipped:
Notes/deviations:
```

---

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
