from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from src.bot.handlers.start import DEFAULT_TARGET_NOTE, READY_TEXT, build_welcome_new, start_begin
from src.bot.keyboards.menus import profile_card_keyboard, profile_fill_keyboard
from src.bot.services.formatting import format_profile_card, profile_context
from src.bot.services.nutrition import calculate_daily_nutrient_targets, calculate_daily_target
from src.bot.states import ProfileStates
from src.db.models import ActivityLevel, Goal, Profile, Sex, User, WeightHistory
from src.db.repository import DEFAULT_DAILY_CALORIE_TARGET, UserRepository


def _incomplete_profile(**overrides) -> Profile:
    data = {
        "id": 1,
        "user_id": 1,
        "weight_kg": None,
        "height_cm": None,
        "age": None,
        "sex": None,
        "goal": None,
        "activity_level": None,
        "daily_calorie_target": DEFAULT_DAILY_CALORIE_TARGET,
    }
    data.update(overrides)
    return Profile(**data)


def _complete_profile(**overrides) -> Profile:
    data = {
        "id": 1,
        "user_id": 1,
        "weight_kg": 80,
        "height_cm": 180,
        "age": 30,
        "sex": Sex.MALE,
        "goal": Goal.MAINTAIN,
        "activity_level": ActivityLevel.MODERATE,
        "daily_calorie_target": 2500,
    }
    data.update(overrides)
    return Profile(**data)


def test_profile_is_complete_requires_all_anthropometrics() -> None:
    assert not _incomplete_profile().is_complete()
    assert not _incomplete_profile(weight_kg=70).is_complete()
    assert _complete_profile().is_complete()


def test_format_profile_card_shows_unspecified_for_defaults() -> None:
    text = format_profile_card(_incomplete_profile())
    assert "не указано" in text
    assert "2000 ккал" in text
    assert text.count("не указано") == 6


def test_profile_context_omits_empty_fields() -> None:
    context = profile_context(_incomplete_profile())
    assert context == {"daily_calorie_target": 2000.0}


def test_profile_context_includes_filled_fields() -> None:
    context = profile_context(_complete_profile())
    assert context["weight_kg"] == 80
    assert context["sex"] == "male"
    assert context["daily_calorie_target"] == 2500


def test_nutrient_targets_without_weight_use_calorie_shares() -> None:
    targets = calculate_daily_nutrient_targets(_incomplete_profile())
    assert targets.protein_g == 125.0  # 25% of 2000 / 4
    assert targets.fat_g == 60.0  # 27% of 2000 / 9
    assert targets.carbs_g == 240.0
    assert targets.micronutrients["fiber_g"] == 28.0
    assert targets.micronutrients["sugar_g"] == 50.0


def test_welcome_mentions_default_calorie_target() -> None:
    user = User(id=1, telegram_id=1, timezone="Europe/Moscow", daily_request_limit=6)
    text = build_welcome_new(user)
    assert "2000" in text
    assert "Стартовая норма" in DEFAULT_TARGET_NOTE
    assert DEFAULT_TARGET_NOTE in text
    assert "Как пользоваться: /help" in text
    assert "отправьте фото, голосовое или описание блюда" not in text
    assert "чат поддержки" not in text
    assert "служебных сообщений" not in text
    assert "/privacy" not in text
    assert "/delete_me" not in text
    assert "Чтобы увеличить лимит" not in text
    assert "оформить подписку" not in text
    assert "Доступно 6 запросов в день" in text
    assert "не претендует на идеальную точность" in text


def test_profile_fill_keyboard_uses_start_begin() -> None:
    keyboard = profile_fill_keyboard()
    assert keyboard.inline_keyboard[0][0].callback_data == "start:begin"
    assert "Заполнить профиль" in keyboard.inline_keyboard[0][0].text


def test_profile_card_keyboard_fill_label_for_incomplete() -> None:
    incomplete = profile_card_keyboard(is_complete=False)
    complete = profile_card_keyboard(is_complete=True)
    assert "Заполнить профиль" in incomplete.inline_keyboard[0][0].text
    assert incomplete.inline_keyboard[0][0].callback_data == "profile:edit"
    assert "Редактировать профиль" in complete.inline_keyboard[0][0].text


def test_incomplete_profile_recalculates_target_on_fill() -> None:
    incomplete = _incomplete_profile(daily_calorie_target=2000)
    recalculated = calculate_daily_target(
        weight_kg=80,
        height_cm=180,
        age=30,
        sex=Sex.MALE,
        goal=Goal.MAINTAIN,
        activity_level=ActivityLevel.MODERATE,
    )
    was_complete = incomplete.is_complete()
    daily_target = incomplete.daily_calorie_target if was_complete else recalculated
    assert not was_complete
    assert daily_target == recalculated
    assert daily_target != 2000


