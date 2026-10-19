import os
import shutil
import subprocess

import pytest

os.environ["SPEECH_SERVICE_TOKEN"] = "test-token"
os.environ["SPEECH_SKIP_MODELS"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

from app import audio, main  # noqa: E402

HAS_MODELS = os.path.exists(os.path.join(main.MODEL_DIR, "parakeet", "tokens.txt"))
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
        assert c.get("/health").status_code == 503  # models not loaded
        assert c.get("/health").json() == {"status": "loading"}
        assert c.post("/tts", json={"text": "hi"}).status_code == 401
        assert c.post("/tts", json={"text": "hi"}, headers={"X-Speech-Token": "nope"}).status_code == 401
        assert c.post("/tts", json={"text": "hi"}, headers={"X-Speech-Token": "test-token"}).status_code == 503


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
    if not main.ready.is_set():
        main.load_models()
    for src in ("anullsrc=r=16000:cl=mono", "anoisesrc=r=16000:a=0.02"):
        wav = subprocess.run(
            ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", src, "-t", "5", "-f", "wav", "pipe:1"],
            capture_output=True, check=True,
        ).stdout
        assert main.recognize(wav)["text"] == ""
