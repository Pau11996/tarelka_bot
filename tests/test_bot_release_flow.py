"""Release walkthrough through the real dispatcher, SQLite and offline Telegram."""
from datetime import datetime, timezone
from itertools import count
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from aiogram import Bot
from aiogram.client.session.base import BaseSession
from aiogram.exceptions import TelegramBadRequest
from aiogram.types import CallbackQuery, Chat, File, InlineKeyboardMarkup, Message, PreCheckoutQuery, Update, User as TelegramUser
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.bot import main
from src.bot.handlers import correction, food, subscription
from src.bot.services.links import MENU_COMMANDS
from src.bot.services.nutrition import local_today
from src.bot.states import ProfileStates, WeightTrackingStates, StatisticsStates, CorrectionStates, SurveyStates
from src.db.models import Base, DayEntry, EntryType, FavoriteMeal, Payment, Profile, User, WeightGoal, WeightHistory
from src.db.repository import UserRepository
from src.shared.schemas import AnalysisResult
from src.shared.achievement_messages import deliver_goal_messages
from src.shared.weight_reminders import REMINDER_TEXT, run_weigh_reminders_iteration
from src.shared.weight_tracking import reminder_out, set_reminder


class OfflineTelegram(BaseSession):
    def __init__(self):
        super().__init__()
        self.calls = []
        self.messages = []

    async def close(self):
        pass

    async def stream_content(self, url, **kwargs):
        yield b"offline media fixture"

    async def make_request(self, bot, method, timeout=None):
        self.calls.append(method)
        name = method.__api_method__
        if name == "sendRichMessage":
            raise TelegramBadRequest(method, "Exercise the plain-text fallback")
        if name == "getFile":
            return File(file_id=method.file_id, file_unique_id="fixture", file_path="fixture.bin")
        if name in {"deleteMessage", "answerCallbackQuery", "answerPreCheckoutQuery"}:
            return True
        if name == "editMessageReplyMarkup":
            return True
        assert name in {"sendMessage", "editMessageText", "sendPhoto", "sendDocument", "sendInvoice"}, name
        markup = getattr(method, "reply_markup", None)
        sent = Message(message_id=method.message_id if name == "editMessageText" else 10000 + len(self.messages), date=datetime.now(timezone.utc),
                       chat=Chat(id=method.chat_id, type="private"),
                       text=getattr(method, "text", None) or getattr(method, "caption", None) or "Invoice",
                       reply_markup=markup if isinstance(markup, InlineKeyboardMarkup) else None).as_(bot)
        self.messages.append(sent)
        return sent


@pytest.fixture(scope="module")
async def release_bot():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    transport = OfflineTelegram()
    bot = Bot("123456:offline-release-test", session=transport)
    patcher = pytest.MonkeyPatch()
    patcher.setattr(main, "async_session_factory", factory)
    patcher.setattr(main, "MessageCleanupService", lambda **kwargs: MagicMock())
    dp = await main.create_dispatcher()
    yield SimpleNamespace(factory=factory, bot=bot, dp=dp, transport=transport, ids=count(790000001), updates=count(1))
    await dp.storage.close()
    await bot.session.close()
    patcher.undo()
    await engine.dispose()


@pytest.fixture
async def actor(release_bot, monkeypatch):
    r = release_bot
    uid = next(r.ids)
    sender = TelegramUser(id=uid, is_bot=False, first_name="Release test")
    state = r.dp.fsm.get_context(bot=r.bot, chat_id=uid, user_id=uid)
    ai = SimpleNamespace(analyze_text=AsyncMock(), analyze_image=AsyncMock(), transcribe=AsyncMock(return_value="рис 150 г"))
    monkeypatch.setattr(food, "ai_client", ai)
    monkeypatch.setattr(correction, "ai_client", ai)
    monkeypatch.setattr(food, "load_product_photo", AsyncMock(return_value=None))

    async def send(text=None, **fields):
        index = next(r.updates)
        event = Message(message_id=index, date=datetime.now(timezone.utc),
                        chat=Chat(id=uid, type="private"), from_user=sender, text=text, **fields)
        await r.dp.feed_update(r.bot, Update(update_id=index, message=event))

    async def click(data):
        index = next(r.updates)
        previous = next(message for message in reversed(r.transport.messages) if message.chat.id == uid)
        event = CallbackQuery(id=str(index), chat_instance="release", from_user=sender, message=previous, data=data)
        await r.dp.feed_update(r.bot, Update(update_id=index, callback_query=event))

    async def rows(model):
        async with r.factory() as session:
            user = await UserRepository(session).get_user_by_telegram_id(uid)
            return (await session.scalars(select(model).where(model.user_id == user.id))).all()

    await send("/start")
    return SimpleNamespace(**vars(r), uid=uid, state=state, ai=ai, send=send, click=click, rows=rows,
                           last=lambda: next(message for message in reversed(r.transport.messages) if message.chat.id == uid))


