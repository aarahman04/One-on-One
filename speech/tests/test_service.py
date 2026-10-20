import os
import shutil
import subprocess

import numpy as np
import pytest

os.environ["SPEECH_SERVICE_TOKEN"] = "test-token"

from fastapi.testclient import TestClient  # noqa: E402

from app import audio, main  # noqa: E402

HAS_MODELS = os.path.exists(os.path.join(main.MODEL_DIR, "whisper", "base.en-tokens.txt"))
HAS_FFMPEG = shutil.which("ffmpeg") is not None


def test_check_token_constant_time_and_strict():
    assert main.check_token("abc", "abc")
    assert not main.check_token("abd", "abc")
    assert not main.check_token(None, "abc")
    assert not main.check_token("", "")  # unset server token never matches


def test_paragraphs_split_on_blank_lines_only():
    assert main.paragraphs("Dear Sam.\n\nOne. Two.\n\n\n\nWith love, A.") == ["Dear Sam.", "One. Two.", "With love, A."]


def test_auth_and_health():
    with TestClient(main.app) as c:
        # Ready without loading anything: models load on first use.
        assert c.get("/health").json() == {"status": "ready"}
        assert c.post("/tts", json={"text": "hi"}).status_code == 401
        assert c.post("/tts", json={"text": "hi"}, headers={"X-Speech-Token": "nope"}).status_code == 401
        assert c.post("/stt", content=b"x", headers={"Authorization": "Bearer test-token"}).status_code == 401
        assert c.post("/tts", json={"text": ""}, headers={"X-Speech-Token": "test-token"}).status_code == 400
        assert c.post("/tts", json={"text": "hi", "voice": "other"}, headers={"X-Speech-Token": "test-token"}).status_code == 400


def test_lazy_model_loads_once_and_unloads_only_when_idle():
    loads = []
    m = main.LazyModel(lambda: loads.append(1) or object())
    assert not m.unload_if_idle(0)  # nothing loaded
    with m.use() as a:
        with m.use() as b:
            assert a is b
        assert not m.unload_if_idle(0)  # still in use
    assert len(loads) == 1
    assert not m.unload_if_idle(3600)  # not idle long enough
    assert m.unload_if_idle(0)
    with m.use():
        pass
    assert len(loads) == 2


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg not installed")
def test_decode_rejects_non_audio_and_overlong():
    with pytest.raises(audio.BadAudio):
        audio.decode_to_pcm16k(b"definitely not audio" * 200, timeout=10)
    long_wav = subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono", "-t", "121", "-f", "wav", "pipe:1"],
        capture_output=True, check=True,
    ).stdout
    with pytest.raises(audio.TooLong):
        audio.decode_to_pcm16k(long_wav, timeout=30)


@pytest.mark.skipif(not (HAS_MODELS and HAS_FFMPEG), reason="models not present (set SPEECH_MODEL_DIR)")
def test_silence_and_noise_return_empty_text():
    for src in ("anullsrc=r=16000:cl=mono", "anoisesrc=r=16000:a=0.02"):
        wav = subprocess.run(
            ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", src, "-t", "5", "-f", "wav", "pipe:1"],
            capture_output=True, check=True,
        ).stdout
        assert main.recognize(wav)["text"] == ""


@pytest.mark.skipif(not (HAS_MODELS and HAS_FFMPEG), reason="models not present (set SPEECH_MODEL_DIR)")
def test_long_speech_is_cut_at_pauses_under_whisper_window():
    # 70 s: 1.4 s tone bursts separated by 0.6 s of silence stand in for speech with pauses.
    rate = 16000
    t = np.arange(int(1.4 * rate)) / rate
    burst = (0.3 * np.sin(2 * np.pi * 220 * t) * np.sin(2 * np.pi * 3 * t) ** 2).astype(np.float32)
    samples = np.concatenate([np.concatenate([burst, np.zeros(int(0.6 * rate), np.float32)]) for _ in range(35)])
    chunks = main.speech_chunks(samples)
    assert all(len(c) <= main.MAX_CHUNK_S * rate for c in chunks)
