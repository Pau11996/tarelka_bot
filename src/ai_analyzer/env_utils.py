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


_REASONING_EFFORTS = {"minimal", "low", "medium", "high"}


def resolve_openai_temperature() -> float | None:
    raw = os.environ.get("OPENAI_TEMPERATURE", "").strip()
    if not raw:
        return None
    return float(raw)


def resolve_openai_reasoning_effort() -> str | None:
    raw = os.environ.get("OPENAI_REASONING_EFFORT", "").strip().lower()
    if not raw:
        return None
    if raw not in _REASONING_EFFORTS:
        allowed = ", ".join(sorted(_REASONING_EFFORTS))
        raise RuntimeError(
            f"OPENAI_REASONING_EFFORT must be one of: {allowed} (got {raw!r})"
        )
    return raw


def resolve_http_proxy() -> str | None:
    for name in ("OPENAI_HTTP_PROXY", "HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"):
        value = os.environ.get(name, "").strip()
        if not value:
            continue
        if not value.startswith(("http://", "https://")):
            value = f"http://{value}"
        return value
    return None


_STAGE_ENV_SUFFIX = {
    "classify": "CLASSIFY",
    "photo": "PHOTO",
    "calc": "CALC",
}


def resolve_stage_model(stage: str | None, default: str, *, prefix: str = "OPENAI_MODEL") -> str:
    if stage is None:
        return default
    suffix = _STAGE_ENV_SUFFIX.get(stage)
    if suffix is None:
        return default
    override = os.environ.get(f"{prefix}_{suffix}", "").strip()
    return override or default


def resolve_stage_reasoning_effort(
    stage: str | None,
    default: str | None = None,
) -> str | None:
    if stage is not None:
        suffix = _STAGE_ENV_SUFFIX.get(stage)
        if suffix is not None:
            raw = os.environ.get(f"OPENAI_REASONING_EFFORT_{suffix}", "").strip().lower()
            if raw:
                if raw not in _REASONING_EFFORTS:
                    allowed = ", ".join(sorted(_REASONING_EFFORTS))
                    raise RuntimeError(
                        f"OPENAI_REASONING_EFFORT_{suffix} must be one of: {allowed} (got {raw!r})"
                    )
                return raw
    if default is not None:
        return default
    return resolve_openai_reasoning_effort()
