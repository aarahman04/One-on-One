"""Private speech service: Kokoro-82M TTS + Parakeet TDT 0.6B v3 STT on sherpa-onnx.

Reached only from the backend over Railway private networking. Every route but
/health needs X-Speech-Token. Audio and text are never logged.
"""
import asyncio
import hmac
import os
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from . import audio

MODEL_DIR = os.environ.get("SPEECH_MODEL_DIR", "/models")
MAX_CONCURRENCY = int(os.environ.get("SPEECH_MAX_CONCURRENCY", "2"))
NUM_THREADS = int(os.environ.get("SPEECH_NUM_THREADS", "2"))
TTS_TIMEOUT = float(os.environ.get("SPEECH_TTS_TIMEOUT", "55"))
STT_TIMEOUT = float(os.environ.get("SPEECH_STT_TIMEOUT", "85"))
QUEUE_TIMEOUT = float(os.environ.get("SPEECH_QUEUE_TIMEOUT", "20"))
MAX_TTS_CHARS = 1200
MAX_STT_BYTES = 3 * 1024 * 1024 + 64 * 1024
VOICES = {"af_heart": 3}  # Kokoro v1.0 speaker id (model metadata speaker2id)
PARAGRAPH_PAUSE_S = 0.45
MIN_SPEECH_S = 0.25

models: dict = {}
ready = threading.Event()
load_error: list[str] = []


def check_token(given: str | None, expected: str) -> bool:
    return bool(expected) and given is not None and hmac.compare_digest(given.encode(), expected.encode())


def paragraphs(text: str) -> list[str]:
    return [p.strip() for p in text.split("\n\n") if p.strip()]


def load_models() -> None:
    import sherpa_onnx as so

    t0 = time.monotonic()
    k = f"{MODEL_DIR}/kokoro"
    models["tts"] = so.OfflineTts(so.OfflineTtsConfig(
        model=so.OfflineTtsModelConfig(
            kokoro=so.OfflineTtsKokoroModelConfig(
                model=f"{k}/model.onnx", voices=f"{k}/voices.bin", tokens=f"{k}/tokens.txt",
                data_dir=f"{k}/espeak-ng-data", dict_dir=f"{k}/dict",
                lexicon=f"{k}/lexicon-us-en.txt,{k}/lexicon-zh.txt", lang="en-us",
            ),
            num_threads=NUM_THREADS,
        ),
        max_num_sentences=1,
    ))
    p = f"{MODEL_DIR}/parakeet"
    models["stt"] = so.OfflineRecognizer.from_transducer(
        encoder=f"{p}/encoder.int8.onnx", decoder=f"{p}/decoder.int8.onnx", joiner=f"{p}/joiner.int8.onnx",
        tokens=f"{p}/tokens.txt", num_threads=NUM_THREADS, model_type="nemo_transducer",
    )
    models["vad_config"] = so.VadModelConfig(
        silero_vad=so.SileroVadModelConfig(
            model=f"{MODEL_DIR}/silero_vad.onnx", threshold=0.5,
            min_silence_duration=0.25, min_speech_duration=0.25, window_size=512,
        ),
        sample_rate=audio.STT_RATE, num_threads=1,
    )
    models["load_seconds"] = round(time.monotonic() - t0, 2)
    ready.set()


def _load_in_background() -> None:
    try:
        load_models()
    except Exception as e:  # surfaced via /health only as "failed"
        load_error.append(type(e).__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not os.environ.get("SPEECH_SERVICE_TOKEN"):
        raise RuntimeError("SPEECH_SERVICE_TOKEN is required")
    app.state.sem = asyncio.Semaphore(MAX_CONCURRENCY)
    app.state.pool = ThreadPoolExecutor(max_workers=MAX_CONCURRENCY)
    if not os.environ.get("SPEECH_SKIP_MODELS"):  # tests only
        threading.Thread(target=_load_in_background, daemon=True).start()
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
    if not ready.is_set():
        return err(503, "not_ready")
    return await call_next(request)


@app.get("/health")
async def health():
    if load_error:
        return JSONResponse({"status": "failed"}, status_code=503)
    if not ready.is_set():
        return JSONResponse({"status": "loading"}, status_code=503)
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
    tts = models["tts"]
    rate = tts.sample_rate
    pause = np.zeros(int(rate * PARAGRAPH_PAUSE_S), dtype=np.float32)
    chunks: list[np.ndarray] = []
    for i, para in enumerate(paragraphs(text)):
        if i:
            chunks.append(pause)
        chunks.append(np.asarray(tts.generate(para, sid=sid, speed=speed).samples, dtype=np.float32))
    return audio.encode_ogg_opus(np.concatenate(chunks), rate, timeout=TTS_TIMEOUT)


def speech_seconds(samples: np.ndarray) -> float:
    import sherpa_onnx as so

    vad = so.VoiceActivityDetector(models["vad_config"], buffer_size_in_seconds=audio.MAX_STT_SECONDS + 10)
    window = 512
    for i in range(0, len(samples) - window + 1, window):
        vad.accept_waveform(samples[i:i + window])
    vad.flush()
    total = 0
    while not vad.empty():
        total += len(vad.front.samples)
        vad.pop()
    return total / audio.STT_RATE


def recognize(data: bytes) -> dict:
    samples = audio.decode_to_pcm16k(data, timeout=STT_TIMEOUT)
    duration_ms = int(len(samples) * 1000 / audio.STT_RATE)
    # Silence guard: no detected speech -> empty text, never a hallucinated guess.
    if speech_seconds(samples) < MIN_SPEECH_S:
        return {"text": "", "language": "", "durationMs": duration_ms}
    stream = models["stt"].create_stream()
    stream.accept_waveform(audio.STT_RATE, samples)
    models["stt"].decode_stream(stream)
    result = stream.result
    return {"text": result.text.strip(), "language": getattr(result, "lang", "") or "", "durationMs": duration_ms}


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
