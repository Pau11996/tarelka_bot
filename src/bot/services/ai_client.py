from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from src.bot.config import settings
from src.shared.schemas import AnalysisResult

ProgressHandler = Callable[[str, dict[str, Any]], Awaitable[None]]


class AIAnalyzerClient:
    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (base_url or settings.ai_analyzer_url).rstrip("/")

    async def analyze_text(
        self,
        *,
        mode: str,
        text: str,
        profile_context: dict[str, Any] | None = None,
        previous_result: dict[str, Any] | None = None,
        on_progress: ProgressHandler | None = None,
    ) -> tuple[str, AnalysisResult]:
        payload = {
            "mode": mode,
            "text": text,
            "profile_context": profile_context,
            "previous_result": previous_result,
            "stream": on_progress is not None,
        }
        url = f"{self.base_url}/analyze/text"
        if on_progress is None:
            async with httpx.AsyncClient(timeout=600.0) as client:
                response = await client.post(url, json=payload)
                response.raise_for_status()
                data = response.json()
                return data["raw_response"], AnalysisResult.model_validate(data["parsed"])

        async with httpx.AsyncClient(timeout=600.0) as client:
            async with client.stream("POST", url, json=payload) as response:
                response.raise_for_status()
                return await _read_analysis_stream(response, on_progress)

    async def analyze_image(
        self,
        *,
        mode: str,
        image_bytes: bytes,
        filename: str,
        text: str | None = None,
        profile_context: dict[str, Any] | None = None,
        previous_result: dict[str, Any] | None = None,
        on_progress: ProgressHandler | None = None,
    ) -> tuple[str, AnalysisResult]:
        files = {"image": (filename, image_bytes, "image/jpeg")}
        data: dict[str, str] = {"mode": mode}
        if text:
            data["text"] = text
        if profile_context:
            data["profile_context"] = json.dumps(profile_context, ensure_ascii=False)
        if previous_result:
            data["previous_result"] = json.dumps(previous_result, ensure_ascii=False)
        if on_progress is not None:
            data["stream"] = "true"

        url = f"{self.base_url}/analyze/image"
        if on_progress is None:
            async with httpx.AsyncClient(timeout=600.0) as client:
                response = await client.post(url, data=data, files=files)
                response.raise_for_status()
                payload = response.json()
                return payload["raw_response"], AnalysisResult.model_validate(payload["parsed"])

        async with httpx.AsyncClient(timeout=600.0) as client:
            async with client.stream("POST", url, data=data, files=files) as response:
                response.raise_for_status()
                return await _read_analysis_stream(response, on_progress)

    async def transcribe(
        self,
        *,
        audio_bytes: bytes,
        filename: str = "voice.ogg",
    ) -> str:
        files = {"audio": (filename, audio_bytes, "audio/ogg")}
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(f"{self.base_url}/transcribe", files=files)
            response.raise_for_status()
            data = response.json()
            return str(data["text"]).strip()


async def _read_analysis_stream(
    response: httpx.Response,
    on_progress: ProgressHandler,
) -> tuple[str, AnalysisResult]:
    final: tuple[str, AnalysisResult] | None = None
    async for line in response.aiter_lines():
        if not line.strip():
            continue
        payload = json.loads(line)
        event = str(payload.pop("event", ""))
        if event == "error":
            raise httpx.HTTPError(payload.get("detail") or "Analysis failed")
        if event == "done":
            final = (
                payload["raw_response"],
                AnalysisResult.model_validate(payload["parsed"]),
            )
            continue
        await on_progress(event, payload)
    if final is None:
        raise httpx.HTTPError("Analysis stream ended without a result")
    return final
