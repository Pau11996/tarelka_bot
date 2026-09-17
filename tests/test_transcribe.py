from unittest.mock import patch

import httpx
import pytest

from src.ai_analyzer.transcribe import (
    TranscriptionEmpty,
    TranscriptionUnavailable,
    _load_vosk_model,
    transcribe_audio,
)
from src.bot.services.ai_client import AIAnalyzerClient


@pytest.fixture(autouse=True)
def _clear_vosk_model_cache() -> None:
    _load_vosk_model.cache_clear()
    yield
    _load_vosk_model.cache_clear()


@pytest.mark.asyncio
async def test_transcribe_audio_rejects_empty_payload() -> None:
    with pytest.raises(TranscriptionEmpty, match="Empty audio"):
        await transcribe_audio(b"")


@pytest.mark.asyncio
async def test_transcribe_audio_missing_model(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setenv("VOSK_MODEL_PATH", str(tmp_path / "missing-model"))
    with patch("src.ai_analyzer.transcribe._ogg_to_pcm16", return_value=b"\x00" * 3200):
        with pytest.raises(TranscriptionUnavailable, match="Vosk model not found"):
            await transcribe_audio(b"fake-ogg")


@pytest.mark.asyncio
async def test_transcribe_audio_returns_text() -> None:
    with (
        patch("src.ai_analyzer.transcribe._ogg_to_pcm16", return_value=b"\x00" * 3200),
        patch("src.ai_analyzer.transcribe._transcribe_pcm", return_value="  борщ 300 грамм  "),
    ):
        text = await transcribe_audio(b"ogg-bytes", filename="voice.ogg")
    assert text == "борщ 300 грамм"


@pytest.mark.asyncio
async def test_transcribe_audio_empty_recognition() -> None:
    with (
        patch("src.ai_analyzer.transcribe._ogg_to_pcm16", return_value=b"\x00" * 3200),
        patch("src.ai_analyzer.transcribe._transcribe_pcm", return_value="   "),
    ):
        with pytest.raises(TranscriptionEmpty, match="could not be recognized"):
            await transcribe_audio(b"ogg-bytes")


@pytest.mark.asyncio
async def test_ogg_to_pcm_requires_ffmpeg(monkeypatch: pytest.MonkeyPatch) -> None:
    import src.ai_analyzer.transcribe as mod

    def _raise_missing(*args, **kwargs):
        raise FileNotFoundError("ffmpeg")

    monkeypatch.setattr(mod.subprocess, "run", _raise_missing)
    with pytest.raises(TranscriptionUnavailable, match="ffmpeg"):
        mod._ogg_to_pcm16(b"ogg")


@pytest.mark.asyncio
async def test_ai_client_transcribe_posts_multipart(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"text": "омлет два яйца"}

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, files=None):
            captured["url"] = url
            captured["files"] = files
            return FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)
    client = AIAnalyzerClient(base_url="http://analyzer:8000")
    text = await client.transcribe(audio_bytes=b"ogg", filename="voice.ogg")

    assert text == "омлет два яйца"
    assert captured["url"] == "http://analyzer:8000/transcribe"
    assert captured["files"]["audio"][0] == "voice.ogg"
    assert captured["files"]["audio"][1] == b"ogg"


@pytest.mark.asyncio
async def test_ai_client_analyze_text_after_transcribe_flow(monkeypatch: pytest.MonkeyPatch) -> None:
    """Voice path: transcribe then analyze_text with the same transcript."""
    calls: list[str] = []

    class FakeResponse:
        def __init__(self, payload: dict) -> None:
            self._payload = payload

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return self._payload

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, files=None, json=None):
            calls.append(url)
            if url.endswith("/transcribe"):
                return FakeResponse({"text": "борщ 300 грамм"})
            return FakeResponse(
                {
                    "raw_response": "{}",
                    "parsed": {
                        "type": "meal",
                        "title": "Борщ",
                        "total_calories": 120,
                        "protein_g": 5,
                        "fat_g": 4,
                        "carbs_g": 15,
                        "items": [],
                        "micronutrients": {},
                    },
                }
            )

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)
    client = AIAnalyzerClient(base_url="http://analyzer:8000")

    transcript = await client.transcribe(audio_bytes=b"ogg")
    raw, result = await client.analyze_text(mode="auto", text=transcript)

    assert transcript == "борщ 300 грамм"
    assert result.type == "meal"
    assert result.title == "Борщ"
    assert result.total_calories == 120
    assert calls == [
        "http://analyzer:8000/transcribe",
        "http://analyzer:8000/analyze/text",
    ]
    assert raw == "{}"


@pytest.mark.asyncio
async def test_ai_client_analyze_text_stream_reports_progress(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict = {}
    events: list[tuple[str, dict]] = []

    class FakeStreamResponse:
        def raise_for_status(self) -> None:
            return None

        async def aiter_lines(self):
            yield '{"event": "classified", "type": "activity"}'
            yield '{"event": "calculate", "type": "activity"}'
            yield (
                '{"event": "done", "raw_response": "{}", "parsed": '
                '{"type": "activity", "title": "Бег", "total_calories": 280, '
                '"items": [], "micronutrients": {}}}'
            )

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        def stream(self, method, url, json=None):
            captured["method"] = method
            captured["url"] = url
            captured["json"] = json
            return FakeStreamResponse()

    async def on_progress(event: str, payload: dict) -> None:
        events.append((event, payload))

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)
    client = AIAnalyzerClient(base_url="http://analyzer:8000")
    raw, result = await client.analyze_text(
        mode="auto",
        text="пробежка",
        on_progress=on_progress,
    )

    assert captured["method"] == "POST"
    assert captured["url"] == "http://analyzer:8000/analyze/text"
    assert captured["json"]["stream"] is True
    assert events == [
        ("classified", {"type": "activity"}),
        ("calculate", {"type": "activity"}),
    ]
    assert raw == "{}"
    assert result.type == "activity"
    assert result.title == "Бег"
