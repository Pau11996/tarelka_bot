from src.bot.config import settings
from src.bot.handlers.subscription import format_payment_support
from src.bot.keyboards.menus import CONTACTS_BUTTON, contacts_keyboard, main_menu
from src.bot.services.links import SUPPORT_EMAIL, format_contacts


def test_main_menu_includes_contacts() -> None:
    texts = [button.text for row in main_menu().keyboard for button in row]
    assert CONTACTS_BUTTON in texts


def test_format_contacts_with_links(monkeypatch) -> None:
    monkeypatch.setattr(settings, "telegram_feedback_chat", "taarelkachat")
    monkeypatch.setattr(settings, "telegram_channel", "taarelka_news")

    text = format_contacts()
    keyboard = contacts_keyboard()

    assert "Контакты ТАРЕЛКИ" in text
    assert SUPPORT_EMAIL in text
    assert f"<code>{SUPPORT_EMAIL}</code>" in text
    assert 'href="https://t.me/taarelkachat"' in text
    assert 'href="https://t.me/taarelka_news"' in text
    assert "Telegram Support" in text
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