def test_complete_profile_keeps_manual_calorie_target() -> None:
    complete = _complete_profile(daily_calorie_target=2200)
    recalculated = calculate_daily_target(
        weight_kg=80,
        height_cm=180,
        age=30,
        sex=Sex.MALE,
        goal=Goal.MAINTAIN,
        activity_level=ActivityLevel.MODERATE,
    )
    was_complete = complete.is_complete()
    daily_target = complete.daily_calorie_target if was_complete else recalculated
    assert was_complete
    assert daily_target == 2200


@pytest.mark.asyncio
async def test_ensure_default_profile_creates_neutral_2000() -> None:
    session = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.add = MagicMock()
    empty_result = MagicMock()
    empty_result.scalar_one_or_none.return_value = None
    session.execute = AsyncMock(return_value=empty_result)

    repo = UserRepository(session)
    profile = await repo.ensure_default_profile(user_id=42)

    assert profile.daily_calorie_target == DEFAULT_DAILY_CALORIE_TARGET
    assert profile.weight_kg is None
    assert profile.height_cm is None
    assert profile.age is None
    assert profile.sex is None
    assert profile.goal is None
    assert profile.activity_level is None
    assert not profile.is_complete()

    added = [call.args[0] for call in session.add.call_args_list]
    assert len(added) == 1
    assert isinstance(added[0], Profile)
    assert not any(isinstance(obj, WeightHistory) for obj in added)


@pytest.mark.asyncio
async def test_ensure_default_profile_returns_existing() -> None:
    existing = _complete_profile()
    session = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = existing
    session.execute = AsyncMock(return_value=result)
    repo = UserRepository(session)

    profile = await repo.ensure_default_profile(user_id=1)

    assert profile is existing
    session.add.assert_not_called()


@pytest.mark.asyncio
async def test_start_begin_starts_form_for_incomplete_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    from src.bot.handlers import start as start_module

    user = User(id=1, telegram_id=100, timezone="Europe/Moscow")
    profile = _incomplete_profile()

    class FakeRepo:
        async def get_or_create_user(self, telegram_id: int, timezone: str) -> User:
            del telegram_id, timezone
            return user

        async def ensure_default_profile(self, user_id: int) -> Profile:
            del user_id
            return profile

    monkeypatch.setattr(start_module, "UserRepository", lambda session: FakeRepo())

    state = AsyncMock()
    callback = AsyncMock()
    callback.from_user.id = 100
    callback.message = AsyncMock()
    callback.message.edit_reply_markup = AsyncMock()
    cleanup = MagicMock()

    answered: list[tuple] = []

    async def fake_answer_persistent_with_menu(message, text, *, cleanup=None, **kwargs):
        answered.append((text, kwargs.get("reply_markup")))
        return AsyncMock()

    monkeypatch.setattr(start_module, "answer_persistent_with_menu", fake_answer_persistent_with_menu)

    await start_begin(callback, state, session=MagicMock(), cleanup=cleanup)

    state.set_state.assert_awaited_once_with(ProfileStates.weight)
    assert answered[0][0].startswith("Шаг 1 из 6 · Вес")
    callback.message.edit_reply_markup.assert_awaited()


@pytest.mark.asyncio
async def test_start_begin_ready_text_for_complete_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    from src.bot.handlers import start as start_module

    user = User(id=1, telegram_id=100, timezone="Europe/Moscow")
    profile = _complete_profile()

    class FakeRepo:
        async def get_or_create_user(self, telegram_id: int, timezone: str) -> User:
            del telegram_id, timezone
            return user

        async def ensure_default_profile(self, user_id: int) -> Profile:
            del user_id
            return profile

    monkeypatch.setattr(start_module, "UserRepository", lambda session: FakeRepo())

    state = AsyncMock()
    callback = AsyncMock()
    callback.from_user.id = 100
    callback.message = AsyncMock()
    cleanup = MagicMock()

    answered: list[str] = []

    async def fake_answer_persistent_with_menu(message, text, *, cleanup=None, **kwargs):
        answered.append(text)
        return AsyncMock()

    monkeypatch.setattr(start_module, "answer_persistent_with_menu", fake_answer_persistent_with_menu)

    await start_begin(callback, state, session=MagicMock(), cleanup=cleanup)

    state.set_state.assert_not_called()
    assert answered == [READY_TEXT]
