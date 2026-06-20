from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=PROJECT_ROOT / ".env", extra="ignore")

    telegram_bot_token: str = ""
    telegram_feedback_chat: str = ""
    daily_request_limit: int = 6
    database_url: str = "postgresql+asyncpg://wellhealth:wellhealth@localhost:5432/wellhealth"
    ai_analyzer_url: str = "http://localhost:8000"
    default_timezone: str = "Europe/Moscow"
    message_cleanup_ttl_seconds: int = 2 * 60 * 60


settings = Settings()
