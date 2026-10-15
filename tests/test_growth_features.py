from __future__ import annotations

from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

import pytest
from fastapi import UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from src.ai_analyzer import server
from src.bot.config import settings
from src.bot.handlers.data_management import delete_confirmation_keyboard, privacy_text
from src.bot.handlers.referrals import invite_keyboard
from src.bot.handlers.start import WELCOME_INTRO
from src.bot.services.links import PRIVACY_NOTE
from src.bot.services.diary_nudges import EVENING_NUDGE_TEXT, REVIVE_NUDGE_TEXT
from src.bot.services.referrals import (
    format_invite_text,
    format_referral_reward_notice,
    reward_referrer_after_first_analysis,
)
from src.bot.services.request_limit import limit_welcome_note
from src.db.models import Base, Payment, User
from src.db.repository import ReferralGrant, UserRepository
from src.shared.schemas import AnalysisResult


class FakeReferralRepository:
    def __init__(self, grant: ReferralGrant | None) -> None:
        self.grant = grant
        self.calls: list[tuple[int, int, int]] = []

    async def grant_referral_reward(
        self,
        user_id: int,
        *,
        monthly_goal: int,
        duration_days: int,
        now: datetime | None = None,
    ) -> ReferralGrant | None:
        del now
        self.calls.append((user_id, monthly_goal, duration_days))
        return self.grant


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


def test_landing_has_pricing() -> None:
    template = (
        Path(__file__).parents[1] / "landing/public/index.template.html"
    ).read_text()

    assert "${FREE_PHOTO_DAILY_LIMIT}" in template
    assert "${FREE_TEXT_DAILY_LIMIT}" in template
    assert "${FREE_VOICE_DAILY_LIMIT}" in template
    assert "${SUBSCRIPTION_PRICE_STARS}" in template
    assert "${REFERRAL_MONTHLY_GOAL}" in template
    assert "месяц подписки" in template
    assert "${REFERRAL_BONUS_REQUESTS}" not in template
    terms = (Path(__file__).parents[1] / "landing/public/terms.template.html").read_text()
    assert "реферальной программой" in terms
    assert "реферальными бонусами" not in terms
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
    assert "Калории по фото в Telegram" in template
    assert "Считайте калории по" in template
    assert 'rel="canonical" href="${LANDING_ORIGIN}/"' in template
    assert "og:url" in template

    nginx = (Path(__file__).parents[1] / "landing/nginx.conf.template").read_text()
    entrypoint = (Path(__file__).parents[1] / "landing/docker-entrypoint.sh").read_text()
    assert "/index.html;" not in nginx
    assert "try_files $uri =404;" in nginx
    assert "www.${LANDING_HOST}" in nginx
    assert "robots.txt" in entrypoint
    assert "sitemap.xml" in entrypoint
    assert (Path(__file__).parents[1] / "landing/public/404.html").is_file()

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


def test_invite_text_shows_monthly_subscription_goal() -> None:
    text = format_invite_text(
        url="https://t.me/taarelka_bot?start=ref_0123456789",
        progress=2,
        goal=5,
        rewarded=False,
    )

    assert "5 друзей за календарный месяц — подписка на месяц." in text
    assert "В этом месяце: 2 из 5." in text
    assert "бонусных запрос" not in text
    assert text.endswith("https://t.me/taarelka_bot?start=ref_0123456789")


def test_referral_notices_cover_progress_grant_and_repeat() -> None:
    referrer = User(
        id=3,
        telegram_id=777,
        timezone="Europe/Moscow",
        subscription_until=datetime(2026, 5, 1, tzinfo=timezone.utc),
    )
    progress = format_referral_reward_notice(
        ReferralGrant(referrer=referrer, progress=3, goal=5, granted=False, already_rewarded=False)
    )
    granted = format_referral_reward_notice(
        ReferralGrant(referrer=referrer, progress=5, goal=5, granted=True, already_rewarded=False)
    )
    repeat = format_referral_reward_notice(
        ReferralGrant(referrer=referrer, progress=6, goal=5, granted=False, already_rewarded=True)
    )

    assert "3 из 5" in progress
    assert "Ещё 2 друга" in progress
    assert "Подписка активна до 01.05.2026." in granted
    assert "уже начислена" in repeat
    assert "с нуля" in repeat


@pytest.mark.asyncio
async def test_referral_reward_notifies_referrer() -> None:
    referrer = User(
        id=3,
        telegram_id=777,
        timezone="Europe/Moscow",
        subscription_until=datetime(2026, 5, 1, tzinfo=timezone.utc),
    )
    grant = ReferralGrant(
        referrer=referrer,
        progress=5,
        goal=5,
        granted=True,
        already_rewarded=False,
    )
    repo = FakeReferralRepository(grant)
    bot = FakeBot()

    rewarded = await reward_referrer_after_first_analysis(
        bot,  # type: ignore[arg-type]
        repo,  # type: ignore[arg-type]
        referred_user_id=9,
    )

    assert rewarded is True
    assert repo.calls == [
        (9, settings.referral_monthly_goal, settings.subscription_duration_days)
    ]
    assert bot.messages[0][0] == 777
    assert "01.05.2026" in bot.messages[0][1]


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


