# Speech service (2.0.6, cost rework 2.0.7)

Open-source letter narration (TTS) and composer dictation (STT). No paid API and
no third-party hosted inference.

```
Android ──HTTPS──> backend (Node, Railway)  ──private network──>  speech (Python, Railway, no public domain, Serverless)
          auth, membership, letter text          X-Speech-Token         Kokoro-82M fp32 (af_heart)   /tts
          from DB, part split, rate limits,                             Whisper base.en int8         /stt
          daily quotas, wake retry                                      Silero VAD (silence guard, chunking)
```

- Contract for clients: `docs/API-CONTRACT.md` §11 "Speech".
- Backend: `backend/src/routes/speech.ts`, `backend/src/services/speechService.ts`, tests `backend/test/speech.test.ts`.
- Service: `speech/` (FastAPI + uvicorn, Dockerfile, `.railway/railway.ts`), tests `speech/tests/`. Licences: `speech/THIRD_PARTY.md`.

## 2.0.7 decision (2026-10-20): why not Kokoro + Parakeet always-on, and why not Speaches

The 2.0.6 service kept Kokoro fp32 **and** Parakeet TDT 0.6B loaded all the time:
~1.4 GB idle, ~2.2 GB peak, estimated **$15–25/month** on Railway. Target: **≤ $5/month**.

What changed, each by measurement (numbers below):

