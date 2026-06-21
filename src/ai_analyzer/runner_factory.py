from __future__ import annotations

import os

from src.ai_analyzer.analysis_runner import BaseAnalysisRunner
from src.ai_analyzer.cursor_runner import CursorRunner

_TRUTHY = {"true", "1", "yes", "on"}


def use_openai_api() -> bool:
    return os.environ.get("API", "").strip().lower() in _TRUTHY


def create_analysis_runner() -> BaseAnalysisRunner:
    if use_openai_api():
        from src.ai_analyzer.openai_runner import OpenAIRunner

        return OpenAIRunner()
    return CursorRunner()
