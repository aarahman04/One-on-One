# Web / Android 2.0.4 screenshot matrix

Captured from the isolated contract fixture at 360 and 1280 CSS pixels, dark/light.
These do not claim live-account or physical-device verification.

| View | 360 dark | 360 light | Desktop dark | Desktop light |
| --- | --- | --- | --- | --- |
| Sent sticker | [PNG](chromium-360-dark-sent-sticker.png) | [PNG](chromium-360-light-sent-sticker.png) | [PNG](chromium-1280-dark-sent-sticker.png) | [PNG](chromium-1280-light-sent-sticker.png) |
| Received sticker | [PNG](chromium-360-dark-received-sticker.png) | [PNG](chromium-360-light-received-sticker.png) | [PNG](chromium-1280-dark-received-sticker.png) | [PNG](chromium-1280-light-received-sticker.png) |
| Sent photo | [PNG](chromium-360-dark-sent-photo.png) | [PNG](chromium-360-light-sent-photo.png) | [PNG](chromium-1280-dark-sent-photo.png) | [PNG](chromium-1280-light-sent-photo.png) |
| Received photo | [PNG](chromium-360-dark-received-photo.png) | [PNG](chromium-360-light-received-photo.png) | [PNG](chromium-1280-dark-received-photo.png) | [PNG](chromium-1280-light-received-photo.png) |
| Sticker sheet | [PNG](chromium-360-dark-sticker-sheet.png) | [PNG](chromium-360-light-sticker-sheet.png) | [PNG](chromium-1280-dark-sticker-sheet.png) | [PNG](chromium-1280-light-sticker-sheet.png) |
| Maker crop box | [PNG](chromium-360-dark-maker-crop.png) | [PNG](chromium-360-light-maker-crop.png) | [PNG](chromium-1280-dark-maker-crop.png) | [PNG](chromium-1280-light-maker-crop.png) |
| GIF tab | [PNG](chromium-360-dark-gif-tab.png) | [PNG](chromium-360-light-gif-tab.png) | [PNG](chromium-1280-dark-gif-tab.png) | [PNG](chromium-1280-light-gif-tab.png) |

Run from `client/`: `node test/parity.browser.mjs` (requires existing Playwright, or `PLAYWRIGHT_MODULE` pointing to its `index.mjs`). Add `PARITY_MEDIA_ONLY=1` for media checks only, or `PARITY_MANUAL=1` for the disposable manual fixture. The fixture replaces auth/API locally; it never mutates deployed accounts.
