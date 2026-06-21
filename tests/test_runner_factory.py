import pytest

from src.ai_analyzer.runner_factory import create_analysis_runner, use_openai_api


@pytest.mark.parametrize("value", ["true", "True", "1", "yes", "on"])
def test_use_openai_api_truthy(value: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API", value)
    assert use_openai_api() is True


@pytest.mark.parametrize("value", ["false", "", "0", "no", "off"])
def test_use_openai_api_falsy(value: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API", value)
    assert use_openai_api() is False


def test_create_analysis_runner_uses_cursor_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("API", raising=False)
    runner = create_analysis_runner()
    assert runner.__class__.__name__ == "CursorRunner"


def test_create_analysis_runner_requires_openai_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API", "true")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        create_analysis_runner()


def test_create_analysis_runner_uses_openai_when_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API", "true")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    runner = create_analysis_runner()
    assert runner.__class__.__name__ == "OpenAIRunner"
