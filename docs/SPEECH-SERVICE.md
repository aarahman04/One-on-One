# Speech service (2.0.6)

Open-source letter narration (TTS) and composer dictation (STT). No paid API and
no third-party hosted inference.

```
Android ──HTTPS──> backend (Node, Railway)  ──private network──>  speech (Python, Railway, no public domain)
          auth, membership, letter text          X-Speech-Token         Kokoro-82M  (af_heart)  /tts
          from DB, part split, rate limits                              Parakeet TDT 0.6B v3    /stt
```

- Contract for clients: `docs/API-CONTRACT.md` §11 "Speech (2.0.6)".
- Backend: `backend/src/routes/speech.ts`, `backend/src/services/speechService.ts`, tests `backend/test/speech.test.ts`.
- Service: `speech/` (FastAPI + uvicorn, Dockerfile), tests `speech/tests/`. Licences: `speech/THIRD_PARTY.md`.

## Runtime choice: sherpa-onnx (one runtime for everything)

`sherpa-onnx` 1.13.8 (Apache-2.0) runs Kokoro v1.0, Parakeet TDT 0.6B v3 and
Silero VAD from one CPU wheel with ONNX Runtime bundled: no PyTorch, no NeMo, no
second inference stack. `kokoro-onnx` + `onnx-asr` would work too but means two
runtimes, two phonemiser setups and no built-in VAD.

Model variants, decided by measurement on this machine:
- **Kokoro: fp32** `kokoro-multi-lang-v1_0` (310 MB). The int8 export was 2.5x
  *slower* on x86 CPU (0.24–0.28x realtime vs 0.62–0.69x for fp32, same run, 2
  threads), so int8 buys nothing here. Voice `af_heart` = speaker id 3 (read from the
  model metadata `speaker2id`). Lexicon `en-us`.
- **Parakeet: int8** `sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8` (640 MB). Fast
  (RTF ≈ 0.2) and accurate on the samples below.
- **Silero VAD** for the silence guard.

All three are downloaded during `docker build` from the sherpa-onnx GitHub
releases and checked against sha256 pins in the Dockerfile; nothing downloads at
runtime. Models load once, in a background thread at startup; `/health` returns
`503 {"status":"loading"}` until both are loaded, then `200 {"status":"ready"}`
(`503 {"status":"failed"}` if loading failed; no details are exposed).

## Service API (private; every route but `/health` needs `X-Speech-Token`)

| Route | In | Out |
|---|---|---|
| `GET /health` | — | `200 {"status":"ready"}` / `503 loading|failed` |
| `POST /tts` | JSON `{text ≤1200 chars, voice:"af_heart", speed 0.5–2.0 (1.0)}` | `200 audio/ogg` (Opus, mono, 24 kHz input, 32 kbps). `\n\n` in `text` = 0.45 s pause between paragraphs |
| `POST /stt` | raw audio body ≤ 3 MB (+64 KB slack) | `200 {text, language, durationMs}`; 413 `too_large`/`too_long` (>120 s), 415 `unsupported_audio` |

Common errors: 401 `unauthorized` (token compared with `hmac.compare_digest`),
503 `not_ready` / `busy` (no slot within 20 s), 504 `timeout`. FastAPI docs/OpenAPI
routes are disabled.

STT path: body → temp file (deleted in `finally`) → `ffmpeg` with
`-protocol_whitelist file` and a demuxer whitelist (mov/mp4/m4a, aac, ogg,
matroska/webm, wav) → 16 kHz mono PCM. Anything ffmpeg can't decode is 415
whatever the declared type. More than 120 s → 413. Silero VAD then measures
speech; under 0.25 s of speech returns empty text (the backend turns that into
422 `no_speech`), so silence and noise never produce invented words (verified
with 5 s of digital silence and of white noise, and with 4 s of silent AAC).
Neither audio nor text is ever logged (uvicorn access log is off too).

Concurrency: an `asyncio.Semaphore(SPEECH_MAX_CONCURRENCY)` (default 2) gates a
thread pool of the same size, so `/health` and request parsing stay on a free
event loop (measured: `/health` answered in 6–25 ms while a TTS call ran). A slot
is released when the work really finishes, even after a timeout, so timeouts can't
oversubscribe the CPU.