async def test_today_exports_a_shareable_photo_and_original_png_without_ai_usage(actor):
    await actor.send("/today")
    button = actor.last().reply_markup.inline_keyboard[0][0]
    assert button.text == "↗ Поделиться нормой"
    await actor.click(button.callback_data)
    card = actor.last()
    download = card.reply_markup.inline_keyboard[0][0]
    photo = next(call for call in reversed(actor.transport.calls) if call.__api_method__ == "sendPhoto")
    assert photo.caption is None
    async with actor.factory() as session:
        repo = UserRepository(session)
        user = await repo.get_user_by_telegram_id(actor.uid)
        person = await repo.get_profile(user.id)
        person.daily_calorie_target = 1800
        await session.commit()
    await actor.click(download.callback_data)
    document = next(call for call in reversed(actor.transport.calls) if call.__api_method__ == "sendDocument")
    assert document.caption is None
    assert document.document.data == photo.photo.data
    assert document.document.filename == "tarelka-daily-norm.png"
    actor.ai.analyze_text.assert_not_awaited()
    actor.ai.analyze_image.assert_not_awaited()
    async with actor.factory() as session:
        assert await UserRepository(session).get_daily_usage_counts(user.id, local_today(user.timezone)) == (0, 0, 0, 0)


@pytest.mark.parametrize("state", [ProfileStates.weight, ProfileStates.height, ProfileStates.age,
                                    ProfileStates.daily_calorie_target])
async def test_profile_forms_reject_media_without_crashing(actor, state):
    await actor.state.set_state(state)
    await actor.send(photo=[{"file_id": "test", "file_unique_id": "test", "width": 100, "height": 100}])
    assert "Введите" in actor.last().text
    assert await actor.state.get_state() == state.state
    actor.ai.analyze_image.assert_not_awaited()


@pytest.mark.parametrize("state", [ProfileStates.weight, ProfileStates.target_weight,
                                    WeightTrackingStates.goal_start_weight, WeightTrackingStates.goal_target,
                                    WeightTrackingStates.reminder_time, StatisticsStates.waiting_date,
                                    CorrectionStates.waiting_text, SurveyStates.feedback])
async def test_commands_escape_open_forms(actor, state):
    for command, expected in [("/premium", "Подписка"), ("/ai", "Подписка"),
                              ("/help", "Как пользоваться"), ("/favorites", "Избранное")]:
        await actor.state.set_state(state)
        await actor.send(command)
        assert expected.lower() in actor.last().text.lower(), (state, command, actor.last().text)
    actor.ai.analyze_text.assert_not_awaited()


async def test_payment_during_form_is_not_lost_and_replay_does_not_extend_twice(actor):
    payment = {"currency": "XTR", "total_amount": 150, "invoice_payload": subscription.SUBSCRIPTION_PAYLOAD,
               "telegram_payment_charge_id": f"release:{actor.uid}", "provider_payment_charge_id": "offline"}
    for _ in range(2):
        await actor.state.set_state(ProfileStates.weight)
        await actor.send(successful_payment=payment)
    saved = await actor.rows(Payment)
    assert len(saved) == 1
    assert "активирована" in actor.last().text


