# Web parity with Android 2.0.12 — 2026-10-24

Started from fetched web `origin/main` **30a7473a5ce0af1fe84ac6595b49ef9483a76cfd**
(backend #128), with Android **4ac64ac32eab0bab6ecf0e915ef86926e6cf0a83** (#52)
as the reference. Unrelated local files and Android changes were preserved.
No backend, native Android, infrastructure, secret, dependency or lockfile change.

## Implementation

- `games/pong.ts` ports the final Android displayed-time contact/prediction path.
  It sweeps the complete circular head relative to the moving drawn ball,
  checks eligibility/height at impact time and launches the identical return
  immediately. Follow-through never holds the racket or recaptures the flight.
- `games/pongPhysics.ts` is identical to backend `pongPhysics.ts`. A test enforces
  that equality and runs the existing shared contact/stroke/launch golden vectors.
  Flight easing, aim, power, spin/drift, bounce, serve, scoring and difficulty
  formulas were not changed. Canvas head radius/outline and height-dependent
  ball radius/black edge now match those judged by the backend. The white core
  always draws with alpha 1, including prediction and confirmation.
- The client keeps 32 frames / 800 ms, a 32-sample recent offset estimate bounded
  to 1 ms adjustment per received frame, 50 ms interpolation and at most 50 ms
  authoritative extrapolation. An active launch follows the displayed time axis
  through frame loss. Confirmation cannot blend back to an older incoming flight
  when pre-bounce return frames were lost. Acceptance/rejection blends for 60 ms;
  rejected input allows retry. A stationary rejected serve also blends without
  a receipt-time snap. Only authoritative h/j/s/outcomes drive feedback.
- Optional `ack`/`drift` are validated before state mutation; frames without them
  retain compatibility. The existing transport carries `touch`, `ct`, `v`, `n`
  and the exact `[n,ct,v,x,y,touchX,touchY,released01]` tuples. A bounded 32-entry
  local history supplies up to 31 prior samples alongside its current sample.
  Sequence resumes from the seat's ack; client ct remains increasing across games.
- Pointer coalesced history, relative drag, elapsed-time racket following,
  release, lost capture, blur, background, pause, score reset and teardown share
  the existing controls. Sends adapt between 33 ms and 16 ms near contact.
  Release flushes held input and then uses reliable Socket.IO emission: two
  immediate volatile writes demonstrably dropped the release in Chromium.
  Ordinary movement remains volatile. Range inputs remain available.
- Existing clock/options/comments features were audited rather than recreated.
  Clocks honor a paused snapshot; away clocks continue when the server keeps
  them running. Pong's result scoreboard now uses the selected target instead
  of a hardcoded seven. Stale cached partner presence never blocks an online
  sender's invitation. Reactions retain match:react/match:reaction and existing
  code-point/rate limits.
- The main message textarea adds only `autocapitalize="sentences"`. No input
  values are rewritten, preserving deliberate case, paste, IME, dictation and
  slash commands. Actual keyboard capitalization remains a physical-device check.

## Measured contact evidence

Run from `client/`:

```powershell
node --import ../backend/node_modules/tsx/dist/loader.mjs test/pong-contact-harness.ts ../docs/WEB-PONG-CONTACT-AFTER.json
```

This adapts Android's deterministic harness to instrument the **shipped web
PongClient**, against the real current PongSim. It does not substitute a second
prediction implementation. The 28 Android/Kotlin-verified action traces are
copied byte-for-byte in `client/test/fixtures/pong-display-traces.json`, and
executed for both seats (56 trace runs), including dropped pre-bounce frames.
Contact/stroke vectors are read directly from the existing backend fixture.

72 profiles × 240 attempts = **17,280 attempts**: one-way 0/40/80/150 ms,
±0/20/40 ms jitter, 60/90/120 Hz, 30 Hz server frames, 12–21 ms tick jitter,
zero loss or 10% frame / 5% paddle loss. Still block, slow/hard sweeps, left/right
diagonals and back approaches aim at the displayed ball. The simulated link
supplies server-observed handshake/heartbeat RTT probes; no client RTT field
is sent. The existing server clamp stays measured-RTT+100 ms within 250–500 ms.
Input outside that bound is clamped and can miss; this change does not enlarge it.

| One-way ms | Attempts | Overlap miss | Ghost | Maximum correction, court widths | Launch delay p95 ms |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 4,320 | 0% | 0% | .0026 | 0 |
| 40 | 4,320 | 0% | 0% | .0064 | 0 |
| 80 | 4,320 | 0% | 0% | .0067 | 0 |
| 150 | 4,320 | 0% | 0% | .0192 | 0 |

Every profile passes the unchanged acceptance assertions. Worst profile p99
correction **.017361**, maximum **.019191**; no receipt teleport, early return,
unconfirmed return or permanent prediction lockout. Swept launch gap is numerical
noise (<1.2e-15 widths), below 1.5 ball radii. Target/duration mismatch for
identical inputs is <1.2e-16. Corrections measure confirmation receipt plus the
largest per-draw blend adjustment, excluding ordinary curve travel. Swept impacts
between draws count as visible contact. Launch delay is predicted display delay,
not acknowledgement RTT. Rejection/retry is additionally covered by focused tests.
Raw rows: [WEB-PONG-CONTACT-AFTER.json](WEB-PONG-CONTACT-AFTER.json). These are new
web measurements; the older Android before/after table is not a web baseline.

## Checks and browser evidence

- Client `npm test`: **59/59**; strict lint, typecheck and production build pass.
  Existing Vite pushNotifications static/dynamic import warning remains.
- Backend `npm test`: **148/148**, build pass; backend sources were unchanged.
  Real Socket.IO tests cover authorization, sample validation/replay/ack/RTT
  bounds, all four clocks/increments/comments, no-move server timeout and Pong
  11/21/13 target/rematch behavior. Real simulations finish at each selected
  target after continuing beyond seven.
- `test/web210.browser.mjs` reuses the existing identity/HTTP/socket fixture,
  with `test/web212.browser.mjs` for this round. Two isolated Chromium identities
  at **1280×900** and **360×900**, with mouse and CDP touch input in both seats.
  The fixture runs actual MatchManager/rules/PongSim, while authentication, HTTP
  data and reaction echo are local fixtures. It is not production MatchSocket
  authentication; the backend real-socket suite supplies that coverage.
- Browser coverage: every clock preset/no-limit invite for every turn game,
  custom settings/increments/moves and countdown agreement after reconnect,
  a real 10-second no-move timeout, comments both ways across all five games,
  11/21/custom-13 Pong targets beyond seven, result labels, rematch retention,
  socket reconnect and a simulated visibility/background transition. White-core
  canvas fills are checked at alpha 1. Composer case/pasted text stays unchanged.
- A focused browser probe runs the actual canvas/controller with synthetic
  coalesced history plus native pointer capture, lost capture and blur/retry.
  Browser audio is instrumented to verify silence before authority and exactly
  one hit tone for an authoritative increment, with no repeat on the next frame.
- The existing broader browser checks also pass: five game rules/draws/results,
  invite dismissal, speech fixtures, dictation, emoji, photo normalization,
  manual sticker editing and call lifecycle fixtures. Screenshots go to ignored
  `client/build/web212/`; selected result captures are in `docs/ui-web-2.0.12/`.

## Remaining device/production checks

- Authenticate two real production accounts; play/reconnect/rematch all five
  games, including clock expiry and comments, and 11/21/13 targets beyond seven.
- On physical phone touch and desktop mouse: still bat ×20, slow sweep ×20,
  fast diagonal ×20, left/right/front/back contacts ×10 each; Wi-Fi/mobile data
  and 60/120 Hz where available. Browser fixtures do not measure physical input,
  display latency or real network scheduling.
- Check sentence capitalization on actual mobile keyboards, deliberate lowercase,
  paste, IME, dictation and slash commands. Safari/Firefox and physical background
  suspension remain unverified. No new runtime dependency or device calibration
  was introduced.
- Delivery follows the existing Vercel web pipeline after verified CI and merge.
  Confirm the production deployment's source SHA, not merely a healthy endpoint.
