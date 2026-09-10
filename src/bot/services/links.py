import re

from src.bot.config import settings

SUPPORT_EMAIL = settings.support_email

_ACQUISITION_SOURCE_RE = re.compile(r"[^a-z0-9_-]+")
_REFERRAL_PAYLOAD_RE = re.compile(r"^ref_([a-f0-9]{10})$")
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
    if _REFERRAL_PAYLOAD_RE.fullmatch(cleaned):
        return "referral"
    if not cleaned or cleaned in _RESERVED_START_PAYLOADS:
        return None
    return cleaned[:_MAX_ACQUISITION_SOURCE_LEN]


def parse_referral_code(raw: str | None) -> str | None:
    if raw is None:
        return None
    match = _REFERRAL_PAYLOAD_RE.fullmatch(raw.strip().lower())
    return match.group(1) if match else None


def bot_start_url(start: str) -> str | None:
    username = settings.telegram_bot_username.strip().removeprefix("@")
    if not username:
        return None
    return f"https://t.me/{username}?start={start}"


def subscription_url() -> str | None:
    return bot_start_url("premium")


def referral_url(code: str) -> str | None:
    return bot_start_url(f"ref_{code}")


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


def support_email_link() -> str:
    return f"<code>{SUPPORT_EMAIL}</code>"


MENU_COMMANDS = (
    ("today", "📊 дневник за сегодня"),
    ("stats", "📈 статистика"),
    ("favorites", "⭐ избранные блюда и активности"),
    ("premium", "💎 подписка"),
    ("profile", "👤 профиль"),
    ("invite", "🎁 пригласить друга"),
    ("contacts", "⚙️ контакты и настройки"),
    ("start", "👋 приветствие"),
)

SETTINGS_COMMANDS = (
    ("feedback", "💬 чат поддержки"),
    ("paysupport", "💳 вопросы по оплате и возвратам"),
    ("privacy", "🔒 какие данные хранятся"),
    ("notifications_off", "🔕 отключить напоминания"),
    ("notifications_on", "🔔 включить напоминания"),
    ("delete_me", "🗑 удалить все данные"),
)

BOT_COMMANDS = MENU_COMMANDS + SETTINGS_COMMANDS


def format_bot_commands() -> str:
    lines = ["Команды"]
    lines.extend(f"/{name} — {description}" for name, description in SETTINGS_COMMANDS)
    return "\n".join(lines)


def format_contacts() -> str:
    feedback = feedback_chat_url()
    channel = channel_url()
    lines = ["Контакты и настройки", ""]
    if feedback:
        lines.append(f'💬 Чат поддержки: <a href="{feedback}">открыть</a>.')
    if channel:
        lines.append(f'📢 Новости и советы: <a href="{channel}">канал ТАРЕЛКА</a>.')
    lines.extend(
        [
            f"📧 Почта — возвраты, отдельные вопросы поддержки и идеи по улучшению: {support_email_link()}.",
            "",
            "По подписке и возвратам пишите на почту или в чат. "
            "Telegram Support покупки этого бота не обрабатывает.",
            "",
            format_bot_commands(),
        ]
    )
    return "\n".join(lines)
