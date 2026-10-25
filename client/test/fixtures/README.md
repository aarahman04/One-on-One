# Pong fixtures

`pong-display-traces.json` is copied unchanged from Android commit
`4ac64ac32eab0bab6ecf0e915ef86926e6cf0a83`, path
`app/src/test/resources/pong-display-traces.json`. The Android Kotlin suite executes
these 28 traces, including dropped pre-bounce confirmation seed 67050. Web executes
them in both seats. Shared contact/stroke vectors already live in
`backend/test/fixtures/pong-contact-golden.json`; web tests read that file directly.
`pongDisplay.mjs` instruments the actual web client for the adapted contact harness.
