from __future__ import annotations

import asyncio
import os
import subprocess
from pathlib import Path

from src.ai_analyzer.analysis_runner import BaseAnalysisRunner

RETRYABLE_MARKERS = (
    "Failed to reach the Cursor API",
    "Connection lost",
    "ECONNRESET",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "temporarily unavailable",
)


class CursorRunner(BaseAnalysisRunner):
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


def save_upload(filename: str, content: bytes, upload_dir: str | None = None) -> str:
    base = Path(upload_dir or os.environ.get("UPLOAD_DIR", "/tmp/uploads"))
    base.mkdir(parents=True, exist_ok=True)
    path = base / filename
    path.write_bytes(content)
    return str(path)
