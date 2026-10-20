"""Private speech service: Kokoro-82M TTS + Whisper base.en STT on sherpa-onnx.

Reached only from the backend over Railway private networking. Every route but
/health needs X-Speech-Token. Audio and text are never logged.

Models load on first use and are unloaded after SPEECH_MODEL_TTL idle seconds,
so an idle service holds ~55-95 MB instead of ~0.8-1.1 GB (docs/SPEECH-SERVICE.md).
"""
import asyncio
import ctypes
import gc
import hmac
import os
import re
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager, contextmanager

import numpy as np
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from . import audio

MODEL_DIR = os.environ.get("SPEECH_MODEL_DIR", "/models")
MAX_CONCURRENCY = int(os.environ.get("SPEECH_MAX_CONCURRENCY", "1"))
NUM_THREADS = int(os.environ.get("SPEECH_NUM_THREADS", "2"))
TTS_TIMEOUT = float(os.environ.get("SPEECH_TTS_TIMEOUT", "55"))
STT_TIMEOUT = float(os.environ.get("SPEECH_STT_TIMEOUT", "85"))
QUEUE_TIMEOUT = float(os.environ.get("SPEECH_QUEUE_TIMEOUT", "20"))
# Idle seconds before a model is unloaded; 0 keeps models loaded.
MODEL_TTL = float(os.environ.get("SPEECH_MODEL_TTL", "120"))
MAX_TTS_CHARS = 1200
MAX_STT_BYTES = 3 * 1024 * 1024 + 64 * 1024
VOICES = {"af_heart": 3}  # Kokoro v1.0 speaker id (model metadata speaker2id)
PARAGRAPH_PAUSE_S = 0.45
MIN_SPEECH_S = 0.25
# Whisper reads at most 30 s per pass: speech is cut at VAD pauses into pieces this long or shorter.
MAX_CHUNK_S = 25
# Whisper's non-speech captions, e.g. "(buzzing)" or "[ Silence ]".
CAPTION_RE = re.compile(r"\s*[\[(][^\])]*[\])]\s*")



class LazyModel:
    """One model, loaded on first use and dropped after MODEL_TTL idle seconds."""

    def __init__(self, factory):
        self.factory = factory
        self.obj = None
        self.users = 0
        self.last = 0.0
        self.lock = threading.Lock()

    @contextmanager
    def use(self):
        with self.lock:  # concurrent first users wait for one load
            if self.obj is None:
                self.obj = self.factory()
            self.users += 1
            obj = self.obj
        try:
            yield obj
        finally:
            with self.lock:
                self.users -= 1
                self.last = time.monotonic()

    def unload_if_idle(self, ttl: float) -> bool:
        with self.lock:
            if self.obj is None or self.users or time.monotonic() - self.last < ttl:
                return False
            self.obj = None
            return True


def check_token(given: str | None, expected: str) -> bool:
    return bool(expected) and given is not None and hmac.compare_digest(given.encode(), expected.encode())


def paragraphs(text: str) -> list[str]:
    return [p.strip() for p in text.split("\n\n") if p.strip()]


def _load_tts():
    import sherpa_onnx as so

    k = f"{MODEL_DIR}/kokoro"
    return so.OfflineTts(so.OfflineTtsConfig(
        model=so.OfflineTtsModelConfig(
            kokoro=so.OfflineTtsKokoroModelConfig(
                model=f"{k}/model.onnx", voices=f"{k}/voices.bin", tokens=f"{k}/tokens.txt",
                data_dir=f"{k}/espeak-ng-data", lexicon=f"{k}/lexicon-us-en.txt", lang="en-us",
            ),
            num_threads=NUM_THREADS,
        ),
        max_num_sentences=1,
    ))


def _load_stt():
    import sherpa_onnx as so

    w = f"{MODEL_DIR}/whisper"
    return so.OfflineRecognizer.from_whisper(
        encoder=f"{w}/base.en-encoder.int8.onnx", decoder=f"{w}/base.en-decoder.int8.onnx",
        tokens=f"{w}/base.en-tokens.txt", num_threads=NUM_THREADS, language="en", task="transcribe",
    )


def _vad_config():
    import sherpa_onnx as so

    return so.VadModelConfig(
        silero_vad=so.SileroVadModelConfig(
            model=f"{MODEL_DIR}/silero_vad.onnx", threshold=0.5,
            min_silence_duration=0.25, min_speech_duration=0.25, window_size=512,
            max_speech_duration=MAX_CHUNK_S - 5,
        ),
        sample_rate=audio.STT_RATE, num_threads=1,
    )


models = {"tts": LazyModel(_load_tts), "stt": LazyModel(_load_stt)}


def _trim() -> None:
    """Hand freed model memory back to the OS (glibc keeps it otherwise)."""
    gc.collect()
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except OSError:
        pass


def _reaper() -> None:
    while True:
        time.sleep(max(5.0, min(30.0, MODEL_TTL / 4)))
        if any([m.unload_if_idle(MODEL_TTL) for m in models.values()]):
            _trim()


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not os.environ.get("SPEECH_SERVICE_TOKEN"):
        raise RuntimeError("SPEECH_SERVICE_TOKEN is required")
    app.state.sem = asyncio.Semaphore(MAX_CONCURRENCY)
    app.state.pool = ThreadPoolExecutor(max_workers=MAX_CONCURRENCY)
    if MODEL_TTL > 0:
        threading.Thread(target=_reaper, daemon=True).start()
    yield
    app.state.pool.shutdown(wait=False, cancel_futures=True)


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def err(status: int, code: str) -> JSONResponse:
    return JSONResponse({"error": code, "code": code}, status_code=status)


