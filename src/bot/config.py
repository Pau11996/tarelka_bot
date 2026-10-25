from pathlib import Path
from typing import Literal

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from src.db.url import normalize_async_database_url

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=PROJECT_ROOT / ".env", extra="ignore")

    telegram_bot_token: str = ""
    telegram_bot_username: str = ""
    telegram_channel: str = ""
    telegram_feedback_chat: str = ""
    free_photo_daily_limit: int = 3
    legacy_free_photo_daily_limit: int = 6
    free_text_daily_limit: int = 60
    free_voice_daily_limit: int = 10
    subscription_price_stars: int = 150
    subscription_daily_request_limit: int = 30
    subscription_text_daily_limit: int = 100
    subscription_voice_daily_limit: int = 30
    subscription_duration_days: int = 30
    subscription_reminder_days_before: int = 2
    subscription_reminder_interval_seconds: int = 3600
    referral_monthly_goal: int = 5
    diary_nudges_enabled: bool = True
    diary_nudges_interval_seconds: int = 20 * 60
    coach_reviews_enabled: bool = True
    coach_reviews_interval_seconds: int = 20 * 60
    support_email: str = "help.4posts@gmail.com"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_security: Literal["starttls", "ssl"] = "starttls"
    smtp_username: str = ""
    smtp_password: SecretStr = SecretStr("")
    smtp_from: str = ""
    database_url: str = "postgresql+asyncpg://wellhealth:wellhealth@localhost:5432/wellhealth"
    ai_analyzer_url: str = "http://localhost:8000"

    @field_validator("database_url", mode="before")
    @classmethod
    def _normalize_database_url(cls, value: str) -> str:
        return normalize_async_database_url(value)
    default_timezone: str = "Europe/Moscow"
    message_cleanup_ttl_seconds: int = 2 * 60 * 60
    mobile_jwt_secret: str = "dev-mobile-jwt-secret-change-me"
    mobile_login_ttl_seconds: int = 300
    mobile_token_ttl_days: int = 30


settings = Settings()
