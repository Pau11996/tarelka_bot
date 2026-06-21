import os

import pytest

from src.ai_analyzer.env_utils import (
    clean_empty_proxy_env_vars,
    normalize_openai_base_url,
    resolve_http_proxy,
    resolve_openai_temperature,
)


def test_clean_empty_proxy_env_vars_removes_blank_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HTTP_PROXY", "")
    monkeypatch.setenv("HTTPS_PROXY", "   ")
    monkeypatch.setenv("NO_PROXY", "localhost")

    clean_empty_proxy_env_vars()

    assert "HTTP_PROXY" not in os.environ
    assert "HTTPS_PROXY" not in os.environ
    assert os.environ["NO_PROXY"] == "localhost"


def test_normalize_openai_base_url_accepts_https() -> None:
    assert normalize_openai_base_url("https://api.openai.com/v1/") == "https://api.openai.com/v1"


def test_normalize_openai_base_url_rejects_missing_protocol() -> None:
    with pytest.raises(RuntimeError, match="OPENAI_BASE_URL must start with http"):
        normalize_openai_base_url("api.openai.com/v1")


def test_resolve_openai_temperature_is_optional() -> None:
    assert resolve_openai_temperature() is None


def test_resolve_openai_temperature_reads_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_TEMPERATURE", "0.2")
    assert resolve_openai_temperature() == 0.2


def test_resolve_http_proxy_prefers_openai_specific_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HTTPS_PROXY", "http://shared-proxy:8080")
    monkeypatch.setenv("OPENAI_HTTP_PROXY", "http://openai-proxy:3128")
    assert resolve_http_proxy() == "http://openai-proxy:3128"


def test_resolve_http_proxy_adds_scheme(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_HTTP_PROXY", "proxy.example.com:8080")
    assert resolve_http_proxy() == "http://proxy.example.com:8080"