Env (service): `SPEECH_SERVICE_TOKEN` (required, startup fails without it),
`PORT` (default 8000), `SPEECH_MAX_CONCURRENCY` (2), `SPEECH_NUM_THREADS` (2;
ONNX threads per model call), `SPEECH_TTS_TIMEOUT` (55 s), `SPEECH_STT_TIMEOUT`
(85 s), `SPEECH_QUEUE_TIMEOUT` (20 s), `SPEECH_MODEL_DIR` (`/models`). The
backend's own timeouts are 60 s (TTS part) and 90 s (STT), just above these.

The server binds one dual-stack socket on `[::]:$PORT` (`app/serve.py`):
Railway private networking is IPv6, newer environments also resolve IPv4, and
plain `uvicorn --host ::` is IPv6-only under asyncio.

## Backend behaviour

- Narration text is built only from the DB row (decrypted like history): `Dear
  <to>.`, each non-empty body line, `With love, <from>.`, then split into parts of
  at most 400 characters (sentences, then words; only a single word longer than
  400 is cut). Deterministic, so part N is stable. Authorization uses
  `getConnectionForMember(..., {requireLive, allowEndedPartner})` like history;
  every failure is the same `404 not_found`.
- Narration audio is streamed through (`Readable.fromWeb(...).pipe(res)`); the
  upstream request is aborted if the client goes away. No disk or memory cache:
  the optional LRU was not built, because a 400-char part is ~75 KB and a cache
  would only help a repeat play while making delete-invalidation another thing to
  get right. Clients may keep a played part in memory for the session.
- Transcription: per-user 10/min, content-type allow-list checked before the
  body is read, 3 MB raw-body cap (413 `too_large`), live connection required.
- Per-user limiters (keyed by app user id, mounted after `requireAuth`): 30
  narration parts/min, 10 transcriptions/min. The global 240/min per IP still applies.

## Benchmarks (2026-10-19, this machine)

Machine: laptop Intel i7-1255U (2 P + 8 E cores), Docker Desktop (WSL2), image
built from `speech/Dockerfile`. **The laptop was shared with a running Gradle/Java
build (≈93 % CPU load when checked), so these are pessimistic and noisy.** The
earlier int8 runs vary up to 3x between repeats for the same reason. Railway vCPUs
are usually server cores; expect equal or better numbers, but measure after
deploy.

| Metric | `--cpus=2`, 2 threads | `--cpus=4`, 4 threads (over HTTP) |
|---|---|---|
| Model load (both, cold container) | 24.3 s | 7 s to `/health` ready (warm disk cache) |
| RSS idle after load | 1.36 GB | 1.31 GB (`docker stats`) |
| RSS after work / peak | 2.19 GB peak (incl. 2 concurrent TTS) | 1.64 GB after one TTS + STT calls |
| TTS 398-char part (18.6 s audio) | 14.9 s → **1.26x realtime** | 12.0 s → **1.54x realtime** |
| TTS ~3000-char letter, 8 parts in sequence (144 s audio) | 122 s total, first part 13.3 s → 1.18x | not measured |
| TTS 2 parts concurrently | 31.3 s for both (no gain on 2 cores; thread-safe, no errors) | — |
| STT 10 s clip (Kokoro speech, AAC/M4A) | 2.2 s, RTF 0.22 | — |
| STT 60 s clip (Kokoro speech, AAC/M4A) | 11.3 s, RTF 0.19 | — |
| STT 18.5 s clip (Kokoro, AAC) | — | 3.5 s, RTF 0.19 |
| CPU while inferring | ~1.9–2.0 cores (saturates its threads) | — |
| CPU idle | 0.26 % | 0.26 % |
| Ogg Opus size | ~4 KB per second of speech (75 KB per 400-char part, 31.8 kbps) | same |

