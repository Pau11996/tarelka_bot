import re

from src.bot.config import settings

_ACQUISITION_SOURCE_RE = re.compile(r"[^a-z0-9_-]+")
_RESERVED_START_PAYLOADS = frozenset({"premium"})
_MAX_ACQUISITION_SOURCE_LEN = 64


def normalize_acquisition_source(raw: str | None) -> str | None:
    """Normalize Telegram deep-link start payload into a marketing source.

    Reserved payloads like ``premium`` are not acquisition sources.
    Invalid or empty values become ``None`` (shown as direct/organic).
    """
    if raw is None:
        return None
    cleaned = _ACQUISITION_SOURCE_RE.sub("", raw.strip().lower())
    if not cleaned or cleaned in _RESERVED_START_PAYLOADS:
        return None
    return cleaned[:_MAX_ACQUISITION_SOURCE_LEN]


def bot_start_url(start: str) -> str | None:
    username = settings.telegram_bot_username.strip().removeprefix("@")
    if not username:
        return None
    return f"https://t.me/{username}?start={start}"


def subscription_url() -> str | None:
    return bot_start_url("premium")


def subscription_offer_link(*, renew: bool = False) -> str | None:
    url = subscription_url()
    if not url:
        return None
    label = "продлить подписку" if renew else "оформить подписку"
    return f'<a href="{url}">{label}</a>'


def _telegram_public_url(value: str) -> str | None:
    cleaned = value.strip()
    if not cleaned:
        return None
    if cleaned.startswith("http://") or cleaned.startswith("https://"):
        return cleaned
    return f"https://t.me/{cleaned.removeprefix('@')}"


def channel_url() -> str | None:
    return _telegram_public_url(settings.telegram_channel)


def feedback_chat_url() -> str | None:
    return _telegram_public_url(settings.telegram_feedback_chat)


def channel_welcome_note() -> str:
    url = channel_url()
    if not url:
        return ""
    return (
        "\n\n📢 Новости и советы — в "
        f'<a href="{url}">канале ТАРЕЛКА</a>.'
    )


def feedback_welcome_note() -> str:
    url = feedback_chat_url()
    if not url:
        return ""
    return (
        "\n\n💬 Вопросы, идеи и баги — пишите в "
        f'<a href="{url}">чат поддержки</a>.'
    )
