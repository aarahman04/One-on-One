# Third-party models and software in the speech service

The service runs on our own Railway project. No paid API and no third-party
hosted inference is used. Models are baked into the image at build time.

| Component | Use | Licence | Source |
|---|---|---|---|
| Kokoro-82M v1.0 (hexgrad), fp32 ONNX export by sherpa-onnx (`kokoro-multi-lang-v1_0`, English assets only), voice `af_heart` (speaker id 3) | Letter narration (TTS) | Apache-2.0 | https://huggingface.co/hexgrad/Kokoro-82M, https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models |
| OpenAI Whisper base.en, int8 ONNX export by sherpa-onnx (`sherpa-onnx-whisper-base.en`, int8 files only) | Speech-to-text (2.0.7; replaced Parakeet TDT 0.6B v3) | MIT | https://github.com/openai/whisper, https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models |
| Silero VAD (`silero_vad.onnx`) | Silence guard and pause-based chunking before STT | MIT | https://github.com/snakers4/silero-vad |
| sherpa-onnx 1.13.8 (k2-fsa) | ONNX runtime wrapper for all three models | Apache-2.0 | https://github.com/k2-fsa/sherpa-onnx |
| ONNX Runtime (bundled in sherpa-onnx wheels) | Inference | MIT | https://github.com/microsoft/onnxruntime |
| eSpeak NG + `espeak-ng-data` (bundled in sherpa-onnx and the Kokoro archive) | Kokoro phonemisation | GPL-3.0-or-later | https://github.com/espeak-ng/espeak-ng |
| FFmpeg (Debian bookworm package) | Decode uploads, encode Ogg Opus | LGPL-2.1+/GPL-2+ (Debian build) | https://ffmpeg.org |
| FastAPI, Starlette, Pydantic, Uvicorn, NumPy | HTTP service | MIT / BSD-3-Clause | PyPI |

## Attribution

No model in 2.0.7 requires an in-app attribution (Parakeet's CC-BY-4.0 notice was
needed only while it was used, 2.0.6). Keep the MIT/Apache notices above.

## Notes

- Kokoro: Apache-2.0 permits commercial use; keep the licence notice.
- eSpeak NG is GPL-3.0. It runs only on our server and is not distributed to
  users, so GPL source-distribution duties are not triggered by this use. If this
  image is ever distributed to others, ship the corresponding source/notice.
- The sherpa-onnx release tags (`tts-models`, `asr-models`) are rolling; the
  Dockerfile pins every asset by sha256 so a changed upload fails the build.
  The hashes were recorded from the assets downloaded on 2026-10-19 (Kokoro, VAD)
  and 2026-10-20 (Whisper base.en); sherpa-onnx does not publish checksums for them.
