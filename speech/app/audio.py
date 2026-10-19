"""ffmpeg helpers. Audio and text are never logged."""
import os
import subprocess
import tempfile

import numpy as np

STT_RATE = 16000
MAX_STT_SECONDS = 120
# Demuxers allowed for uploads (Android sends AAC in MP4/M4A). Only local file
# input: no network/concat/playlist tricks inside a crafted container.
DEMUXERS = "mov,mp4,m4a,3gp,3g2,mj2,aac,ogg,matroska,webm,wav"


class BadAudio(Exception):
    pass


class TooLong(Exception):
    pass


def decode_to_pcm16k(data: bytes, timeout: float) -> np.ndarray:
    """Decode real audio (sniffed by ffmpeg, never trusting the MIME) to 16 kHz
    mono float32. Raises BadAudio / TooLong."""
    fd, path = tempfile.mkstemp(prefix="stt-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        cmd = [
            "ffmpeg", "-nostdin", "-v", "error",
            "-protocol_whitelist", "file", "-format_whitelist", DEMUXERS,
            "-i", path, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", str(STT_RATE),
            # Decode a hair past the cap so "longer than 120 s" is detectable.
            "-t", str(MAX_STT_SECONDS + 0.5), "-f", "s16le", "pipe:1",
        ]
        proc = subprocess.run(cmd, capture_output=True, timeout=timeout)
        if proc.returncode != 0 or not proc.stdout:
            raise BadAudio()
        pcm = np.frombuffer(proc.stdout, dtype=np.int16)
        if len(pcm) > MAX_STT_SECONDS * STT_RATE:
            raise TooLong()
        return pcm.astype(np.float32) / 32768.0
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def encode_ogg_opus(samples: np.ndarray, rate: int, timeout: float) -> bytes:
    """float32 mono -> Ogg Opus, mono, 24 kHz, ~32 kbps."""
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    cmd = [
        "ffmpeg", "-nostdin", "-v", "error",
        "-f", "s16le", "-ar", str(rate), "-ac", "1", "-i", "pipe:0",
        "-c:a", "libopus", "-b:a", "32k", "-ar", "24000", "-ac", "1",
        "-application", "audio", "-f", "ogg", "pipe:1",
    ]
    proc = subprocess.run(cmd, input=pcm, capture_output=True, timeout=timeout)
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError("opus encode failed")
    return proc.stdout
