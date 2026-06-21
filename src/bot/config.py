from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from src.db.url import normalize_async_database_url

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=PROJECT_ROOT / ".env", extra="ignore")

    telegram_bot_token: str = ""
    telegram_feedback_chat: str = ""
    daily_request_limit: int = 6
    database_url: str = "postgresql+asyncpg://wellhealth:wellhealth@localhost:5432/wellhealth"
    ai_analyzer_url: str = "http://localhost:8000"

    @field_validator("database_url", mode="before")
    @classmethod
    def _normalize_database_url(cls, value: str) -> str:
        return normalize_async_database_url(value)
    default_timezone: str = "Europe/Moscow"
    message_cleanup_ttl_seconds: int = 2 * 60 * 60


settings = Settings()