@pytest.fixture
async def referral_repo():
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield UserRepository(session)
    await engine.dispose()


async def _add_referred(repo: UserRepository, referrer_id: int, telegram_id: int) -> User:
    user = User(
        telegram_id=telegram_id,
        timezone="Europe/Moscow",
        referred_by_user_id=referrer_id,
    )
    repo.session.add(user)
    await repo.session.commit()
    await repo.session.refresh(user)
    return user


@pytest.mark.asyncio
async def test_fifth_referral_grants_one_subscription_month(referral_repo: UserRepository) -> None:
    march = datetime(2026, 3, 15, 12, tzinfo=timezone.utc)
    existing_until = march + timedelta(days=10)
    referrer = User(
        telegram_id=501,
        timezone="Europe/Moscow",
        bonus_requests=2,
        subscription_until=existing_until,
        subscription_last_notified_until=existing_until,
    )
    referral_repo.session.add(referrer)
    await referral_repo.session.commit()
    await referral_repo.session.refresh(referrer)

    first = await _add_referred(referral_repo, referrer.id, 601)
    first_grant = await referral_repo.grant_referral_reward(
        first.id, monthly_goal=5, duration_days=30, now=march
    )
    assert first_grant is not None and first_grant.progress == 1 and not first_grant.granted
    assert await referral_repo.grant_referral_reward(
        first.id, monthly_goal=5, duration_days=30, now=march
    ) is None

    for offset, telegram_id in enumerate((602, 603, 604), start=2):
        friend = await _add_referred(referral_repo, referrer.id, telegram_id)
        grant = await referral_repo.grant_referral_reward(
            friend.id, monthly_goal=5, duration_days=30, now=march
        )
        assert grant is not None
        assert grant.progress == offset
        assert grant.granted is False
        assert referrer.referral_subscription_month is None
        assert _as_utc(referrer.subscription_until) == existing_until

    fifth = await _add_referred(referral_repo, referrer.id, 605)
    granted = await referral_repo.grant_referral_reward(
        fifth.id, monthly_goal=5, duration_days=30, now=march
    )
    assert granted is not None
    assert granted.granted is True
    assert granted.already_rewarded is False
    assert granted.progress == 5
    assert referrer.referral_subscription_month == "2026-03"
    assert referrer.subscription_last_notified_until is None
    assert _as_utc(referrer.subscription_until) == existing_until + timedelta(days=30)
    assert referrer.bonus_requests == 2
    payments = await referral_repo.session.scalar(select(func.count()).select_from(Payment))
    assert payments == 0

    paid_until = _as_utc(referrer.subscription_until)
    sixth = await _add_referred(referral_repo, referrer.id, 606)
    repeat = await referral_repo.grant_referral_reward(
        sixth.id, monthly_goal=5, duration_days=30, now=march
    )
    assert repeat is not None
    assert repeat.granted is False
    assert repeat.already_rewarded is True
    assert repeat.progress == 6
    assert referrer.referral_subscription_month == "2026-03"
    assert _as_utc(referrer.subscription_until) == paid_until

    april = datetime(2026, 4, 10, 12, tzinfo=timezone.utc)
    april_grant = None
    for telegram_id in range(701, 706):
        friend = await _add_referred(referral_repo, referrer.id, telegram_id)
        april_grant = await referral_repo.grant_referral_reward(
            friend.id, monthly_goal=5, duration_days=30, now=april
        )
        assert april_grant is not None
    assert april_grant is not None
    assert april_grant.granted is True
    assert april_grant.progress == 5
    assert referrer.referral_subscription_month == "2026-04"
    assert _as_utc(referrer.subscription_until) == paid_until + timedelta(days=30)


@pytest.mark.asyncio
async def test_referral_month_uses_referrer_timezone(referral_repo: UserRepository) -> None:
    referrer = User(telegram_id=801, timezone="Europe/Moscow")
    referral_repo.session.add(referrer)
    await referral_repo.session.commit()
    await referral_repo.session.refresh(referrer)

    still_march = datetime(2026, 3, 31, 20, 30, tzinfo=timezone.utc)
    already_april = datetime(2026, 3, 31, 21, 30, tzinfo=timezone.utc)

    for telegram_id in range(810, 814):
        friend = await _add_referred(referral_repo, referrer.id, telegram_id)
        grant = await referral_repo.grant_referral_reward(
            friend.id, monthly_goal=5, duration_days=30, now=still_march
        )
        assert grant is not None and not grant.granted

    crossing = await _add_referred(referral_repo, referrer.id, 814)
    april_progress = await referral_repo.grant_referral_reward(
        crossing.id, monthly_goal=5, duration_days=30, now=already_april
    )
    assert april_progress is not None
    assert april_progress.progress == 1
    assert april_progress.granted is False
    assert referrer.referral_subscription_month is None
    assert referrer.subscription_until is None

    last = None
    for telegram_id in range(815, 819):
        friend = await _add_referred(referral_repo, referrer.id, telegram_id)
        last = await referral_repo.grant_referral_reward(
            friend.id, monthly_goal=5, duration_days=30, now=already_april
        )
    assert last is not None
    assert last.progress == 5
    assert last.granted is True
    assert referrer.referral_subscription_month == "2026-04"


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
