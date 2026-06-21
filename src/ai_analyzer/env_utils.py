from __future__ import annotations

import os

_PROXY_ENV_NAMES = (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
)


def clean_empty_env_vars(*names: str) -> None:
    for name in names:
        value = os.environ.get(name)
        if value is not None and not value.strip():
            os.environ.pop(name, None)


def clean_empty_proxy_env_vars() -> None:
    clean_empty_env_vars(*_PROXY_ENV_NAMES)


def normalize_openai_base_url(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None

    base_url = value.strip().rstrip("/")
    if not base_url.startswith(("http://", "https://")):
        raise RuntimeError(
            "OPENAI_BASE_URL must start with http:// or https:// "
            f"(got {value!r}). Example: https://api.openai.com/v1"
        )
    return base_url


def resolve_openai_temperature() -> float | None:
    raw = os.environ.get("OPENAI_TEMPERATURE", "").strip()
    if not raw:
        return None
    return float(raw)


def resolve_http_proxy() -> str | None:
    for name in ("OPENAI_HTTP_PROXY", "HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"):
        value = os.environ.get(name, "").strip()
        if not value:
            continue
        if not value.startswith(("http://", "https://")):
            value = f"http://{value}"
        return value
    return None
