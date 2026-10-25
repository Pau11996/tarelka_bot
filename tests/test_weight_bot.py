from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from datetime import datetime, timezone

import pytest
from aiogram.fsm.context import FSMContext
from aiogram.fsm.storage.base import StorageKey
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import CallbackQuery, Message
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from src.bot.handlers import achievements as handlers
from src.bot.handlers import profile as profile_handlers
from src.bot.states import ProfileStates, WeightTrackingStates
from src.db.models import Base, Goal, Profile, User, WeightHistory
from src.db.repository import UserRepository
from src.db.session import get_session
from src.mobile_api.main import app
from src.mobile_api.tokens import issue_access_token
from src.shared.weight_tracking import achievements_payload

TG_ID = -190501


@pytest.fixture
async def bot_weights():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async def sessions():
        async with factory() as session:
            yield session
    app.dependency_overrides[get_session] = sessions
    async with factory() as session:
        repo = UserRepository(session)
        user = await repo.get_or_create_user(TG_ID, "Europe/Minsk")
        owner = user.id
        await repo.ensure_default_profile(owner)
    storage = MemoryStorage()
    state = FSMContext(storage=storage, key=StorageKey(bot_id=1, chat_id=TG_ID, user_id=TG_ID))
    headers = {"Authorization": f"Bearer {issue_access_token(owner)}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers=headers) as client:
        yield factory, owner, state, MagicMock(), client
    app.dependency_overrides.clear()
    await storage.close()
    await engine.dispose()


def message(text="", message_id=1):
    event = MagicMock(spec=Message)
    event.from_user = SimpleNamespace(id=TG_ID)
    event.chat = SimpleNamespace(id=TG_ID)
    event.message_id = message_id
    event.text = text
    event.photo = None
    event.voice = None
    event.answer = AsyncMock(return_value=MagicMock())
    event.edit_text = AsyncMock()
    event.bot = MagicMock()
    return event


def callback(data):
    event = MagicMock(spec=CallbackQuery)
    event.from_user = SimpleNamespace(id=TG_ID)
    event.data = data
    event.message = message()
    event.answer = AsyncMock()
    event.bot = MagicMock()
    return event


async def seed_weight(factory, owner, value=80):
    async with factory() as session:
        await UserRepository(session).upsert_profile(owner, weight_kg=value, daily_calorie_target=2100)


async def test_bot_goal_confirmation_is_shared_with_app_and_cancel_preserves_it(bot_weights):
    factory, owner, state, cleanup, client = bot_weights
    await seed_weight(factory, owner)
    async with factory() as session:
        await handlers.begin_goal(callback("ach:goal"), state, session, cleanup)
        assert await state.get_state() == WeightTrackingStates.goal_target.state
        target = message("70,5", 2)
        await handlers.target_weight(target, state, cleanup)
        assert await state.get_state() == WeightTrackingStates.goal_confirm.state
        assert "80 кг" in target.answer.call_args.args[0] and "70,5 кг" in target.answer.call_args.args[0]
        assert (await client.get("/v1/achievements")).json()["goal"] is None
        await handlers.confirm_goal(callback("ach:goal_save"), state, session, cleanup)
    data = (await client.get("/v1/achievements")).json()
    assert data["goal"]["target_weight_kg"] == 70.5
    assert "Со старта: 0 кг" in handlers.overview_text(data)
    assert (await client.get("/v1/profile")).json()["daily_calorie_target"] == 2100
    async with factory() as session:
        await handlers.begin_goal(callback("ach:goal"), state, session, cleanup)
        await handlers.target_weight(message("60", 3), state, cleanup)
        await handlers.home(callback("ach:home"), state, session, cleanup)
        assert await state.get_state() is None
    assert (await client.get("/v1/achievements")).json()["goal"]["id"] == data["goal"]["id"]


async def test_missing_start_weight_is_recorded_and_replayed_input_is_not_a_target(bot_weights):
    factory, _, state, cleanup, client = bot_weights
    async with factory() as session:
        await handlers.begin_goal(callback("ach:goal"), state, session, cleanup)
        assert await state.get_state() == WeightTrackingStates.goal_start_weight.state
        start = message("80", 4)
        await handlers.goal_start_weight(start, state, session, cleanup)
        assert await state.get_state() == WeightTrackingStates.goal_target.state
        await handlers.target_weight(start, state, cleanup)
        assert await state.get_state() == WeightTrackingStates.goal_target.state
        for value in ["NaN", "-10", "0"]:
            await handlers.target_weight(message(value, 5), state, cleanup)
            assert await state.get_state() == WeightTrackingStates.goal_target.state
    assert len((await client.get("/v1/weight")).json()["weight"]) == 1


async def test_weight_entry_same_value_retries_and_legacy_profile_share_one_service(bot_weights):
    factory, owner, state, cleanup, client = bot_weights
    await seed_weight(factory, owner)
    event = message("80", 6)
    async with factory() as session:
        await handlers.begin_weigh(callback("ach:weigh"), state, cleanup)
        await handlers.save_measurement(event, state, session, cleanup)
        await handlers.save_measurement(event, state, session, cleanup)
        await profile_handlers.save_weight(event, state, session, cleanup)
        assert await session.scalar(select(func.count()).select_from(WeightHistory).where(WeightHistory.user_id == owner)) == 2
    assert (await client.get("/v1/profile")).json()["daily_calorie_target"] == 2100


async def test_stale_bot_confirmation_cannot_replace_a_new_app_goal(bot_weights):
    factory, owner, state, cleanup, client = bot_weights
    await seed_weight(factory, owner)
    async with factory() as session:
        await handlers.begin_goal(callback("ach:goal"), state, session, cleanup)
        await handlers.target_weight(message("70", 7), state, cleanup)
        assert (await client.put("/v1/weight-goal", json={"target_weight_kg": 75})).status_code == 200
        stale = callback("ach:goal_save")
        await handlers.confirm_goal(stale, state, session, cleanup)
        assert stale.answer.call_args.kwargs["show_alert"] is True
    assert (await client.get("/v1/achievements")).json()["goal"]["target_weight_kg"] == 75


async def test_bot_reminder_schedule_shared_with_app_and_persistent_message_not_edited(bot_weights):
    factory, owner, state, cleanup, client = bot_weights
    async with factory() as session:
        await handlers.choose_reminder_time(callback("ach:day:3"), state, cleanup)
        assert await state.get_state() == WeightTrackingStates.reminder_time.state
        await handlers.save_reminder_time(message("25:00", 8), state, session, cleanup)
        assert await state.get_state() == WeightTrackingStates.reminder_time.state
        await handlers.save_reminder_time(message("08:15", 9), state, session, cleanup)
        assert await state.get_state() is None
        event = callback("ach:reminder_on")
        await handlers.toggle_reminder(event, state, session, cleanup)
        event.message.edit_text.assert_not_awaited()
    data = (await client.get("/v1/achievements")).json()
    assert data["reminder"]["enabled"] and data["reminder"]["weekday"] == 3 and data["reminder"]["local_time"] == "08:15"
    async with factory() as session:
        user = await session.get(User, owner)
        await UserRepository(session).set_notifications_enabled(user, False)
    assert (await client.get("/v1/achievements")).json()["reminder"]["effective_enabled"] is False
    async with factory() as session:
        await handlers.toggle_reminder(callback("ach:reminder_off"), state, session, cleanup)
    assert (await client.get("/v1/achievements")).json()["reminder"]["enabled"] is False


@pytest.mark.parametrize("target", [None, "70,5"])
async def test_bot_initial_profile_optional_target_and_initial_calorie_calculation(bot_weights, target):
    factory, owner, state, cleanup, client = bot_weights
    await state.update_data(initial_setup=True, weight_kg=80, height_cm=180, age=30, sex="male")
    async with factory() as session:
        await profile_handlers.profile_goal(callback("goal:maintain"), state, session, cleanup)
        assert await state.get_state() == ProfileStates.target_weight.state
        if target:
            await profile_handlers.profile_target_weight(message(target, 10), state, cleanup)
        else:
            await profile_handlers.skip_profile_target(callback("profile:skip_target_weight"), state, cleanup)
        assert await state.get_state() == ProfileStates.activity_level.state
        await profile_handlers.profile_activity(callback("activity:moderate"), state, session, cleanup)
    profile = (await client.get("/v1/profile")).json()
    assert profile["is_complete"] and profile["daily_calorie_target"] != 2000
    assert profile["goal"] == ("lose" if target else "maintain")
    data = (await client.get("/v1/achievements")).json()
    assert (data["goal"]["target_weight_kg"] if data["goal"] else None) == (70.5 if target else None)


async def test_reached_goal_is_completed_and_no_longer_offered_for_editing(bot_weights):
    factory, owner, state, cleanup, client = bot_weights
    await seed_weight(factory, owner)
    goal = (await client.put("/v1/weight-goal", json={"target_weight_kg": 70})).json()["goal"]
    await client.post("/v1/weight", json={"weight_kg": 69, "operation_id": "crossed"})
    async with factory() as session:
        await handlers.begin_goal(callback("ach:goal"), state, session, cleanup)
        event = message("70", 11)
        await handlers.target_weight(event, state, cleanup)
        text = event.answer.call_args.args[0]
        assert "69 кг" in text and "70 кг" in text
        await handlers.confirm_goal(callback("ach:goal_save"), state, session, cleanup)
    saved = (await client.get("/v1/achievements")).json()["goal"]
    assert saved["id"] != goal["id"] and saved["direction"] == "gain"
    assert (await client.get("/v1/achievements")).json()["goal_history"][0]["status"] == "completed"


async def test_overview_is_compact_and_settings_hold_reminder_and_cancel(bot_weights):
    factory, owner, state, cleanup, client = bot_weights
    await seed_weight(factory, owner, 82)
    await client.put("/v1/weight-goal", json={"target_weight_kg": 75})
    await client.post("/v1/weight", json={"weight_kg": 78.4, "operation_id": "progress"})
    data = (await client.get("/v1/achievements")).json()
    text = handlers.overview_text(data)
    assert "Вес и цель" in text and "78,4 кг" in text and "75 кг" in text
    assert "Со старта: −3,6 кг" in text and "До цели: 3,4 кг" in text
    assert not any(word in text for word in ("Наград", "Достижения", "%", "Завершить"))
    rows = handlers.overview_keyboard(data).inline_keyboard
    assert [[button.text for button in row] for row in rows] == [["Записать вес"], ["История", "Изменить цель"], ["Настройки"]]
    event = callback("ach:settings")
    async with factory() as session:
        await handlers.tracking_settings(event, state, session, cleanup)
    buttons = event.message.edit_text.call_args.kwargs["reply_markup"].inline_keyboard
    assert [row[0].text for row in buttons] == ["Напоминание о взвешивании", "Отменить цель", "Вес и цель"]
    assert data["achievements"], "App awards must remain available"


async def test_no_goal_and_no_weight_still_offer_recording_and_setting_goal(bot_weights):
    _, _, _, _, client = bot_weights
    data = (await client.get("/v1/achievements")).json()
    assert "Вес пока не записан" in handlers.overview_text(data)
    assert "— кг" not in handlers.overview_text(data)
    assert [row[0].text for row in handlers.overview_keyboard(data).inline_keyboard] == ["Записать вес", "Задать цель", "История", "Настройки"]


async def test_bot_equal_target_stays_in_input_without_creating_goal(bot_weights):
    factory, owner, state, cleanup, client = bot_weights
    await seed_weight(factory, owner)
    async with factory() as session:
        await handlers.begin_goal(callback("ach:goal"), state, session, cleanup)
        target = message("80", 12)
        await handlers.target_weight(target, state, cleanup)
        assert await state.get_state() == WeightTrackingStates.goal_target.state
        assert "Этот вес уже достигнут" in target.answer.call_args.args[0]
    assert (await client.get("/v1/achievements")).json()["goal"] is None


async def test_initial_profile_also_rejects_target_equal_to_current_weight(bot_weights):
    factory, _, state, cleanup, client = bot_weights
    await state.update_data(initial_setup=True, weight_kg=80, height_cm=180, age=30, sex="male")
    async with factory() as session:
        await profile_handlers.profile_goal(callback("goal:maintain"), state, session, cleanup)
        event = message("80", 14)
        await profile_handlers.profile_target_weight(event, state, cleanup)
        assert await state.get_state() == ProfileStates.target_weight.state
        assert "Этот вес уже достигнут" in event.answer.call_args.args[0]
        await profile_handlers.skip_profile_target(callback("profile:skip_target_weight"), state, cleanup)
        await profile_handlers.profile_activity(callback("activity:moderate"), state, session, cleanup)
    assert (await client.get("/v1/profile")).json()["is_complete"]
    assert (await client.get("/v1/achievements")).json()["goal"] is None


async def test_unchanged_goal_preserves_its_original_start(bot_weights):
    factory, owner, state, cleanup, client = bot_weights
    await seed_weight(factory, owner)
    goal = (await client.put("/v1/weight-goal", json={"target_weight_kg": 70})).json()["goal"]
    await client.post("/v1/weight", json={"weight_kg": 75, "operation_id": "midway"})
    async with factory() as session:
        await handlers.begin_goal(callback("ach:goal"), state, session, cleanup)
        await handlers.target_weight(message("70", 13), state, cleanup)
        await handlers.confirm_goal(callback("ach:goal_save"), state, session, cleanup)
    saved = (await client.get("/v1/achievements")).json()["goal"]
    assert saved["id"] == goal["id"] and saved["start_weight_kg"] == 80


@pytest.mark.parametrize("legacy", ["ach:badges", "ach:continue", "ach:complete:old", "ach:close_complete:old"])
async def test_legacy_callbacks_open_overview_without_awards(bot_weights, legacy):
    factory, _, state, cleanup, _ = bot_weights
    event = callback(legacy)
    async with factory() as session:
        await handlers.home(event, state, session, cleanup)
    assert "Вес и цель" in event.message.edit_text.call_args.args[0]
    assert "наград" not in event.message.edit_text.call_args.args[0].lower()


async def test_telegram_routing_walkthrough_uses_new_command_and_legacy_buttons(bot_weights):
    """Exercise real Telegram filters and messages with a fully offline transport."""
    from aiogram import Bot
    from aiogram.client.session.base import BaseSession
    from aiogram.methods import AnswerCallbackQuery, EditMessageText, SendMessage
    from aiogram.types import Chat, User as TelegramUser
    from src.shared.achievement_messages import deliver_goal_messages

    factory, _, state, cleanup, client = bot_weights

    class TestTelegram(BaseSession):
        def __init__(self):
            super().__init__()
            self.messages = []

        async def close(self):
            pass

        async def stream_content(self, url, **kwargs):
            raise AssertionError("The walkthrough must never download from Telegram")
            yield b""

        async def make_request(self, bot, method, timeout=None):
            if isinstance(method, AnswerCallbackQuery):
                return True
            assert isinstance(method, (SendMessage, EditMessageText)), type(method)
            sent = Message(message_id=1000 + len(self.messages), date=datetime.now(timezone.utc),
                           chat=Chat(id=TG_ID, type="private"), text=method.text,
                           reply_markup=method.reply_markup).as_(bot)
            self.messages.append(sent)
            return sent

    transport = TestTelegram()
    bot = Bot("123456:offline-test-token", session=transport)
    sender = TelegramUser(id=TG_ID, is_bot=False, first_name="Test")
    update_id = 0

    async def route_text(text):
        nonlocal update_id
        update_id += 1
        event = Message(message_id=update_id, date=datetime.now(timezone.utc),
                        chat=Chat(id=TG_ID, type="private"), from_user=sender, text=text).as_(bot)
        async with factory() as session:
            return await handlers.router.propagate_event("message", event, bot=bot, state=state,
                raw_state=await state.get_state(), session=session, cleanup=cleanup)

    async def route_button(data):
        nonlocal update_id
        update_id += 1
        event = CallbackQuery(id=str(update_id), from_user=sender, chat_instance="test",
                              message=transport.messages[-1], data=data).as_(bot)
        async with factory() as session:
            return await handlers.router.propagate_event("callback_query", event, bot=bot,
                state=state, raw_state=await state.get_state(), session=session, cleanup=cleanup)

    try:
        await route_text("/weight")
        assert "Вес и цель" in transport.messages[-1].text
        await route_button("ach:goal")
        await route_text("82")
        await route_text("75")
        await route_button("ach:goal_save")
        assert (await client.get("/v1/achievements")).json()["goal"]["target_weight_kg"] == 75
        await route_button("ach:weigh")
        await route_text("78,4")
        assert "Со старта: −3,6 кг" in transport.messages[-1].text
        await route_button("ach:weigh")
        await route_text("75")
        assert (await client.get("/v1/achievements")).json()["goal"] is None
        assert await deliver_goal_messages(bot, session_factory=factory) == 1
        assert await deliver_goal_messages(bot, session_factory=factory) == 0
        assert [row[0].text for row in transport.messages[-1].reply_markup.inline_keyboard] == ["Задать новую цель", "Вес и цель"]
        await route_button("ach:badges")
        await route_text("/achievements")
        await route_text("🏆 Достижения")
        assert "Вес и цель" in transport.messages[-1].text
        assert all("наград" not in sent.text.lower() and "🏆" not in sent.text for sent in transport.messages)
    finally:
        await bot.session.close()


@pytest.mark.parametrize("kind", ["photo", "voice"])
async def test_weight_form_rejects_real_media_updates_without_recognition(bot_weights, monkeypatch, kind):
    from aiogram import Bot
    from aiogram.types import Chat, User as TelegramUser
    from src.bot.handlers import food

    factory, _, state, cleanup, _ = bot_weights
    handler = AsyncMock()
    monkeypatch.setattr(food, f"handle_food_{kind}", handler)
    reply = AsyncMock()
    monkeypatch.setattr(handlers, "answer_ephemeral", reply)
    bot = Bot("123456:offline-test-token")
    media = {"photo": [{"file_id": "scale", "file_unique_id": "scale", "width": 100, "height": 100}]} if kind == "photo" else {
        "voice": {"file_id": "voice", "file_unique_id": "voice", "duration": 3}}
    event = Message(message_id=100, date=datetime.now(timezone.utc), chat=Chat(id=TG_ID, type="private"),
                    from_user=TelegramUser(id=TG_ID, is_bot=False, first_name="Test"), **media).as_(bot)
    try:
        await state.set_state(WeightTrackingStates.weight)
        async with factory() as session:
            await handlers.router.propagate_event("message", event, bot=bot, state=state,
                raw_state=await state.get_state(), session=session, cleanup=cleanup)
        handler.assert_not_awaited()
        assert await state.get_state() == WeightTrackingStates.weight.state
        assert "Введите вес числом" in reply.call_args.args[2]
    finally:
        await bot.session.close()