async def test_full_profile_food_favorites_correction_statistics_and_weight(actor):
    await actor.click("start:begin")
    for text in ["80", "180", "30"]:
        await actor.send(text)
    await actor.click("sex:male")
    await actor.click("goal:lose")
    await actor.send("75")
    await actor.click("activity:moderate")
    assert await actor.state.get_state() is None
    assert (await actor.rows(Profile))[0].is_complete()
    assert (await actor.rows(WeightGoal))[0].target_weight_kg == 75

    for kind, result in [("text", AnalysisResult(type="meal", title="Рис", total_calories=200)),
                         ("photo", AnalysisResult(type="water", title="Вода", volume_ml=250)),
                         ("voice", AnalysisResult(type="activity", title="Ходьба", total_calories=100, duration_minutes=30))]:
        actor.ai.analyze_text.return_value = ("{}", result)
        actor.ai.analyze_image.return_value = ("{}", result)
        if kind == "text":
            await actor.send("рис 150 г")
        elif kind == "photo":
            await actor.send(photo=[{"file_id": "food", "file_unique_id": "food", "width": 100, "height": 100}])
        else:
            await actor.send(voice={"file_id": "voice", "file_unique_id": "voice", "duration": 3})
    entries = await actor.rows(DayEntry)
    assert len(entries) == 3
    meal = next(entry for entry in entries if entry.title == "Рис")
    await actor.click(f"meal_favorite:{meal.id}")
    await actor.click(f"meal_favorite:{meal.id}")
    favorites = await actor.rows(FavoriteMeal)
    assert len(favorites) == 1
    await actor.send("/favorites")
    await actor.click(f"favorite_add:{favorites[0].id}")
    assert len(await actor.rows(DayEntry)) == 4
    await actor.click(f"meal_edit:{meal.id}")
    actor.ai.analyze_text.return_value = ("{}", AnalysisResult(type="meal", title="Рис", total_calories=300))
    await actor.send("порция была больше")
    assert next(entry for entry in await actor.rows(DayEntry) if entry.id == meal.id).calories == 300
    for callback in ["stats:month", "stats:weight", "stats:day"]:
        await actor.send("/stats")
        await actor.click(callback)
    await actor.send(datetime.now().strftime("%d.%m.%Y"))
    await actor.send("/weight")
    await actor.click("ach:weigh")
    calls_before = actor.ai.analyze_text.await_count
    await actor.send("75")
    assert actor.ai.analyze_text.await_count == calls_before
    goal = (await actor.rows(WeightGoal))[0]
    assert goal.status == "completed" and goal.active_slot is None
    assert len(await actor.rows(WeightHistory)) == 2
    assert await deliver_goal_messages(actor.bot, session_factory=actor.factory) == 1
    assert await deliver_goal_messages(actor.bot, session_factory=actor.factory) == 0
    await actor.click(f"meal_delete:{meal.id}")
    assert all(entry.id != meal.id for entry in await actor.rows(DayEntry))


async def test_unknown_correction_does_not_destroy_saved_meal(actor):
    actor.ai.analyze_text.return_value = ("{}", AnalysisResult(type="meal", title="Обед", total_calories=450))
    await actor.send("обед")
    entry = (await actor.rows(DayEntry))[0]
    await actor.click(f"meal_edit:{entry.id}")
    actor.ai.analyze_text.return_value = ("{}", AnalysisResult(type="unknown"))
    await actor.send("непонятное исправление")
    saved = (await actor.rows(DayEntry))[0]
    assert saved.calories == 450 and saved.title == "Обед"
    assert await actor.state.get_state() == CorrectionStates.waiting_text.state
    async with actor.factory() as session:
        repo = UserRepository(session)
        user = await repo.get_user_by_telegram_id(actor.uid)
        assert (await repo.get_daily_usage_counts(user.id, local_today(user.timezone)))[0] == 1


async def test_all_public_menu_commands_reply_without_ai(actor):
    for command, _ in MENU_COMMANDS:
        before = len(actor.transport.messages)
        await actor.send(f"/{command}")
        assert len(actor.transport.messages) > before, command
    actor.ai.analyze_text.assert_not_awaited()


async def test_menu_does_not_write_user_activity(actor):
    from src.db.models import DailyUserActivity

    async with actor.factory() as session:
        user = await UserRepository(session).get_user_by_telegram_id(actor.uid)
        last_active = user.last_active_at
    for command in ["/profile", "/today", "/stats", "/weight", "/favorites", "/premium", "/help"]:
        await actor.send(command)
    async with actor.factory() as session:
        user = await UserRepository(session).get_user_by_telegram_id(actor.uid)
        assert user.last_active_at == last_active
        assert not (await session.scalars(
            select(DailyUserActivity).where(DailyUserActivity.user_id == user.id)
        )).all()


