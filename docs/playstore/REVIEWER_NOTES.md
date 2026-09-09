# Play Console — App access / reviewer notes

Paste into Play Console → **App content → App access** (choose "All or some
functionality is restricted") and attach as instructions for the review team.

The **entire app is behind Google sign-in** — there is no guest mode. The
reviewer needs two pre-made Google accounts that are **already connected to each
other**, because a connection can only be formed by exchanging a code out-of-band.

---

## Demo accounts  (fill these in before submitting)

| | Email | Password |
| --- | --- | --- |
| Account A | `__________` | `__________` |
| Account B | `__________` | `__________` |

Set-up you must do once before submitting (see "How to pair" below): sign in as A
and B on two browsers/devices and complete the connection so the reviewer lands
straight in a working chat.

## What the app is

Private 1:1 messaging. One account has exactly one active connection and one
conversation. No contact list, groups, feed, or discovery. Sign in → get a
Connection ID → share it with one person → they enter it → you accept → one chat.

## First-run gates the reviewer will see

1. **Date of birth screen** (neutral). Enter any date that is 18+ years ago.
2. **"I am 18 or older and I agree to the Terms and Privacy Policy"** checkbox →
   Agree and continue.

(An under-18 date of birth hits a dead-end screen by design — this is the age
gate, not a bug.)

## How to pair two accounts (already done for the reviewer, described for reference)

1. Sign in as **Account A**. The connection-ID screen shows A's Connection ID.
2. In another browser/device, sign in as **Account B**.
3. B's screen: **"Enter their connection ID"** → type A's ID → submit.
4. **Account A** now sees a connection request → tap **Accept**.
5. Both accounts are now in the single shared chat.

## Feature walkthrough

In the chat:
- Send a **text** message; long-press it for **reply** and **emoji reaction**.
- Tap the **＋ / attachment** control to send a **photo**, a **voice note**, or a
  **file**.
- Tap the **phone** / **video** icon in the header to start a **call** (needs the
  other account online in a second session).
- Type **`/checkin`**, **`/countdown`**, **`/ask`**, **`/letter`**, or
  **`/location`** to send a slash-command card.

## Safety features (Play UGC policy)

- **Block:** chat **•••** menu → **"Block & end"**. Ends the connection
  immediately and permanently prevents that pair from reconnecting.
- **Report:** chat **•••** menu → **"Report [name]"** for a person, or long-press
  a message → **"Report message"**. The report dialog has a **category** selector
  including a child-safety option, and a **"Report & block"** button.
- **Delete account:** chat **•••** menu → **"Delete account"** (type `delete` to
  confirm), or the connection-ID screen → **"Delete account"**, or the public
  page **https://one-on-one-mu.vercel.app/delete-account**. Removes the account
  and the conversation.

## Policy pages (public, no sign-in)

- Privacy policy — https://one-on-one-mu.vercel.app/privacy
- Terms of service — https://one-on-one-mu.vercel.app/terms
- Child safety standards — https://one-on-one-mu.vercel.app/child-safety
- Account deletion — https://one-on-one-mu.vercel.app/delete-account
