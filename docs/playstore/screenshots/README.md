# Play Store phone screenshots

**Placeholder — capture the real ones yourself** (the app is behind Google
OAuth; a headless script can't get past sign-in).

## How

```
npm i -D puppeteer
node scripts/shoot-screenshots.mjs
```

A phone-sized browser opens on `https://one-on-one-mu.vercel.app/`. Sign in, pair
two accounts (see `../REVIEWER_NOTES.md`), navigate to each screen, and type a
name in the terminal to capture it here as `<name>.png` (1080×1920).

## Suggested set (2–8, Play requires ≥2)

| Name | Screen |
| --- | --- |
| `login` | The sign-in screen with the tagline. |
| `connection-id` | The connection-ID screen (the one-connection concept). |
| `chat` | A conversation with a few real messages + a reaction. |
| `call` | An in-progress audio or video call. |
| `slash-card` | A `/checkin` or `/countdown` or `/location` card in the thread. |
| `menu` | The chat ••• menu, showing Block & end / Report / Delete account. |

## Requirements

- PNG or JPEG, 9:16 (1080×1920 is fine), min 320px short side, max 3840px.
- Real UI only — no marketing frames, no fake data that misrepresents features.
- Don't show a real person's private messages; use the demo accounts.

Optionally, once captured, you can also add a `screenshots` array to
`client/public/manifest.webmanifest` (form_factor `"narrow"`) — improves the
Chrome/TWA install prompt. Not required for Play.