@app.middleware("http")
async def require_token(request: Request, call_next):
    if request.url.path == "/health":
        return await call_next(request)
    if not check_token(request.headers.get("x-speech-token"), os.environ.get("SPEECH_SERVICE_TOKEN", "")):
        return err(401, "unauthorized")
    return await call_next(request)


@app.get("/health")
async def health():
    # Ready as soon as the process serves; models load on the first request that needs them.
    return {"status": "ready"}


async def run_bounded(request: Request, fn, timeout: float):
    """Bounded concurrency + thread pool so the event loop (and /health) stays
    responsive. The slot is released when the work really ends, not on timeout."""
    sem: asyncio.Semaphore = request.app.state.sem
    try:
        await asyncio.wait_for(sem.acquire(), QUEUE_TIMEOUT)
    except TimeoutError:
        raise Busy()
    fut = asyncio.get_running_loop().run_in_executor(request.app.state.pool, fn)
    fut.add_done_callback(lambda _: sem.release())
    return await asyncio.wait_for(asyncio.shield(fut), timeout)


class Busy(Exception):
    pass


def synthesize(text: str, sid: int, speed: float) -> bytes:
    with models["tts"].use() as tts:
        rate = tts.sample_rate
        pause = np.zeros(int(rate * PARAGRAPH_PAUSE_S), dtype=np.float32)
        chunks: list[np.ndarray] = []
        for i, para in enumerate(paragraphs(text)):
            if i:
                chunks.append(pause)
            chunks.append(np.asarray(tts.generate(para, sid=sid, speed=speed).samples, dtype=np.float32))
    return audio.encode_ogg_opus(np.concatenate(chunks), rate, timeout=TTS_TIMEOUT)


def speech_chunks(samples: np.ndarray) -> list[np.ndarray]:
    """Speech only (silence dropped), cut at VAD pauses into pieces of at most MAX_CHUNK_S."""
    import sherpa_onnx as so

    vad = so.VoiceActivityDetector(_vad_config(), buffer_size_in_seconds=audio.MAX_STT_SECONDS + 10)
    window = 512
    for i in range(0, len(samples) - window + 1, window):
        vad.accept_waveform(samples[i:i + window])
    vad.flush()
    segments = []
    while not vad.empty():
        segments.append(np.asarray(vad.front.samples, dtype=np.float32))
        vad.pop()
    if sum(len(s) for s in segments) < MIN_SPEECH_S * audio.STT_RATE:
        return []
    gap = np.zeros(int(0.2 * audio.STT_RATE), dtype=np.float32)
    limit = MAX_CHUNK_S * audio.STT_RATE
    chunks: list[np.ndarray] = []
    current: list[np.ndarray] = []
    size = 0
    for seg in segments:
        if current and size + len(gap) + len(seg) > limit:
            chunks.append(np.concatenate(current))
            current, size = [], 0
        if current:
            current.append(gap)
            size += len(gap)
        current.append(seg)
        size += len(seg)
    if current:
        chunks.append(np.concatenate(current))
    return chunks


def recognize(data: bytes) -> dict:
    samples = audio.decode_to_pcm16k(data, timeout=STT_TIMEOUT)
    duration_ms = int(len(samples) * 1000 / audio.STT_RATE)
    # Silence guard: no detected speech -> empty text, never a hallucinated guess.
    chunks = speech_chunks(samples)
    if not chunks:
        return {"text": "", "language": "", "durationMs": duration_ms}
    texts = []
    with models["stt"].use() as stt:
        for chunk in chunks:
            stream = stt.create_stream()
            stream.accept_waveform(audio.STT_RATE, chunk)
            stt.decode_stream(stream)
            texts.append(CAPTION_RE.sub(" ", stream.result.text).strip())
    return {"text": " ".join(t for t in texts if t), "language": "en", "durationMs": duration_ms}


@app.post("/tts")
async def tts(request: Request):
    try:
        body = await request.json()
    except Exception:
        return err(400, "bad_request")
    text = body.get("text") if isinstance(body, dict) else None
    voice = body.get("voice", "af_heart") if isinstance(body, dict) else None
    speed = body.get("speed", 1.0) if isinstance(body, dict) else None
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_TTS_CHARS:
        return err(400, "bad_text")
    if voice not in VOICES or not isinstance(speed, (int, float)) or not 0.5 <= speed <= 2.0:
        return err(400, "bad_voice")
    try:
        ogg = await run_bounded(request, lambda: synthesize(text, VOICES[voice], float(speed)), TTS_TIMEOUT)
    except Busy:
        return err(503, "busy")
    except (TimeoutError, subprocess.TimeoutExpired):
        return err(504, "timeout")
    return Response(ogg, media_type="audio/ogg", headers={"Cache-Control": "no-store"})


@app.post("/stt")
async def stt(request: Request):
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_STT_BYTES:
        return err(413, "too_large")
    data = await request.body()
    if len(data) > MAX_STT_BYTES:
        return err(413, "too_large")
    if not data:
        return err(415, "unsupported_audio")
    try:
        out = await run_bounded(request, lambda: recognize(data), STT_TIMEOUT)
    except audio.BadAudio:
        return err(415, "unsupported_audio")
    except audio.TooLong:
        return err(413, "too_long")
    except Busy:
        return err(503, "busy")
    except (TimeoutError, subprocess.TimeoutExpired):
        return err(504, "timeout")
    return out
