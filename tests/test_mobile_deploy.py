"""Public API startup and operation behind the site's /api prefix."""
from unittest.mock import AsyncMock

import httpx
import pytest

from src.bot.config import settings
from src.mobile_api import main


@pytest.mark.parametrize("secret", ["", "short", " " * 64, "dev-mobile-jwt-secret-change-me", "replace-with-a-long-random-secret"])
async def test_public_api_refuses_unsafe_secret_before_starting_worker(monkeypatch, secret):
    monkeypatch.setenv("MOBILE_API_ENV", "production")
    monkeypatch.setattr(settings, "mobile_jwt_secret", secret)
    worker = AsyncMock()
    monkeypatch.setattr(main, "run_worker", worker)
    with pytest.raises(RuntimeError, match="MOBILE_JWT_SECRET"):
        async with main.lifespan(None):
            pytest.fail("An unsafe public API must not start")
    worker.assert_not_called()


def test_public_api_allows_strong_secret_with_demo_billing(monkeypatch):
    monkeypatch.setenv("MOBILE_API_ENV", "production")
    monkeypatch.setenv("MOBILE_DEMO_BILLING", "1")
    monkeypatch.setattr(settings, "mobile_jwt_secret", "release-test-secret-with-at-least-32-bytes")
    main.validate_runtime_config()


def test_local_api_keeps_development_secret(monkeypatch):
    monkeypatch.setenv("MOBILE_API_ENV", "development")
    monkeypatch.setattr(settings, "mobile_jwt_secret", "dev-mobile-jwt-secret-change-me")
    main.validate_runtime_config()


async def test_site_prefix_exposes_health_but_keeps_account_authenticated():
    transport = httpx.ASGITransport(app=main.create_app(), root_path="/api")
    async with httpx.AsyncClient(transport=transport, base_url="https://tarelkaa.by") as client:
        assert (await client.get("/api/health")).json() == {"status": "ok"}
        assert (await client.get("/api/v1/me")).status_code == 401
        schema = (await client.get("/api/openapi.json")).json()
        assert {"url": "/api"} in schema["servers"]
