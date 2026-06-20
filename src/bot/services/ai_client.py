from __future__ import annotations

import json
from typing import Any

import httpx

from src.bot.config import settings
from src.shared.schemas import AnalysisResult


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
    ) -> tuple[str, AnalysisResult]:
        payload = {
            "mode": mode,
            "text": text,
            "profile_context": profile_context,
            "previous_result": previous_result,
        }
        async with httpx.AsyncClient(timeout=180.0) as client:
            response = await client.post(f"{self.base_url}/analyze/text", json=payload)
            response.raise_for_status()
            data = response.json()
            return data["raw_response"], AnalysisResult.model_validate(data["parsed"])

    async def analyze_image(
        self,
        *,
        mode: str,
        image_bytes: bytes,
        filename: str,
        text: str | None = None,
        profile_context: dict[str, Any] | None = None,
        previous_result: dict[str, Any] | None = None,
    ) -> tuple[str, AnalysisResult]:
        files = {"image": (filename, image_bytes, "image/jpeg")}
        data: dict[str, str] = {"mode": mode}
        if text:
            data["text"] = text
        if profile_context:
            data["profile_context"] = json.dumps(profile_context, ensure_ascii=False)
        if previous_result:
            data["previous_result"] = json.dumps(previous_result, ensure_ascii=False)

        async with httpx.AsyncClient(timeout=180.0) as client:
            response = await client.post(f"{self.base_url}/analyze/image", data=data, files=files)
            response.raise_for_status()
            payload = response.json()
            return payload["raw_response"], AnalysisResult.model_validate(payload["parsed"])
