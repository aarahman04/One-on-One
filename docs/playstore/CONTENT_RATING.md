# Play Console — Content Rating (IARC) answer sheet

Play Console → **App content → Content ratings** → start the questionnaire.
Category: **Social / Communication**. Answer honestly; the app ships **no**
first-party objectionable content, but it carries **unmoderated user-to-user
communication** and **location sharing**, which drive the rating.

Email for the certificate: **aarahman803@gmail.com**

---

## Category selection

**Social networking, forums, or user-generated content** — the app is 1:1
private messaging with user-generated content.

## Questionnaire answers

| Topic | Answer | Justification |
| --- | --- | --- |
| Violence (realistic, fantasy, gore) | **No** | No game/media content of any kind. |
| Sexual content or nudity | **No** | No first-party content. (User text is unmoderated — see "User interaction" below; prohibited by the Terms and handled by moderation.) |
| Profanity or crude humor | **No** (first-party) | None shipped. User text is free-form. |
| Controlled substances (drugs, alcohol, tobacco) | **No** | Not referenced anywhere. |
| Gambling (simulated or real) | **No** | None. |
| Fear / horror content | **No** | None. |
| **Users can interact / communicate** | **Yes** | The entire app is a private text/voice/photo/call channel between two connected users. |
| Interaction is with **known contacts only** vs. strangers | **Connect-by-code only** | No discovery, no matchmaking, no public profiles. A connection requires one user to share a Connection ID out-of-band and the other to accept a request. There is exactly one connection per account. |
| **Users can share their current location** | **Yes** | The `/location` command sends a one-shot location card to the connected user (opt-in each time, not continuous, no background access). |
| Users can share other personal information / user-generated media | **Yes** | Photos, voice notes, files, free text — all between the two connected users only, never public. |
| User-generated content is **moderated** | **Partly** | No pre-publication moderation (1:1 private messages). Reactive moderation: in-app Report (message-level and person-level, with a child-safety category), a real review process (`npm run reports:review`, `docs/MODERATION.md`), content/connection/account takedown, and CSAM → NCMEC. In-app Block is immediate and permanent. |
| Digital purchases / in-app purchases | **No** | None in V1. |
| Contains ads | **No** | None. |
| Shares user data with third parties for advertising/marketing | **No** | No ad or analytics SDKs; nothing sold. |
| Unrestricted internet access (open browser/webview) | **No** | The wrapper is a Trusted Web Activity bound to a single origin; there is no address bar or arbitrary navigation. |

## Expected outcome

Because of unmoderated user communication + location sharing, IARC will likely
return **Teen (ESRB) / PEGI 12 / USK 12** or similar, even though the app itself
contains nothing objectionable. That is normal for a messaging app.

Note this is **separate from Target Audience**: set **Target audience = 18+**
(App content → Target audience and content), matching the in-app age gate. The
content rating describes the content; the target audience is the deliberate
18-and-over restriction.
