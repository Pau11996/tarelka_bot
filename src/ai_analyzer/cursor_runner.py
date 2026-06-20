from __future__ import annotations

import asyncio
import json
import os
import subprocess
from pathlib import Path

from src.ai_analyzer.parsing import extract_json_payload, parse_analysis_response
from src.ai_analyzer.prompts import (
    ACTIVITY_ANALYSIS_PROMPT,
    CORRECTION_PROMPT,
    FOOD_ANALYSIS_PROMPT,
    GENERAL_ANALYSIS_PROMPT,
    NUTRITION_CALCULATION_PROMPT,
)
from src.shared.schemas import AnalysisResult

RETRYABLE_MARKERS = (
    "Failed to reach the Cursor API",
    "Connection lost",
    "ECONNRESET",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "temporarily unavailable",
)


class CursorRunner:
    def __init__(self) -> None:
        self.model = os.environ.get("CURSOR_MODEL", "composer-2.5")
        self.timeout = int(os.environ.get("CURSOR_TIMEOUT", "180"))
        self.agent_bin = os.environ.get("CURSOR_AGENT_BIN", "agent")
        self.workdir = os.environ.get("UPLOAD_DIR", "/tmp/uploads")
        self.max_retries = int(os.environ.get("CURSOR_MAX_RETRIES", "3"))

    async def run_prompt(self, prompt: str, image_path: str | None = None) -> str:
        full_prompt = prompt
        if image_path:
            full_prompt = (
                f"{prompt}\n\n"
                f"Image file path: {image_path}\n"
                "Read the image file and include visual portion estimates in your analysis."
            )

        last_error: RuntimeError | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                return await asyncio.to_thread(self._execute_agent, full_prompt)
            except RuntimeError as exc:
                last_error = exc
                if attempt >= self.max_retries or not self._is_retryable(exc):
                    raise
                await asyncio.sleep(min(2 ** (attempt - 1), 8))
        raise last_error or RuntimeError("Cursor CLI failed")

    @staticmethod
    def _is_retryable(exc: RuntimeError) -> bool:
        message = str(exc)
        return any(marker in message for marker in RETRYABLE_MARKERS)

    def _execute_agent(self, prompt: str) -> str:
        env = os.environ.copy()

        cmd = [
            self.agent_bin,
            "-p",
            prompt,
            "--output-format",
            "text",
            "--mode",
            "ask",
            "--force",
        ]
        if self.model:
            cmd.extend(["--model", self.model])

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=self.timeout,
            env=env,
            cwd=self.workdir,
            check=False,
        )

        if result.returncode != 0:
            stderr = result.stderr.strip() or result.stdout.strip() or "unknown error"
            raise RuntimeError(f"Cursor CLI failed: {stderr}")

        output = result.stdout.strip()
        if not output and result.stderr.strip():
            output = result.stderr.strip()
        return output

    def _build_context(
        self,
        *,
        text: str | None,
        profile_context: dict | None,
        input_label: str = "User input",
    ) -> str:
        context = ""
        if profile_context:
            context = f"User profile context: {json.dumps(profile_context, ensure_ascii=False)}\n"
        if text:
            context += f"{input_label}: {text}\n"
        return context

    async def _identify(
        self,
        *,
        prompt: str,
        text: str | None,
        image_path: str | None,
        profile_context: dict | None,
        input_label: str = "User input",
    ) -> dict:
        context = self._build_context(
            text=text,
            profile_context=profile_context,
            input_label=input_label,
        )
        raw = await self.run_prompt(f"{prompt}\n{context}", image_path=image_path)
        return extract_json_payload(raw)

    async def _calculate(
        self,
        *,
        identification: dict,
        profile_context: dict | None,
    ) -> AnalysisResult:
        prompt = (
            f"{NUTRITION_CALCULATION_PROMPT}\n"
            f"Identification JSON:\n{json.dumps(identification, ensure_ascii=False)}\n"
        )
        if profile_context:
            prompt += f"User profile context:\n{json.dumps(profile_context, ensure_ascii=False)}\n"
        raw = await self.run_prompt(prompt)
        result = parse_analysis_response(raw)
        result.needs_clarification = False
        result.clarification_question = None
        return result

    async def analyze_food(
        self,
        *,
        text: str | None,
        image_path: str | None,
        profile_context: dict | None = None,
    ) -> AnalysisResult:
        identification = await self._identify(
            prompt=FOOD_ANALYSIS_PROMPT,
            text=text,
            image_path=image_path,
            profile_context=profile_context,
            input_label="User description",
        )
        identification["type"] = "meal"
        return await self._calculate(
            identification=identification,
            profile_context=profile_context,
        )

    async def analyze_auto(
        self,
        *,
        text: str | None,
        image_path: str | None,
        profile_context: dict | None = None,
    ) -> AnalysisResult:
        identification = await self._identify(
            prompt=GENERAL_ANALYSIS_PROMPT,
            text=text,
            image_path=image_path,
            profile_context=profile_context,
        )
        return await self._calculate(
            identification=identification,
            profile_context=profile_context,
        )

    async def analyze_activity(
        self,
        *,
        text: str | None,
        image_path: str | None,
        profile_context: dict | None = None,
    ) -> AnalysisResult:
        identification = await self._identify(
            prompt=ACTIVITY_ANALYSIS_PROMPT,
            text=text,
            image_path=image_path,
            profile_context=profile_context,
            input_label="User description",
        )
        identification["type"] = "activity"
        return await self._calculate(
            identification=identification,
            profile_context=profile_context,
        )

    async def correct_analysis(
        self,
        *,
        previous_result: dict,
        correction_text: str,
        image_path: str | None = None,
    ) -> AnalysisResult:
        prompt = (
            f"{CORRECTION_PROMPT}\n"
            f"Previous JSON:\n{json.dumps(previous_result, ensure_ascii=False)}\n"
            f"User correction:\n{correction_text}\n"
        )
        raw = await self.run_prompt(prompt, image_path=image_path)
        return parse_analysis_response(raw)


def save_upload(filename: str, content: bytes, upload_dir: str | None = None) -> str:
    base = Path(upload_dir or os.environ.get("UPLOAD_DIR", "/tmp/uploads"))
    base.mkdir(parents=True, exist_ok=True)
    path = base / filename
    path.write_bytes(content)
    return str(path)
