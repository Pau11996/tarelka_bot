from src.bot.config import settings


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
