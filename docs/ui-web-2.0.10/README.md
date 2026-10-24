# Web 2.0.10 browser verification

The screenshots are fixture data from `client/test/web210.browser.mjs`, never
production conversations. The script starts an isolated Vite server and HTTP/socket
fixture, imports `MatchManager` and its rules/simulation directly from existing
backend source without editing/building it, and uses two isolated browser contexts.
It does not import backend DB, push or deployment modules.

Run from `client/`, using existing external Playwright/browser installations:

```powershell
$env:PLAYWRIGHT_MODULE = '<installed playwright or playwright-core>/index.mjs'
$env:CHROMIUM_PATH = '<installed Chromium executable>'
node --import ../backend/node_modules/tsx/dist/loader.mjs test/web210.browser.mjs
```

Coverage: all five games at 1280x900 and 360x900, server rules/move confirmation,
2D/released Pong input, clock display, reaction limits/slots, offer/decline/accept,
away/results, invite Escape, local preview speech and stop, server narration parts
and fallback, dictation punctuation, big family emoji, opaque/transparent image
normalization, all eight EXIF orientations for photos/avatars, pending upload,
failure and retired-account guard, translucent viewer/zoom, latest arrow/pinning,
manual erase/restore pixel checks and undo/redo UI, and call acknowledgement/event
ordering with a fixture transport. Unit tests separately accelerate the 118 s cap
and verify socket wait before call:end.

No authenticated deployed account pair, physical device, real speech synthesis
quality, real call connectivity or 30-second production socket-loss grace was tested.
Browser audio/media permissions and timing vary. See the parity document's manual
two-browser checklist before treating these fixture checks as production evidence.

The same browser entry point now includes the Web 2.0.12 contact/game regression
checks in `test/web212.browser.mjs` and writes new captures to ignored
`client/build/web212/`. The files here retain their historical 2.0.10 provenance.
See `../WEB-ANDROID-PARITY-2.0.12.md` for current results and remaining checks.
