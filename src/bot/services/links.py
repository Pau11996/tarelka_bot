from src.bot.config import settings


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


def feedback_chat_url() -> str | None:
    value = settings.telegram_feedback_chat.strip()
    if not value:
        return None
    if value.startswith("http://") or value.startswith("https://"):
        return value
    return f"https://t.me/{value.removeprefix('@')}"


def feedback_welcome_note() -> str:
    url = feedback_chat_url()
    if not url:
        return ""
    return (
        "\n\n💬 Вопросы, идеи и баги — пишите в "
        f'<a href="{url}">чат поддержки</a>.'
    )
