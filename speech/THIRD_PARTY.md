# Third-party models and software in the speech service

The service runs on our own Railway project. No paid API and no third-party
hosted inference is used. Models are baked into the image at build time.

| Component | Use | Licence | Source |
|---|---|---|---|
| Kokoro-82M v1.0 (hexgrad), int8 ONNX export by sherpa-onnx (`kokoro-int8-multi-lang-v1_0`), voice `af_heart` (speaker id 3) | Letter narration (TTS) | Apache-2.0 | https://huggingface.co/hexgrad/Kokoro-82M, https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models |
| NVIDIA Parakeet TDT 0.6B v3, int8 ONNX export by sherpa-onnx (`sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8`) | Speech-to-text | **CC-BY-4.0, attribution required** | https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3, https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models |
| Silero VAD (`silero_vad.onnx`) | Silence guard before STT | MIT | https://github.com/snakers4/silero-vad |
| sherpa-onnx 1.13.8 (k2-fsa) | ONNX runtime wrapper for all three models | Apache-2.0 | https://github.com/k2-fsa/sherpa-onnx |
| ONNX Runtime (bundled in sherpa-onnx wheels) | Inference | MIT | https://github.com/microsoft/onnxruntime |
| eSpeak NG + `espeak-ng-data` (bundled in sherpa-onnx and the Kokoro archive) | Kokoro phonemisation | GPL-3.0-or-later | https://github.com/espeak-ng/espeak-ng |
| cppjieba dictionaries (`dict/` in the Kokoro archive, unused for English) | Chinese segmentation | MIT | https://github.com/yanyiwu/cppjieba |
| FFmpeg (Debian bookworm package) | Decode uploads, encode Ogg Opus | LGPL-2.1+/GPL-2+ (Debian build) | https://ffmpeg.org |
| FastAPI, Starlette, Pydantic, Uvicorn, NumPy | HTTP service | MIT / BSD-3-Clause | PyPI |

## Required attribution (Parakeet, CC-BY-4.0)

> Speech recognition uses NVIDIA Parakeet TDT 0.6B v3 by NVIDIA, licensed under
> CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Converted to int8
> ONNX by the sherpa-onnx project. No changes were made to the model weights
> beyond that conversion.

Show this text in the app's open-source / licences screen.

## Notes

- Kokoro: Apache-2.0 permits commercial use; keep the licence notice.
- eSpeak NG is GPL-3.0. It runs only on our server and is not distributed to
  users, so GPL source-distribution duties are not triggered by this use. If this
  image is ever distributed to others, ship the corresponding source/notice.
- The sherpa-onnx release tags (`tts-models`, `asr-models`) are rolling; the
  Dockerfile pins every asset by sha256 so a changed upload fails the build.
  The hashes were recorded from the assets downloaded on 2026-10-19; sherpa-onnx
  does not publish checksums for them.
