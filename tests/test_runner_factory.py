import pytest

from src.ai_analyzer.runner_factory import create_analysis_runner


def test_create_analysis_runner_requires_openai_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        create_analysis_runner()


def test_create_analysis_runner_uses_openai(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    runner = create_analysis_runner()
    assert runner.__class__.__name__ == "OpenAIRunner"
