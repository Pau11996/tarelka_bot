from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16_000
DEFAULT_MODEL_PATH = "/opt/vosk/model"


class TranscriptionUnavailable(Exception):
    """Raised when STT cannot run (missing model or ffmpeg)."""


class TranscriptionEmpty(Exception):
    """Raised when speech could not be recognized."""


def resolve_vosk_model_path() -> Path:
    raw = os.environ.get("VOSK_MODEL_PATH", DEFAULT_MODEL_PATH).strip() or DEFAULT_MODEL_PATH
    return Path(raw)


@lru_cache(maxsize=1)
def _load_vosk_model():
    from vosk import Model, SetLogLevel

    path = resolve_vosk_model_path()
    if not path.is_dir():
        raise TranscriptionUnavailable(
            f"Vosk model not found at {path}. "
            "Download a Russian model and set VOSK_MODEL_PATH."
        )
    SetLogLevel(-1)
    return Model(str(path))


def _ogg_to_pcm16(audio_bytes: bytes) -> bytes:
    """Convert Telegram OGG/Opus to 16 kHz mono PCM s16le for Vosk."""
    try:
        proc = subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-loglevel",
                "error",
                "-i",
                "pipe:0",
                "-ar",
                str(SAMPLE_RATE),
                "-ac",
                "1",
                "-f",
                "s16le",
                "pipe:1",
            ],
            input=audio_bytes,
            capture_output=True,
            check=False,
            timeout=60,
        )
    except FileNotFoundError as exc:
        raise TranscriptionUnavailable(
            "ffmpeg is required for voice transcription"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Audio conversion timed out") from exc

    if proc.returncode != 0 or not proc.stdout:
        detail = (proc.stderr or b"").decode("utf-8", errors="replace").strip()
        raise RuntimeError(detail or "ffmpeg failed to decode audio")
    return proc.stdout


def _transcribe_pcm(pcm: bytes) -> str:
    from vosk import KaldiRecognizer

    model = _load_vosk_model()
    recognizer = KaldiRecognizer(model, SAMPLE_RATE)
    recognizer.SetWords(False)

    parts: list[str] = []
    chunk_size = 4000
    for offset in range(0, len(pcm), chunk_size):
        chunk = pcm[offset : offset + chunk_size]
        if recognizer.AcceptWaveform(chunk):
            partial = json.loads(recognizer.Result()).get("text") or ""
            if partial.strip():
                parts.append(partial.strip())

    final = json.loads(recognizer.FinalResult()).get("text") or ""
    if final.strip():
        parts.append(final.strip())
    return " ".join(parts).strip()


async def transcribe_audio(
    audio_bytes: bytes,
    *,
    filename: str = "voice.ogg",
    language: str = "ru",
) -> str:
    """Transcribe Telegram voice via offline Vosk (Russian model)."""
    del filename, language  # Vosk model is language-specific; filename unused after decode
    if not audio_bytes:
        raise TranscriptionEmpty("Empty audio payload")

    try:
        pcm = await asyncio.to_thread(_ogg_to_pcm16, audio_bytes)
        text = (await asyncio.to_thread(_transcribe_pcm, pcm)).strip()
    except (TranscriptionUnavailable, TranscriptionEmpty):
        raise
    except Exception as exc:
        logger.exception("Vosk transcription failed")
        raise RuntimeError(f"Vosk transcription failed: {exc}") from exc

    if not text:
        raise TranscriptionEmpty("Speech could not be recognized")
    return text
