# Private speech service (Kokoro-82M TTS + Whisper base.en STT), CPU only.
# Models are fetched at BUILD time and sha256-verified; nothing downloads at runtime,
# so no volume is needed (docs/SPEECH-SERVICE.md "Storage").
FROM python:3.12-slim-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl bzip2 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# sherpa-onnx release assets. The tags are rolling, so the sha256 pins are what
# make the build reproducible: a changed asset fails the build.
ARG KOKORO_URL=https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2
ARG KOKORO_SHA256=c5f7e2d2caf082bc1d20fb70334a61d99d20b484500aad32e7cf84c128ea3298
ARG WHISPER_URL=https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.en.tar.bz2
ARG WHISPER_SHA256=475bc7052ce299c007f6d5d5407ba8601f819a2867f6eecee510ed17df581542
ARG VAD_URL=https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx
ARG VAD_SHA256=9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6

RUN set -eux; mkdir -p /models; cd /models; \
    curl -fsSL -o kokoro.tar.bz2 "$KOKORO_URL"; \
    echo "$KOKORO_SHA256  kokoro.tar.bz2" | sha256sum -c -; \
    # English only: the model, voices, tokens, espeak data and the US lexicon (the Chinese assets are dropped).
    tar xjf kokoro.tar.bz2 kokoro-multi-lang-v1_0/model.onnx kokoro-multi-lang-v1_0/voices.bin kokoro-multi-lang-v1_0/tokens.txt \
        kokoro-multi-lang-v1_0/lexicon-us-en.txt kokoro-multi-lang-v1_0/espeak-ng-data kokoro-multi-lang-v1_0/LICENSE; \
    mv kokoro-multi-lang-v1_0 kokoro; rm kokoro.tar.bz2; \
    curl -fsSL -o whisper.tar.bz2 "$WHISPER_URL"; \
    echo "$WHISPER_SHA256  whisper.tar.bz2" | sha256sum -c -; \
    # int8 weights only (the fp32 pair is 2x the size and not used).
    tar xjf whisper.tar.bz2 sherpa-onnx-whisper-base.en/base.en-encoder.int8.onnx sherpa-onnx-whisper-base.en/base.en-decoder.int8.onnx \
        sherpa-onnx-whisper-base.en/base.en-tokens.txt; \
    mv sherpa-onnx-whisper-base.en whisper; rm whisper.tar.bz2; \
    curl -fsSL -o silero_vad.onnx "$VAD_URL"; \
    echo "$VAD_SHA256  silero_vad.onnx" | sha256sum -c -; \
    chmod -R a+rX /models

COPY app ./app

# One process, one inference slot; ONNX Runtime threads come from SPEECH_NUM_THREADS, these cap any
# OpenMP/BLAS pools a dependency might start.
ENV SPEECH_MODEL_DIR=/models PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MALLOC_ARENA_MAX=2
USER nobody
EXPOSE 8000
# Listens dual-stack on [::]:$PORT (Railway private networking is IPv6; PORT is injected).
CMD ["python", "-m", "app.serve"]
