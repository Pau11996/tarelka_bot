import pytest

from src.ai_analyzer.openai_runner import OpenAIRunner, format_openai_error


def test_format_openai_error_for_unsupported_region() -> None:
    message = format_openai_error(
        RuntimeError(
            "Error code: 403 - {'error': {'code': 'unsupported_country_region_territory'}}"
        )
    )
    assert "региона сервера" in message
    assert "OPENAI_HTTP_PROXY" in message


def test_format_openai_error_for_temperature() -> None:
    message = format_openai_error(
        RuntimeError(
            "Error code: 400 - {'error': {'param': 'temperature', 'code': 'unsupported_value'}}"
        )
    )
    assert "OPENAI_TEMPERATURE" in message


def test_format_openai_error_for_reasoning() -> None:
    message = format_openai_error(
        RuntimeError("Error code: 400 - {'error': {'message': 'unsupported reasoning'}}")
    )
    assert "OPENAI_REASONING_EFFORT" in message


def test_completion_kwargs_include_reasoning(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_REASONING_EFFORT", "medium")
    monkeypatch.delenv("OPENAI_TEMPERATURE", raising=False)
    runner = OpenAIRunner()
    kwargs = runner._completion_kwargs(content=[{"type": "text", "text": "hi"}])
    assert kwargs["extra_body"]["reasoning"] == {"effort": "medium", "exclude": True}


def test_completion_kwargs_omit_reasoning_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("OPENAI_REASONING_EFFORT", raising=False)
    runner = OpenAIRunner()
    kwargs = runner._completion_kwargs(content=[{"type": "text", "text": "hi"}])
    assert "extra_body" not in kwargs