@pytest.mark.parametrize("kind", ["text", "photo", "voice", "transcription"])
async def test_failed_analysis_does_not_spend_request_quota(actor, kind):
    failure = httpx.ConnectError("offline failure fixture")
    actor.ai.analyze_text.side_effect = failure
    actor.ai.analyze_image.side_effect = failure
    if kind == "transcription":
        actor.ai.transcribe.side_effect = failure
    if kind == "text":
        await actor.send("рис 150 г")
    elif kind == "photo":
        await actor.send(photo=[{"file_id": "food", "file_unique_id": "food", "width": 100, "height": 100}])
    else:
        await actor.send(voice={"file_id": "voice", "file_unique_id": "voice", "duration": 3})
    async with actor.factory() as session:
        repo = UserRepository(session)
        user = await repo.get_user_by_telegram_id(actor.uid)
        assert await repo.get_daily_usage_counts(user.id, local_today(user.timezone)) == (0, 0, 0, 0)
    assert await actor.rows(DayEntry) == []
    assert "недоступ" in actor.last().text


@pytest.mark.parametrize("state", [ProfileStates.weight, ProfileStates.height, ProfileStates.daily_calorie_target])
async def test_non_finite_profile_values_are_rejected(actor, state):
    for value in ["nan", "inf", "-inf"]:
        await actor.state.set_state(state)
        await actor.send(value)
        assert await actor.state.get_state() == state.state
        assert "Введите" in actor.last().text


async def test_notifications_survey_and_account_deletion(actor):
    await actor.send("/notifications_off")
    async with actor.factory() as session:
        assert not (await UserRepository(session).get_user_by_telegram_id(actor.uid)).notifications_enabled
    await actor.send("/notifications_on")
    async with actor.factory() as session:
        assert (await UserRepository(session).get_user_by_telegram_id(actor.uid)).notifications_enabled
    await actor.send("/survey")
    await actor.click("survey:app:5")
    await actor.click("survey:photo:4")
    await actor.send("Работает удобно")
    assert await actor.state.get_state() is None
    await actor.send("/delete_me")
    await actor.click("data:delete_cancel")
    async with actor.factory() as session:
        assert await UserRepository(session).get_user_by_telegram_id(actor.uid) is not None
    await actor.send("/delete_me")
    await actor.click("data:delete_confirm")
    async with actor.factory() as session:
        assert await UserRepository(session).get_user_by_telegram_id(actor.uid) is None
    await actor.send("/start")
    assert "Заполнить профиль" in str(actor.last().reply_markup)


@pytest.mark.parametrize("valid", [True, False])
async def test_pre_checkout_has_a_valid_response_for_each_invoice(actor, valid):
    query = PreCheckoutQuery(id="offline-invoice", from_user=TelegramUser(id=actor.uid, is_bot=False, first_name="Test"),
                             currency="XTR", total_amount=150,
                             invoice_payload=subscription.SUBSCRIPTION_PAYLOAD if valid else "expired-invoice")
    await actor.dp.feed_update(actor.bot, Update(update_id=next(actor.updates), pre_checkout_query=query))
    answer = actor.transport.calls[-1]
    assert answer.__api_method__ == "answerPreCheckoutQuery"
    assert answer.ok is valid
    assert bool(answer.error_message) is (not valid)


async def test_correction_rejects_media_and_retains_the_record_after_network_failure(actor):
    actor.ai.analyze_text.return_value = ("{}", AnalysisResult(type="meal", title="Обед", total_calories=450))
    await actor.send("обед")
    entry = (await actor.rows(DayEntry))[0]
    await actor.click(f"meal_edit:{entry.id}")
    await actor.send(photo=[{"file_id": "food", "file_unique_id": "food", "width": 100, "height": 100}])
    actor.ai.analyze_image.assert_not_awaited()
    assert "текстом" in actor.last().text
    actor.ai.analyze_text.side_effect = httpx.ConnectError("offline correction failure")
    await actor.send("порция была больше")
    assert (await actor.rows(DayEntry))[0].calories == 450
    assert await actor.state.get_state() == CorrectionStates.waiting_text.state
    async with actor.factory() as session:
        repo = UserRepository(session)
        user = await repo.get_user_by_telegram_id(actor.uid)
        assert (await repo.get_daily_usage_counts(user.id, local_today(user.timezone)))[0] == 1