Real speech (sherpa-onnx's bundled human recordings): en 3.8 s → "Ask not what
your country can do for you, ask what you can do for your country." (exact); de,
es, fr also transcribed exactly (≈1.3–1.5 s each).

WER **sanity check only** (Kokoro-generated speech round-tripped through
Parakeet, not a real WER benchmark): 10 sentences / 68 words, **4.4 %**, all from
one sentence ("Please remember to water the plants on the balcony." → "Please
plants on the balcony."). The same sentence round-tripped exactly in a later run
at 4 threads.

Verdict: CPU inference is fast enough. STT is ~5x faster than realtime. TTS is
only ~1.2–1.5x faster than realtime, so the first part takes ~12–15 s before
audio starts and the client must prefetch part n+1 while part n plays (each part
plays longer than it takes to make, so playback is gap-free after the first).
Two people asking at once on a 2-vCPU limit halves throughput; give the service
more vCPUs (8) rather than more concurrency.

## Railway viability and cost

Railway Hobby allows up to 8 vCPU / 8 GB per service, billed on usage. Using
Railway's published usage rates when this was written (about $10 per GB-month of
RAM and $20 per vCPU-month; **check current pricing**):
- Always-on RAM at ~1.4–2.2 GB → **~$14–22/month**, the dominant cost.
- Idle CPU ~0.003 vCPU → cents per month.
- Work: a 400-char part ≈ 4 vCPU × 12 s ≈ 50 vCPU-s ≈ $0.0004; a transcription
  of 30 s ≈ 2 vCPU × 6 s ≈ $0.00005. 1000 narrated parts/month ≈ $0.40.
- Expected total: **~$15–25/month** on top of the existing backend. The Hobby
  plan's included $5 usage does not cover it.
- Image is ~2.9 GB unpacked; each build downloads ~1 GB of models from GitHub.

## Railway setup (owner)

1. In the backend's project and environment: **New → GitHub Repo →
   `aarahman04/One-on-One`**. Name the service **`speech`** (its private host is
   then `speech.railway.internal`).
2. Service settings → Source: **Root Directory `speech`**. Railway then uses
   `speech/Dockerfile` (Dockerfile path `Dockerfile` relative to the root). Add a
   watch path `speech/**` so backend/client pushes don't rebuild it.
3. **Do not generate a public domain** for `speech`. Networking → Private
   Networking stays enabled.
4. Variables on `speech`: `SPEECH_SERVICE_TOKEN` = a long random secret (e.g.
   `openssl rand -base64 48`), `PORT=8000`, `SPEECH_MAX_CONCURRENCY=2`,
   `SPEECH_NUM_THREADS=4`.
5. Settings → Deploy: **Healthcheck path `/health`**, healthcheck timeout 300 s
   (cold model load measured at ~25 s on 2 vCPU; first boot pulls a large image).
   Replicas 1. Restart policy on failure.
6. Resources: **memory limit 3 GB** (peak seen 2.2 GB), **vCPU 8** (4 also works,
   slower). 
7. Variables on the **backend** service: `SPEECH_SERVICE_URL=http://speech.railway.internal:8000`,
   `SPEECH_SERVICE_TOKEN=${{speech.SPEECH_SERVICE_TOKEN}}` (reference variable,
   so the two can't drift). Redeploy the backend. Without these two the speech
   routes answer 503 `speech_unavailable` and nothing else changes.
8. Smoke test after deploy: `/health` is green in the Railway UI; in the app, play
   a letter and dictate a short phrase.

## Languages and limitations

- STT: Parakeet TDT 0.6B v3 supports 25 European languages (bg, hr, cs, da, nl,
  en, et, fi, fr, de, el, hu, it, lv, lt, mt, pl, pt, ro, sk, sl, es, sv, ru, uk;
  from the NVIDIA model card). **Hindi, Urdu, Telugu and other non-European
  languages are not supported** (speech in them gives wrong or empty text). The
  client should show a limitation note.
- `language` in the STT result is always `""`: the model detects the language
  internally but sherpa-onnx does not expose it for this model.
- TTS voice `af_heart` is American English. Letters in other languages or
  scripts will be pronounced through English rules, or skipped.
- Single replica, in-process limits: a restart drops in-flight requests; the
  per-user limiters live in the backend's memory (same as the existing ones).
- sha256 pins were recorded from the assets as downloaded on 2026-10-19
  (sherpa-onnx publishes no checksums); a re-upload upstream fails the build.
