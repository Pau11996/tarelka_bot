from __future__ import annotations

from src.ai_analyzer.analysis_runner import BaseAnalysisRunner
from src.ai_analyzer.openai_runner import OpenAIRunner


def create_analysis_runner() -> BaseAnalysisRunner:
    return OpenAIRunner()
