from src.bot.config import settings
from src.bot.services.request_limit import (
    effective_daily_request_limit,
    format_limit_reached_message,
    limit_welcome_note,
)
from src.db.models import User


def test_effective_daily_request_limit_uses_user_override() -> None:
    user = User(id=1, telegram_id=1, timezone="Europe/Moscow", daily_request_limit=12)
    assert effective_daily_request_limit(user) == 12


def test_effective_daily_request_limit_uses_default() -> None:
    user = User(id=1, telegram_id=1, timezone="Europe/Moscow", daily_request_limit=None)
    assert effective_daily_request_limit(user) == settings.daily_request_limit


def test_format_limit_reached_message_with_support_link(monkeypatch) -> None:
    monkeypatch.setattr(settings, "telegram_feedback_chat", "taarelkachat")
    user = User(id=1, telegram_id=1, timezone="Europe/Moscow", daily_request_limit=6)
    message = format_limit_reached_message(user)
    assert "6 в день" in message
    assert "чат поддержки" in message
    assert 'href="https://t.me/taarelkachat"' in message
    assert "добавить лимит" in message


def test_limit_welcome_note_with_support_link(monkeypatch) -> None:
    monkeypatch.setattr(settings, "telegram_feedback_chat", "taarelkachat")
    user = User(id=1, telegram_id=1, timezone="Europe/Moscow", daily_request_limit=6)
    message = limit_welcome_note(user)
    assert "6 запросов в день" in message
    assert "фото, текст и исправления" in message
    assert 'href="https://t.me/taarelkachat"' in message
