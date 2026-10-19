# Private speech service (Kokoro-82M TTS + Parakeet TDT 0.6B v3 STT), CPU only.
# Models are fetched at BUILD time and sha256-verified; nothing downloads at runtime.
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
ARG PARAKEET_URL=https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2
ARG PARAKEET_SHA256=5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf
ARG VAD_URL=https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx
ARG VAD_SHA256=9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6

RUN set -eux; mkdir -p /models; cd /models; \
    curl -fsSL -o kokoro.tar.bz2 "$KOKORO_URL"; \
    echo "$KOKORO_SHA256  kokoro.tar.bz2" | sha256sum -c -; \
    tar xjf kokoro.tar.bz2; mv kokoro-multi-lang-v1_0 kokoro; rm kokoro.tar.bz2; \
    curl -fsSL -o parakeet.tar.bz2 "$PARAKEET_URL"; \
    echo "$PARAKEET_SHA256  parakeet.tar.bz2" | sha256sum -c -; \
    tar xjf parakeet.tar.bz2; mv sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8 parakeet; rm -rf parakeet.tar.bz2 parakeet/test_wavs; \
    curl -fsSL -o silero_vad.onnx "$VAD_URL"; \
    echo "$VAD_SHA256  silero_vad.onnx" | sha256sum -c -; \
    chmod -R a+rX /models

COPY app ./app

ENV SPEECH_MODEL_DIR=/models PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
USER nobody
EXPOSE 8000
# Listens dual-stack on [::]:$PORT (Railway private networking is IPv6; PORT is injected).
CMD ["python", "-m", "app.serve"]