1. **STT: Parakeet 0.6B → Whisper base.en int8** (same sherpa-onnx runtime). Loaded RSS
   235 MB vs 820 MB, peak 750 MB vs 1.47 GB, accuracy close (see table). Speech is cut
   at VAD pauses into ≤ 25 s pieces (Whisper's window is 30 s): a fixed 28 s cut had
   produced 71 errors in one 60 s clip; VAD cuts brought it to 9.
2. **TTS stays Kokoro-82M fp32, voice `af_heart`.** The int8 export is 2.5–3x slower on
   x86 (0.9–1.1x realtime at 2 threads, too slow to stream gap-free); a lighter TTS
   (Piper/espeak) would be audibly more robotic, which the brief rules out.
3. **Models load on first use and unload after `SPEECH_MODEL_TTL` idle seconds
   (default 120)**, with `malloc_trim` so the memory really returns to the OS
   (measured: 666 MB → 49 MB; without the trim it stayed at 550 MB).
4. **Railway Serverless**: the container sleeps 5–10 min after its last outbound
   packet and is woken by private-network traffic from the backend. Asleep = no
   CPU/RAM billing. The backend retries the wake-up (below).
5. **Quotas** in the backend bound the worst case (see Cost).

Alternatives considered (kept short on purpose):

| Option | Verdict |
|---|---|
| **Speaches** (speaches-ai/speaches, checked at commit `993994f`, 2026-04-17) | Real Bearer auth when `API_KEY` is set (`HTTPBearer`, 403; compared with `!=`, not constant time). Real idle unload (`stt_model_ttl`/`tts_model_ttl`, default 300 s). But: forces `onnxruntime-gpu` on x86, pulls faster-whisper/CTranslate2 + kokoro-onnx + piper + gradio (a second and third runtime), downloads models from Hugging Face **at runtime** (needs a volume and outbound access; HF is unreachable from this build environment, so it could not even be benchmarked here). `USE_GPU` is not read anywhere in its code. Same models, more moving parts → not chosen. |
| Whisper tiny.en int8 | 170 MB, fastest, but worse on noise (7.6 % vs 5.8 % WER) and real speech (4.3 % vs 3.2 %). |
| Whisper small.en int8 | Best on real/noisy speech (1.1 %/2.9 %) but 490 MB loaded, 1.36 GB peak, ~3x slower. Not worth it. |
| Moonshine base (MIT) | Accurate and fast, but 380 MB loaded (vs 235 MB) for no clear accuracy gain over base.en. |
| On-device (Android SpeechRecognizer / TextToSpeech) | $0 and already the 2.0.6 fallback (`SERVER_SPEECH=false`). Device voices are the "robotic" option and recognition quality varies by phone/OEM; kept as the fallback, not the primary. |

## Measurements (2026-10-20, this build machine)

Machine: Intel Xeon @ 2.10 GHz, 4 vCPU container, Python 3.13, sherpa-onnx 1.13.8,
`SPEECH_NUM_THREADS=2`, `SPEECH_MAX_CONCURRENCY=1`. **Not Railway hardware** — re-check
after deploy. Uploads were re-encoded to AAC/MP4 48 kbps, as Android sends.

**Test audio is mostly synthetic and labelled as such**: Kokoro voices (US `af_bella`,
UK `bm_george`, and the Hindi voices `hf_alpha`/`hm_omega` speaking English as an
**Indian-English accent proxy**), white noise at 10 dB SNR, digital silence, noise
only, informal phrasing ("um, so, like…"), plus 4 real human recordings (3 LibriSpeech,
1 JFK). No real Indian-English human recordings were available here; test those on a
phone before relying on accent accuracy.

Model choice (isolated runs, int8, 2 threads; WER over all clips incl. the fixed-cut bug for Whisper):

| STT model | Loaded RSS | Peak RSS | RTF 60 s | Real human WER | Noisy WER | Indian-proxy WER |
|---|---|---|---|---|---|---|
| Parakeet TDT 0.6B v3 (2.0.6) | 821 MB | 1467 MB | 0.10 | — | — | — (3.1 % overall) |
| Whisper tiny.en | 169 MB | 503 MB | 0.08 | 4.3 % | 7.6 % | 4.7 % |
| **Whisper base.en** | **239 MB** | **752 MB** | 0.16 | **3.2 %** | **5.8 %** | **4.1 %** |
| Moonshine base | 380 MB | 778 MB | 0.09 | 4.3 % | 6.4 % | 4.6 % |
| Whisper small.en | 496 MB | 1361 MB | 0.41 | 1.1 % | 2.9 % | 3.7 % |

| TTS (Kokoro v1.0, 3 texts) | Loaded RSS | Peak RSS | x realtime, 1 thread | x realtime, 2 threads |
|---|---|---|---|---|
| **fp32** | 464 MB | 856 MB | 1.3–1.6x | **2.4–3.0x** |
| int8 | 268 MB | 692 MB | 0.7–0.9x | 0.9–1.1x |

The shipped service end to end over HTTP (`speech/app`, uvicorn, real models):

| Metric | Result |
|---|---|
| Process start → `/health` ready | 0.5 s (page cache dropped; models are lazy) |
| RSS idle, nothing loaded | 54–57 MB |
| First TTS after start (cold load + 82 chars, 5.4 s audio) | 4.4 s |
| Warm TTS: 270 chars (15.4 s audio) / 400-char part (21.5 s audio) | 6.6 s / 10.0 s (≈ 2.2x realtime) |
| STT 10 s / 30 s / 60 s (first call includes the Whisper load) | 3.2 s / 4.8–5.0 s / 8.7–9.7 s |
| STT WER: clean US/UK proxy · Indian-English proxy · noisy · real human | 4.3 % · 5.6 % · 7.6 % · 3.2 % (overall 5.3 %, 1,334 words) |
| Silence and noise-only uploads | empty text (backend → 422 `no_speech`) |
| RSS TTS loaded / both loaded / transient peak | ~780 MB plateau / ~820 MB–1.1 GB / 1.5 GB |
| RSS after idle unload | 93 MB |
| Two narrations at once, one slot | both 200; 8.1 s and 14.9 s (serialized, no error) |
| Missing or wrong token | 401 |
| Ogg Opus size | ~4 KB per second of speech |
| Image models on disk | 517 MB (Kokoro English-only 362 MB, Whisper int8 154 MB, VAD 0.6 MB) |

## Service API (private; every route but `/health` needs `X-Speech-Token`)

| Route | In | Out |
|---|---|---|
| `GET /health` | — | `200 {"status":"ready"}` as soon as the process serves (models are lazy) |
| `POST /tts` | JSON `{text ≤1200 chars, voice:"af_heart", speed 0.5–2.0 (1.0)}` | `200 audio/ogg` (Opus, mono, 24 kHz, 32 kbps). `\n\n` in `text` = 0.45 s pause |
| `POST /stt` | raw audio body ≤ 3 MB (+64 KB slack) | `200 {text, language:"en", durationMs}`; 413 `too_large`/`too_long` (>120 s), 415 `unsupported_audio` |

Errors: 401 `unauthorized` (`hmac.compare_digest`), 503 `busy` (no slot within 20 s),
504 `timeout`. No docs/OpenAPI routes. Audio and text are never logged (uvicorn access
log off); uploads go to a temp file deleted in `finally`; ffmpeg runs with
`-protocol_whitelist file` and a demuxer whitelist; anything it can't decode is 415.
Clients cannot choose or load models: the only inputs are text/audio, a fixed voice and a speed.

Env (service): `SPEECH_SERVICE_TOKEN` (required), `PORT` (8000), `SPEECH_NUM_THREADS`
(2, ONNX threads per model call), `SPEECH_MAX_CONCURRENCY` (1, inference slots),
`SPEECH_MODEL_TTL` (120 s idle before unload; 0 = never), `SPEECH_TTS_TIMEOUT` (55),
`SPEECH_STT_TIMEOUT` (85), `SPEECH_QUEUE_TIMEOUT` (20), `SPEECH_MODEL_DIR` (`/models`).
The Dockerfile sets `OMP_NUM_THREADS=1`, `OPENBLAS_NUM_THREADS=1`, `MALLOC_ARENA_MAX=2`.
Of the brief's target variables: `WEB_CONCURRENCY=1` is what `app/serve.py` hard-codes
(one uvicorn worker, so models are never duplicated); `USE_GPU`, `WHISPER__INFERENCE_DEVICE`
and `WHISPER__COMPUTE_TYPE` are Speaches settings and mean nothing here (this service
is CPU-only and uses the int8 Whisper files by construction).

## Backend behaviour

- Narration text comes only from the DB row; parts ≤ 400 chars; authorization as for
  history; every failure is the same 404. Audio is streamed through, never stored.
- **Wake-up**: a connection error or 502 from the speech service is retried every 3 s,
  up to 6 attempts, inside the request timeout (90 s narration part, 120 s
  transcription). Other errors are not retried.
- Limits per user: 30 narration parts/min and **200/day**; 10 transcriptions/min and
  **60/day**. Global: **200 speech requests/day** for all users together
  (`SPEECH_REQUESTS_PER_DAY`, `SPEECH_NARRATION_PARTS_PER_USER_DAY`,
  `SPEECH_TRANSCRIPTIONS_PER_USER_DAY`). Over a daily limit: 429 `quota_exceeded`. In
  memory, so a backend restart resets them.

## Storage

Models are downloaded **at image build time** from the sherpa-onnx GitHub releases and
checked against sha256 pins; nothing downloads at runtime. **No Railway volume is
needed** (cost $0, nothing to keep in sync, and a sleeping service wakes without any
download). A 1 GB volume would fit the 517 MB of models, but it would only matter for a
framework that fetches models at runtime (e.g. Speaches); it is not attached.

## Cost (Railway pricing from docs.railway.com, read 2026-10-20: RAM $10/GB-month, CPU $20/vCPU-month, egress $0.05/GB, volume $0.15/GB-month)

**Estimates, not measurements on Railway.** Inputs: the RSS and timings above.

- Asleep: $0. Awake with nothing loaded: ~0.09 GB → ≈ $0.03/day if it never slept.
- Loaded: ~1.1 GB → ≈ $0.00025 per loaded minute. Each request keeps models loaded for
  its duration + `SPEECH_MODEL_TTL` (2 min).
- CPU: a 400-char part ≈ 10 s × 2 vCPU ≈ $0.00015; a 30 s dictation ≈ 5 s × 2 vCPU ≈ $0.00008.
- Egress: speech traffic is on the private network (free); the backend → phone audio is
  ~80 KB per part ($0.000004).
- **Typical** (a couple: ~10 letters read + ~30 dictations a day, in ~20 bursts): ≈ 20 ×
  6 min loaded ≈ $0.9/month RAM + $0.2 CPU ≈ **$1–1.5/month**.
- **Worst case under the global quota** (200 requests/day spaced so the models never
  unload between them, service never sleeps): 400 loaded min/day ≈ $3.0 + CPU ≈ $0.9 +
  idle ≈ $0.9 ≈ **$4.9/month**. Raising `SPEECH_REQUESTS_PER_DAY` raises this
  ceiling by about $0.02 per extra daily request.

**Railway cannot cap one service at $5.** The workspace **hard usage limit** (minimum
$10) takes **every** service offline, backend included, so it is not a per-service
budget. What this design uses instead: Serverless sleep, a replica memory/CPU limit on
`speech` only, lazy load + idle unload, and the backend quotas above. Set a workspace
**custom email alert** (soft limit) so a surprise is visible early.

## Railway setup (owner; nothing here was deployed by Claude)

1. Same project + environment as the backend: **New → GitHub Repo →
   `aarahman04/One-on-One`**, service name **`speech`** (private host `speech.railway.internal`).
   It must be a service **inside the backend's project** (`fabulous-connection`), not a project of
   its own: `*.railway.internal` only resolves within one project. (2026-10-20: a separate `speech`
   project plus an empty backend `SPEECH_SERVICE_TOKEN` made every speech call 503 until moved.)
2. Settings → Source: **Root Directory `speech`** (uses `speech/Dockerfile`); watch path `speech/**`.
3. **No public domain.** Private networking stays on.
4. Variables on `speech`: `SPEECH_SERVICE_TOKEN` = long random secret (`openssl rand -base64 48`),
   `PORT=8000`, `SPEECH_NUM_THREADS=2`, `SPEECH_MAX_CONCURRENCY=1`, `SPEECH_MODEL_TTL=120`.
5. Settings → Deploy: healthcheck path `/health` (timeout 120 s), 1 replica,
   restart on failure. **Serverless: on.** **Replica limits: 2 vCPU, 2 GB memory**
   (peak measured 1.5 GB; a limit only caps, billing is on actual use).
6. Variables on the **backend**: `SPEECH_SERVICE_URL=http://speech.railway.internal:8000`,
   `SPEECH_SERVICE_TOKEN=${{speech.SPEECH_SERVICE_TOKEN}}` (add the reference only after the `speech`
   service exists, otherwise it resolves to an empty string); optionally the three quota
   variables. Redeploy the backend. Without the two URL/token variables the speech
   routes answer 503 `speech_unavailable` and nothing else changes.
7. Workspace → Usage: set a **custom email alert** (e.g. at your current monthly
   usage + $5). Consider a hard limit only knowing it stops everything.
8. Android: build with `SERVER_SPEECH=true` (until then the app uses the device voice
   and device recognition).
9. Smoke test: play a letter (first one after a while includes the wake-up), dictate a
   short phrase, check the speech service's memory graph drops after ~2 minutes idle
   and the service shows as sleeping after ~10.

Infrastructure as Code: `speech/.railway/railway.ts` is a **named partial** (`speech`)
that declares only this service (source/root dir, healthcheck, 1 replica, non-secret
variables, token as `preserve()`). From `speech/`: `npm install railway`,
`railway link`, `railway config plan` — the plan must show only the `speech` service —
then `railway config apply`. A named partial never deletes or changes resources it
does not own, so the backend is untouched. Serverless, replica limits and "no public
domain" are dashboard settings (not expressible in the IaC reference as of 2026-10-17).
Railway's older `railway.json` (Config as Code) is deprecated and **cannot be enabled
for new services**, so none is provided.

## Languages and limitations

- STT is **English only** (Whisper base.en): Hindi, Urdu, Telugu etc. give wrong or empty
  text. 2.0.6's Parakeet covered 25 European languages but no Indian languages either.
- TTS voice `af_heart` is American English.
- First request after sleep waits for the wake-up: Railway documents a possible 502 on
  that first request (retried by the backend); total wake time on Railway is not measured yet.
- Single replica, in-process limits: a restart drops in-flight requests and resets quotas.
- sha256 pins were recorded from the assets as downloaded (Kokoro, VAD: 2026-10-19;
  Whisper base.en: 2026-10-20). sherpa-onnx publishes no checksums; a re-upload fails the build.
