from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI

from src.mobile_api.experience import router as experience_router
from src.mobile_api.worker import run_worker
from src.bot.config import settings


def validate_runtime_config() -> None:
    if os.environ.get("MOBILE_API_ENV", "development") != "production":
        return
    secret = settings.mobile_jwt_secret.strip()
    if len(secret.encode()) < 32 or secret in {
        "dev-mobile-jwt-secret-change-me",
        "replace-with-a-long-random-secret",
    }:
        raise RuntimeError("Set a unique MOBILE_JWT_SECRET of at least 32 bytes before starting the public Mobile API.")


@asynccontextmanager
async def lifespan(app):
    validate_runtime_config()
    task = asyncio.create_task(run_worker())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


from fastapi.middleware.cors import CORSMiddleware

from src.mobile_api.routes import router
from src.mobile_api.email_auth import router as email_auth_router
from src.mobile_api.favorites import router as favorites_router
from src.shared.logging_config import setup_logging


def create_app() -> FastAPI:
    setup_logging("mobile_api")
    app = FastAPI(title="ТАРЕЛКА Mobile API", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router, prefix="/v1")
    app.include_router(email_auth_router, prefix="/v1")
    app.include_router(experience_router, prefix="/v1")
    app.include_router(favorites_router, prefix="/v1")

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
