from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Any

import pytest
from fastapi import UploadFile

from src.ai_analyzer import server
from src.bot.handlers.data_management import delete_confirmation_keyboard, privacy_text
from src.bot.handlers.referrals import invite_keyboard
from src.bot.handlers.start import WELCOME_INTRO
from src.bot.services.links import PRIVACY_NOTE
from src.bot.services.diary_nudges import EVENING_NUDGE_TEXT, REVIVE_NUDGE_TEXT
from src.bot.services.referrals import reward_referrer_after_first_analysis
from src.bot.services.request_limit import limit_welcome_note
from src.db.models import User
from src.shared.schemas import AnalysisResult


class FakeReferralRepository:
    def __init__(self, referrer: User | None) -> None:
        self.referrer = referrer
        self.calls: list[tuple[int, int]] = []

    async def grant_referral_reward(
        self,
        user_id: int,
        *,
        bonus_requests: int,
    ) -> User | None:
        self.calls.append((user_id, bonus_requests))
        return self.referrer


class FakeBot:
    def __init__(self) -> None:
        self.messages: list[tuple[int, str]] = []

    async def send_message(self, telegram_id: int, text: str) -> None:
        self.messages.append((telegram_id, text))


def test_privacy_text_describes_storage_and_deletion() -> None:
    text = privacy_text()

    assert "Telegram ID" in text
    assert "результаты AI-анализа" in text
    assert "/delete_me" in text
    assert "/notifications_off" not in text


def test_onboarding_privacy_and_cleanup_copy_are_accurate() -> None:
    assert "профиль, записи и результаты анализа" in PRIVACY_NOTE
    assert "не храним" not in PRIVACY_NOTE.lower()
    assert "худеть" in WELCOME_INTRO
    assert "первого расчёта" in WELCOME_INTRO
    assert "🔒" not in WELCOME_INTRO
    assert "Как пользоваться" not in WELCOME_INTRO
    assert "служебных сообщений" not in WELCOME_INTRO
    assert "5 минут" not in WELCOME_INTRO


def test_landing_has_pricing_and_no_missing_demo_asset() -> None:
    template = (
        Path(__file__).parents[1] / "landing/public/index.template.html"
    ).read_text()

    assert "demo-meal.jpg" not in template
    assert "${FREE_DAILY_LIMIT}" in template
    assert "${SUBSCRIPTION_PRICE_STARS}" in template
    assert "${REFERRAL_BONUS_REQUESTS}" in template
    assert "/privacy.html" in template
    assert "/terms.html" in template
    assert "2000 ккал" in template
    assert "/invite" in template
    assert "/favorites" in template
    assert "клетчатк" in template.lower()
    assert "сахар" in template.lower()
    assert "не продлевается" in template
    assert "активность текстом, голосом или фото" not in template
    assert "По фото распознаётся только еда" in template

def test_delete_confirmation_requires_explicit_callback() -> None:
    callbacks = [
        button.callback_data
        for row in delete_confirmation_keyboard().inline_keyboard
        for button in row
    ]

    assert callbacks == ["data:delete_confirm", "data:delete_cancel"]


def test_invite_keyboard_uses_telegram_share_url() -> None:
    keyboard = invite_keyboard("https://t.me/taarelka_bot?start=ref_0123456789")
    button = keyboard.inline_keyboard[0][0]

    assert button.url is not None
    assert button.url.startswith("https://t.me/share/url?")
    assert "ref_0123456789" in button.url


@pytest.mark.asyncio
async def test_referral_reward_notifies_referrer() -> None:
    referrer = User(id=3, telegram_id=777, bonus_requests=5)
    repo = FakeReferralRepository(referrer)
    bot = FakeBot()

    rewarded = await reward_referrer_after_first_analysis(
        bot,  # type: ignore[arg-type]
        repo,  # type: ignore[arg-type]
        referred_user_id=9,
    )

    assert rewarded is True
    assert repo.calls == [(9, 3)]
    assert bot.messages[0][0] == 777
    assert "5" in bot.messages[0][1]


def test_limit_welcome_note_shows_bonus_requests(monkeypatch: pytest.MonkeyPatch) -> None:
    user = User(
        id=1,
        telegram_id=1,
        timezone="Europe/Moscow",
        daily_request_limit=6,
        bonus_requests=4,
    )

    note = limit_welcome_note(user)
    assert "Бонусных запросов: 4" in note
    assert "Чтобы увеличить лимит" not in note


def test_diary_nudge_messages_have_opt_out() -> None:
    assert "/notifications_off" in EVENING_NUDGE_TEXT
    assert "/notifications_off" in REVIVE_NUDGE_TEXT


@pytest.mark.asyncio
async def test_image_upload_is_deleted_after_analysis(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    upload_path = tmp_path / "upload.jpg"

    def fake_save_upload(filename: str, content: bytes) -> str:
        del filename
        upload_path.write_bytes(content)
        return str(upload_path)

    async def fake_analyze_auto(**kwargs: Any) -> AnalysisResult:
        assert kwargs["image_path"] == str(upload_path)
        return AnalysisResult(type="meal", title="Тест", total_calories=100)

    monkeypatch.setattr(server, "save_upload", fake_save_upload)
    monkeypatch.setattr(server.runner, "analyze_auto", fake_analyze_auto)
    upload = UploadFile(filename="meal.jpg", file=BytesIO(b"image"))

    response = await server.analyze_image(
        mode="auto",
        text=None,
        profile_context=None,
        previous_result=None,
        image=upload,
    )

    assert response.parsed.title == "Тест"
    assert not upload_path.exists()
