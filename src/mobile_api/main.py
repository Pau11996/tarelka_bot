from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.mobile_api.routes import router
from src.shared.logging_config import setup_logging


def create_app() -> FastAPI:
    setup_logging("mobile_api")
    app = FastAPI(title="ТАРЕЛКА Mobile API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router, prefix="/v1")

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
