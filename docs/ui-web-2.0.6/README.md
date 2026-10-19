# Web 2.0.6 fixture screenshots

Run from `client/` with Playwright installed (or set `PLAYWRIGHT_MODULE` to its installed index.mjs):

```
node test/web206.browser.mjs
node test/parity.browser.mjs
```

Optional `PARITY_CHANNEL=chrome` selects installed Chrome for the 2.0.6 check. The script runs local Vite and a scripted Socket.IO/REST server with disposable users; external account/network requests are blocked.

The 1280px and 360px sets show light/dark chat (reaction pill, choice tiles and /ask footer), letter, choice composer, all five game screens/result, leave confirmation and partner-left recovery. The assertions also exercise gates skip/migration, dictation partial/final/cancel/unsupported state, letter speaker toggle, exact tic-tac-toe relay seq 0–4 between two pages, rematch/decline, other game moves/resign, offline notice, all history pages and ZIP folders/PDFs/deleted filtering/cancel, ended boot and acknowledge-end.

Speech engines are mocked to test UI/lifecycle; audible speech and real recognition are not device-tested. No real-account, native push, full cross-platform match, Safari or physical touch/keyboard claim. Unit tests reuse Android board/chess fixtures and the same Pong envelope/Float32 rules.
