| Feature | Android 2.0.4 behaviour | Web on starting main | Plan / result |
| --- | --- | --- | --- |
| Clock | Local `h:mm AM/PM` everywhere | Bubble clock already 12-hour; shared clock 24-hour; full timestamp had seconds | Unified clock; full detail, last seen and countdown target use local 12-hour time |
| Photo/sticker meta | 3px photo frame; bare 150px stickers; sent right / received left pills | All images treated as photos; photo pills always right | Matched frame, bare detection, quote fallback and pill sides |
| Composer | Sticker/camera icons; Stickers then GIFs; slide/fade swaps | Attachment on left; no composer media picker/camera; display toggles | Android icon paths, two-tab picker, camera capture and animated swaps |
| GIFs | Backend search/trending and prepared image payload; GIPHY credit | No GIF search UI | Contract §9 search, pagination and send; visible attribution |
| Library | Account-local favourites, last 16 recents, personal stickers, six packs | No library | IndexedDB; 80 unchanged WebPs plus 11 SVG conversions; favourite/delete and account cleanup |
| Maker | Original/Cut-out, 10% crop minimum, square placement, alpha WebP ≤100000 bytes | No maker | Local MediaPipe/DeepLab; crop handles, keyboard, pan/pinch/wheel; quality 1.0→0.8 |
| Instant sends | Upload placeholders; text stays available | Voice waits for upload; no sticker/GIF path | Immediate duration/sticker/GIF placeholders; chat errors; independent text sends |
| Profile photos | Own upload/remove; private partner → real partner → initial | Initial only | Contract §9 settings; browser-private partner photo; header and call avatar updates |
| Text size | S/M/L/XL: .9/1/1.15/1.3 | No setting | Browser appearance preference; text and card scaling |
| Round-2 polish | Quote/meta alignment, stacked previews, curved tails, receipt/delete fades, local unsent deletion | Quotes/previews already stacked; straight tails; static ticks; no local discard | Preserved existing stacking; curved typing/bubble tails, receipt/deletion animation, local discard; fixed reduced-motion toast removal and hidden-input focus trapping |

Implemented on `feat/web-android-parity-2026-10-14`, based on main `dec62db`.
No API contract gap was found. Only client code/assets/tests and documentation changed.
Android was read-only; no backend, database, deployment, secret or existing untracked-file changes.

Step 0 was reported before feature work:
- [PR #85](https://github.com/aarahman04/One-on-One/pull/85) was obsolete: its next-versionCode 2 note conflicts with the native checklist's next 11 / 2.0.4. [Evidence comment](https://github.com/aarahman04/One-on-One/pull/85#issuecomment-6166715102), then closed; its remote and local branch were deleted.
- `fix/audit-medium-low` contained the still-valid docs-only commit `e37b02d`, absent from main. Cherry-picked as `3db8b50` into this PR; its remote branch remains for traceability. No second PR.

Commands and results:
- `git pull --ff-only origin main`: already up to date; `git fetch origin`: successful.
- `git switch -c feat/web-android-parity-2026-10-14`; `git cherry-pick e37b02d`: successful.
- `npm install @mediapipe/tasks-vision` in client: only the explicitly permitted production dependency added, version 1.1.0.
- `npm run build` and `npm test` in client: pass; 16 tests, including sticker detection, sides, crop/placement, WebP retry/limit, local 12-hour formatting.
- `npm run build` and `npm test` in backend: pass; 34 tests. Expected absent push/TURN test configuration notices; no live-provider test.
- `node test/parity.browser.mjs` in client with `PLAYWRIGHT_MODULE` pointing to the installed Playwright runtime: pass in Chromium at 1280px and 360px. Existing chat checks cover both themes/all wallpapers; media checks cover dark/light, local model inference, library persistence/deletion, reply stickers, image send payloads, voice recording/upload, text during upload, errors/local discard, own/private avatar changes, call avatar priority, sign-out/late saves, keyboard focus and media tombstones.
- `PARITY_MEDIA_ONLY=1` runs only the focused media portion; `PARITY_MANUAL=1` serves the disposable contract fixture for a manual Chrome pass.
- Asset check: all 80 copied WebPs are 512×512, ≤100000 bytes; DeepLab SHA-256 matches Android (`ff36e24d40547fe9e645e2f4e8745d1876d6e38b332d39a82f0bf0f5d1d561b3`). `git diff --check`: pass.
- Manual Chrome: inspected chat and sticker sheet at exactly 360 and 1280 CSS pixels, dark/light; appearance/text size controls checked. The extension could not attach local files; automated file selection/maker checks passed.

The build retains its pre-existing mixed static/dynamic push-import warning. Early browser fixture failures were corrected (ambiguous Recent/My stickers locator, per-theme fixture reset); review caught mobile panel clipping and stale reduced-motion toasts, both fixed. No check was waived.

Screenshots are contract fixtures, not deployed accounts. [Screenshot matrix](ui-web-android-parity/README.md) includes sent/received stickers and photos, picker, maker crop box and GIF tab at both widths/themes.

Unverified: two real accounts, production GIPHY configuration/results, migration 037/live avatar storage, real camera/microphone hardware and call media, physical pinch gestures/mobile keyboard, Safari/Firefox, real account deletion, deployed CSP/hosting and slow-device inference quality/performance. No Railway/Supabase or release action was performed.

Known limits: exact 512×512 WebP detection can also classify a square WebP photo as a sticker (the requested client shortcut). Browser-local libraries/private photos clear on sign-out/account deletion and are not synced or backed up. Self-hosted MediaPipe runtime variants total ~25.8 MB plus the 2.8 MB model; a cut-out loads only the selected runtime and model on demand. Apache attribution is in `client/public/stickers/NOTICE.txt` and `APACHE-2.0.txt`; Craftwork assets use the owner's paid licence.
