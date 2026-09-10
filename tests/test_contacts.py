from src.bot.config import settings
from src.bot.handlers.subscription import format_payment_support
from src.bot.keyboards.menus import CONTACTS_BUTTON, contacts_keyboard
from src.bot.services.links import (
    MENU_COMMANDS,
    SETTINGS_COMMANDS,
    SUPPORT_EMAIL,
    format_contacts,
)


def test_menu_commands_include_contacts_invite_and_start_last() -> None:
    names = [name for name, _description in MENU_COMMANDS]
    assert CONTACTS_BUTTON == "⚙️ Контакты и настройки"
    assert "contacts" in names
    assert "invite" in names
    assert names[-1] == "start"
    assert "correct" not in names
    assert [description for _name, description in MENU_COMMANDS] == [
        "📊 дневник за сегодня",
        "📈 статистика",
        "⭐ избранные блюда и активности",
        "💎 подписка",
        "👤 профиль",
        "🎁 пригласить друга",
        "⚙️ контакты и настройки",
        "👋 приветствие",
    ]


def test_settings_commands_exclude_menu_and_correct() -> None:
    names = [name for name, _description in SETTINGS_COMMANDS]
    assert names == [
        "feedback",
        "paysupport",
        "privacy",
        "notifications_off",
        "notifications_on",
        "delete_me",
    ]
    assert "today" not in names
    assert "start" not in names
    assert "correct" not in names
    assert [description for _name, description in SETTINGS_COMMANDS] == [
        "💬 чат поддержки",
        "💳 вопросы по оплате и возвратам",
        "🔒 какие данные хранятся",
        "🔕 отключить напоминания",
        "🔔 включить напоминания",
        "🗑 удалить все данные",
    ]


def test_format_contacts_with_links(monkeypatch) -> None:
    monkeypatch.setattr(settings, "telegram_feedback_chat", "taarelkachat")
    monkeypatch.setattr(settings, "telegram_channel", "taarelka_news")

    text = format_contacts()
    keyboard = contacts_keyboard()

    assert "Контакты и настройки" in text
    assert SUPPORT_EMAIL in text
    assert f"<code>{SUPPORT_EMAIL}</code>" in text
    assert 'href="https://t.me/taarelkachat"' in text
    assert 'href="https://t.me/taarelka_news"' in text
    assert "Telegram Support" in text
    assert "/invite" not in text
    assert "/today" not in text
    assert "/start" not in text
    assert "/correct" not in text
    assert "/privacy" in text
    assert "/delete_me" in text
    for name, _description in SETTINGS_COMMANDS:
        assert f"/{name}" in text
    assert [button.text for row in keyboard.inline_keyboard for button in row] == [
        "💬 Написать в поддержку",
        "📢 Канал ТАРЕЛКА",
    ]


def test_format_contacts_without_chat_still_shows_email(monkeypatch) -> None:
    monkeypatch.setattr(settings, "telegram_feedback_chat", "")
    monkeypatch.setattr(settings, "telegram_channel", "")

    text = format_contacts()

    assert SUPPORT_EMAIL in text
    assert contacts_keyboard() is None


def test_payment_support_includes_email(monkeypatch) -> None:
    monkeypatch.setattr(settings, "telegram_feedback_chat", "taarelkachat")

    text = format_payment_support()

    assert SUPPORT_EMAIL in text
    assert f"<code>{SUPPORT_EMAIL}</code>" in text
    assert 'href="https://t.me/taarelkachat"' in text