async def test_weekly_reminder_is_sent_once_and_opens_manual_weight_input(actor):
    now = datetime.now(timezone.utc)
    async with actor.factory() as session:
        repo = UserRepository(session)
        user = await repo.get_user_by_telegram_id(actor.uid)
        from src.shared.weight_tracking import user_zone
        await set_reminder(session, user, enabled=True, weekday=now.astimezone(user_zone(user)).weekday(), local_time="00:00")
    assert await run_weigh_reminders_iteration(actor.bot, now=now, session_factory=actor.factory) == 1
    assert await run_weigh_reminders_iteration(actor.bot, now=now, session_factory=actor.factory) == 0
    assert actor.last().text == REMINDER_TEXT
    assert [row[0].text for row in actor.last().reply_markup.inline_keyboard] == ["Записать вес", "Отключить это напоминание"]
    await actor.click("ach:weigh")
    await actor.send("78,4")
    assert (await actor.rows(WeightHistory))[0].weight_kg == 78.4
    actor.ai.analyze_text.assert_not_awaited()
    await actor.click("ach:reminder_off")
    async with actor.factory() as session:
        user = await UserRepository(session).get_user_by_telegram_id(actor.uid)
        assert not (await reminder_out(session, user))["enabled"]


async def _seed_order_favorites(actor, count=3):
    async with actor.factory() as session:
        repo = UserRepository(session)
        user = await repo.get_user_by_telegram_id(actor.uid)
        for index in range(count):
            entry = await repo.create_entry(user_id=user.id, entry_date=local_today(user.timezone),
                                            entry_type=[EntryType.MEAL, EntryType.WATER, EntryType.ACTIVITY][index % 3],
                                            title=f"Запись {index}", calories=100)
            await repo.create_favorite_from_entry(entry)
        return user.id, [item.id for item in await repo.get_favorites(user.id)]


def _order_button(actor, suffix):
    return next(button.callback_data for row in actor.last().reply_markup.inline_keyboard for button in row
                if button.callback_data.endswith(suffix))


async def _saved_order(actor, uid):
    async with actor.factory() as session:
        return [item.id for item in await UserRepository(session).get_favorites(uid)]


async def test_favorite_order_draft_cancel_save_and_stale_taps(actor):
    uid, original = await _seed_order_favorites(actor)
    await actor.send("/favorites")
    message_id = actor.last().message_id
    await actor.click("favorites_order:start")
    assert actor.last().message_id == message_id
    up = _order_button(actor, f"up:{original[1]}")
    await actor.click(up)
    data = (await actor.state.get_data())["favorite_order"]
    assert data["ids"] == [original[1], original[0], original[2]]
    assert await _saved_order(actor, uid) == original
    await actor.click(up)  # Old message version: never move twice.
    assert (await actor.state.get_data())["favorite_order"]["ids"] == data["ids"]
    await actor.click(_order_button(actor, ":cancel"))
    assert await _saved_order(actor, uid) == original
    assert (await actor.state.get_data())["favorite_order"] is None
    await actor.click("favorites_order:start")
    await actor.click(_order_button(actor, f"up:{original[1]}"))
    save = _order_button(actor, ":save")
    await actor.click(save)
    assert await _saved_order(actor, uid) == [original[1], original[0], original[2]]
    await actor.click(save)  # Closed editor cannot save again.
    assert (await actor.state.get_data())["favorite_order"] is None
    assert len(await actor.rows(DayEntry)) == 3  # Reordering never logs meals.


async def test_favorite_order_crosses_pages_and_rejects_external_changes(actor):
    uid, original = await _seed_order_favorites(actor, count=10)
    await actor.send("/favorites")
    await actor.click("favorites_order:start")
    await actor.click(_order_button(actor, ":page:1"))
    await actor.click(_order_button(actor, f"up:{original[8]}"))
    draft = (await actor.state.get_data())["favorite_order"]
    assert draft["ids"][7] == original[8]
    assert draft["page"] == 0
    assert all(len(button.callback_data.encode()) <= 64 for row in actor.last().reply_markup.inline_keyboard for button in row)
    async with actor.factory() as session:
        await UserRepository(session).reorder_favorites(uid, original[::-1], original)
    await actor.click(_order_button(actor, ":save"))
    assert await _saved_order(actor, uid) == original[::-1]
    assert (await actor.state.get_data())["favorite_order"] is None
    assert "Избранное изменилось" in actor.transport.calls[-1].text
