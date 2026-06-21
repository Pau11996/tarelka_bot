from __future__ import annotations

import asyncio
import base64
import mimetypes
import os

import httpx
from openai import AsyncOpenAI

from src.ai_analyzer.analysis_runner import BaseAnalysisRunner
from src.ai_analyzer.env_utils import (
    clean_empty_proxy_env_vars,
    normalize_openai_base_url,
    resolve_http_proxy,
    resolve_openai_temperature,
)

RETRYABLE_MARKERS = (
    "Connection error",
    "Timeout",
    "ECONNRESET",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "temporarily unavailable",
    "Rate limit",
)


def format_openai_error(exc: Exception) -> str:
    message = str(exc)
    if "unsupported_country_region_territory" in message:
        return (
            "OpenAI API недоступен из региона сервера. "
            "Настройте OPENAI_HTTP_PROXY или HTTPS_PROXY на прокси в поддерживаемой стране, "
            "либо отключите API=true и используйте Cursor."
        )
    if "unsupported_value" in message and "temperature" in message:
        return (
            "Выбранная модель OpenAI не поддерживает OPENAI_TEMPERATURE. "
            "Уберите переменную из .env или смените модель, например gpt-4o-mini."
        )
    return f"OpenAI API failed: {exc}"


class OpenAIRunner(BaseAnalysisRunner):
    def __init__(self) -> None:
        api_key = os.environ.get("OPENAI_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is required when API=true")

        self.model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
        self.timeout = float(os.environ.get("OPENAI_TIMEOUT", "120"))
        self.max_retries = int(os.environ.get("OPENAI_MAX_RETRIES", "3"))
        self.temperature = resolve_openai_temperature()
        clean_empty_proxy_env_vars()
        base_url = normalize_openai_base_url(os.environ.get("OPENAI_BASE_URL"))

        client_kwargs: dict = {
            "api_key": api_key,
            "base_url": base_url,
            "timeout": self.timeout,
        }
        proxy = resolve_http_proxy()
        if proxy:
            client_kwargs["http_client"] = httpx.AsyncClient(proxy=proxy, timeout=self.timeout)

        self.client = AsyncOpenAI(**client_kwargs)

    @staticmethod
    def _is_retryable(exc: Exception) -> bool:
        message = str(exc)
        return any(marker in message for marker in RETRYABLE_MARKERS)

    @staticmethod
    def _image_content(image_path: str) -> dict:
        mime_type = mimetypes.guess_type(image_path)[0] or "image/jpeg"
        with open(image_path, "rb") as image_file:
            encoded = base64.standard_b64encode(image_file.read()).decode("ascii")
        return {
            "type": "image_url",
            "image_url": {"url": f"data:{mime_type};base64,{encoded}"},
        }

    def _completion_kwargs(self, *, content: list[dict]) -> dict:
        kwargs = {
            "model": self.model,
            "messages": [{"role": "user", "content": content}],
        }
        if self.temperature is not None:
            kwargs["temperature"] = self.temperature
        return kwargs

    async def run_prompt(self, prompt: str, image_path: str | None = None) -> str:
        content: list[dict] = [{"type": "text", "text": prompt}]
        if image_path:
            content.append(await asyncio.to_thread(self._image_content, image_path))

        last_error: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                response = await self.client.chat.completions.create(
                    **self._completion_kwargs(content=content),
                )
                message = response.choices[0].message.content
                if not message or not message.strip():
                    raise RuntimeError("OpenAI returned an empty response")
                return message.strip()
            except Exception as exc:
                last_error = exc
                if attempt >= self.max_retries or not self._is_retryable(exc):
                    raise RuntimeError(format_openai_error(exc)) from exc
                await asyncio.sleep(min(2 ** (attempt - 1), 8))
        raise RuntimeError(format_openai_error(last_error or RuntimeError("unknown OpenAI error")))
