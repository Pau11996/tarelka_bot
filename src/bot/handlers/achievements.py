"""Telegram presentation of the same weight services used by the mobile API."""
from datetime import datetime

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from src.bot.config import settings
from src.bot.filters import form_input
from src.bot.services.message_cleanup import MessageCleanupService
from src.bot.keyboards.menus import MENU_BUTTON_TEXTS, WEIGHT_BUTTON, LEGACY_ACHIEVEMENTS_BUTTON
from src.bot.services.messaging import answer_ephemeral, answer_persistent, edit_ephemeral, schedule_user_message
from src.bot.services.weight_tracking import goal_progress_text, measurement_date, number, weight_saved_text
from src.bot.states import WeightTrackingStates
from src.db.repository import UserRepository
from src.shared.weight_tracking import (
    WeightTrackingError, achievements_payload, close_weight_goal,
    record_weight, reminder_out, set_reminder, set_weight_goal, valid_weight,
)

router = Router()
DAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"]


def keyboard(rows):
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=title, callback_data=data) for title, data in row] for row in rows
    ])


def back_keyboard():
    return keyboard([[('Отмена', 'ach:home')]])


def overview_keyboard(data):
    goal = data["goal"]
    rows = [[("Записать вес", "ach:weigh")]]
    if goal:
        rows.append([("История", "ach:history"), ("Изменить цель", "ach:goal")])
    else:
        rows.extend([[("Задать цель", "ach:goal")], [("История", "ach:history")]])
    rows.append([("Настройки", "ach:settings")])
    return keyboard(rows)


def overview_text(data):
    goal = data["goal"]
    latest = data["latest_measurement"]
    text = "⚖️ <b>Вес и цель</b>\n\n"
    if data["current_weight_kg"] is not None:
        text += f'Сейчас: <b>{number(data["current_weight_kg"])} кг</b>'
        if latest:
            text += f' · {measurement_date(latest["local_date"])}'
        text += "\n"
    else:
        text += "Вес пока не записан.\n"
    if goal:
        text += f'Цель: <b>{number(goal["target_weight_kg"])} кг</b>\n\n'
        text += goal_progress_text(goal)
    else:
        text += "Цель пока не задана. Можно просто записывать вес."
    return text


async def owner(event, session):
    return await UserRepository(session).get_or_create_user(event.from_user.id, settings.default_timezone)


async def show_overview(event, state, session, cleanup):
    await state.clear()
    user = await owner(event, session)
    data = await achievements_payload(session, user)
    if isinstance(event, CallbackQuery):
        await edit_ephemeral(event, cleanup, overview_text(data), reply_markup=overview_keyboard(data))
    else:
        await answer_ephemeral(event, cleanup, overview_text(data), reply_markup=overview_keyboard(data))


@router.message(Command("weight", "achievements"))
@router.message(F.text.in_({WEIGHT_BUTTON, LEGACY_ACHIEVEMENTS_BUTTON, "🏆 Цель и достижения"}))
async def achievements(message: Message, state: FSMContext, session, cleanup: MessageCleanupService):
    await show_overview(message, state, session, cleanup)


@router.callback_query(F.data.in_({"ach:home", "ach:continue", "ach:badges"}))
@router.callback_query(F.data.startswith("ach:complete:"))
@router.callback_query(F.data.startswith("ach:close_complete:"))
async def home(callback: CallbackQuery, state: FSMContext, session, cleanup: MessageCleanupService):
    await show_overview(callback, state, session, cleanup)
    await callback.answer()


@router.callback_query(F.data == "ach:weigh")
async def begin_weigh(callback: CallbackQuery, state: FSMContext, cleanup: MessageCleanupService):
    await state.clear()
    await state.set_state(WeightTrackingStates.weight)
    # Send a new prompt so a persistent reminder keeps its usable buttons.
    await answer_ephemeral(callback.message, cleanup, "Введите ваш вес числом в кг, например: 72,5.", track_user=False, reply_markup=back_keyboard())
    await callback.answer()


@router.message(WeightTrackingStates.weight, F.photo | F.voice)
@router.message(WeightTrackingStates.weight, F.text & ~F.text.startswith("/") & ~F.text.in_(MENU_BUTTON_TEXTS))
async def save_measurement(message: Message, state: FSMContext, session, cleanup: MessageCleanupService):
    if message.photo or message.voice:
        await answer_ephemeral(message, cleanup, "Введите вес числом в кг, например: 72,5.", reply_markup=back_keyboard())
        return
    try:
        user = await owner(message, session)
        value = valid_weight(message.text)
    except WeightTrackingError as error:
        await answer_ephemeral(message, cleanup, str(error), reply_markup=back_keyboard())
        return
    try:
        record = await record_weight(session, user, value, operation_key=f"telegram:{message.chat.id}:{message.message_id}")
    except WeightTrackingError as error:
        await session.rollback()
        await answer_ephemeral(message, cleanup, str(error), reply_markup=back_keyboard())
        return
    await state.clear()
    data = await achievements_payload(session, user)
    schedule_user_message(cleanup, message, persistent=True)
    await answer_persistent(message, weight_saved_text(record.weight_kg, data["goal"]), reply_markup=keyboard([[("Вес и цель", "ach:home")]]))


async def ask_target(message, state, user, session, cleanup):
    data = await achievements_payload(session, user)
    await state.update_data(expected_goal_id=data["goal"]["id"] if data["goal"] else None,
                            expected_weight=data["current_weight_kg"], original_goal=data["goal"])
    await state.set_state(WeightTrackingStates.goal_target)
    await answer_ephemeral(message, cleanup,
        f'Сейчас: {number(data["current_weight_kg"])} кг.\nКакой вес хотите? Введите число в кг.',
        track_user=False, reply_markup=back_keyboard())


@router.callback_query(F.data == "ach:goal")
async def begin_goal(callback: CallbackQuery, state: FSMContext, session, cleanup: MessageCleanupService):
    await state.clear()
    user = await owner(callback, session)
    data = await achievements_payload(session, user)
    if data["current_weight_kg"] is None:
        await state.set_state(WeightTrackingStates.goal_start_weight)
        await answer_ephemeral(callback.message, cleanup, "Сначала запишем текущий вес. Введите его в кг.", track_user=False, reply_markup=back_keyboard())
    else:
        await ask_target(callback.message, state, user, session, cleanup)
    await callback.answer()


@router.message(WeightTrackingStates.goal_start_weight, form_input)
async def goal_start_weight(message: Message, state: FSMContext, session, cleanup: MessageCleanupService):
    try:
        user = await owner(message, session)
        await record_weight(session, user, message.text, operation_key=f"telegram:{message.chat.id}:{message.message_id}")
    except WeightTrackingError as error:
        await session.rollback()
        await answer_ephemeral(message, cleanup, str(error), reply_markup=back_keyboard())
        return
    await state.update_data(last_input_message_id=message.message_id)
    schedule_user_message(cleanup, message)
    await ask_target(message, state, user, session, cleanup)


@router.message(WeightTrackingStates.goal_target, form_input)
async def target_weight(message: Message, state: FSMContext, cleanup: MessageCleanupService):
    data = await state.get_data()
    if data.get("last_input_message_id") == message.message_id:
        return
    try:
        target = valid_weight(message.text)
    except WeightTrackingError as error:
        await answer_ephemeral(message, cleanup, str(error), reply_markup=back_keyboard())
        return
    original = data.get("original_goal")
    unchanged = original and original["target_weight_kg"] == target
    if target == data["expected_weight"] and not unchanged:
        await answer_ephemeral(message, cleanup, "Этот вес уже достигнут. Можно продолжить учёт или указать другой желаемый вес.", reply_markup=keyboard([
            [("Продолжить учёт", "ach:home")], [("Указать другой вес", "ach:goal")],
        ]))
        return
    await state.update_data(target_weight_kg=target, last_input_message_id=message.message_id)
    await state.set_state(WeightTrackingStates.goal_confirm)
    text = f'Сейчас <b>{number(data["expected_weight"])} кг</b> → цель <b>{number(target)} кг</b>.'
    if unchanged:
        text += "\nЦель не изменилась, её старт сохраняется."
    elif data.get("expected_goal_id"):
        text += "\nПредыдущая цель останется в истории. Новая начнётся от текущего веса."
    await answer_ephemeral(message, cleanup, text, reply_markup=keyboard([
        [("Сохранить", "ach:goal_save")], [("Изменить", "ach:goal")], [("Отмена", "ach:home")],
    ]))


@router.callback_query(F.data == "ach:goal_save")
async def confirm_goal(callback: CallbackQuery, state: FSMContext, session, cleanup: MessageCleanupService):
    if await state.get_state() != WeightTrackingStates.goal_confirm.state:
        await callback.answer("Откройте цель заново: эта форма уже закрыта.", show_alert=True)
        return
    data = await state.get_data()
    user = await owner(callback, session)
    try:
        await set_weight_goal(session, user, data["target_weight_kg"], expected_goal_id=data.get("expected_goal_id"), expected_weight=data["expected_weight"])
    except WeightTrackingError as error:
        await session.rollback()
        await callback.answer(str(error), show_alert=True)
        return
    await show_overview(callback, state, session, cleanup)
    await callback.answer("Цель сохранена")


@router.callback_query(F.data.startswith("ach:cancel:"))
async def confirm_close(callback: CallbackQuery, cleanup: MessageCleanupService):
    _, action, goal_id = callback.data.split(":", 2)
    text = "Отменить цель? Измерения и история сохранятся."
    await edit_ephemeral(callback, cleanup, text, reply_markup=keyboard([
        [("Подтвердить", f"ach:close_{action}:{goal_id}")], [("Назад", "ach:home")],
    ]))
    await callback.answer()


@router.callback_query(F.data.startswith("ach:close_cancel:"))
async def close_goal(callback: CallbackQuery, state: FSMContext, session, cleanup: MessageCleanupService):
    _, action, goal_id = callback.data.split(":", 2)
    user = await owner(callback, session)
    try:
        await close_weight_goal(session, user, goal_id, complete=False)
    except WeightTrackingError as error:
        await session.rollback()
        await callback.answer(str(error), show_alert=True)
        return
    await show_overview(callback, state, session, cleanup)
    await callback.answer()


@router.callback_query(F.data == "ach:history")
async def weight_history(callback: CallbackQuery, state: FSMContext, session, cleanup: MessageCleanupService):
    await state.clear()
    data = await achievements_payload(session, await owner(callback, session))
    lines = ["⚖️ История веса · последние 20 измерений", ""]
    for row in reversed(data["weight_history"][-20:]):
        source = "Health Connect" if row["source"] == "health_connect" else "Вручную"
        lines.append(f'{datetime.fromisoformat(row["local_date"]).strftime("%d.%m.%Y")} · {number(row["weight_kg"])} кг · {source}')
    if not data["weight_history"]:
        lines.append("Измерений пока нет.")
    if data["goal_history"]:
        lines += ["", "Предыдущие цели:"]
        statuses = {"completed": "завершена", "cancelled": "отменена", "replaced": "изменена"}
        for goal in data["goal_history"][:5]:
            lines.append(f'{number(goal["start_weight_kg"])} → {number(goal["target_weight_kg"])} кг · {statuses[goal["status"]]}')
    await edit_ephemeral(callback, cleanup, "\n".join(lines), reply_markup=keyboard([[("Записать вес", "ach:weigh")], [("Вес и цель", "ach:home")]]))
    await callback.answer()


@router.callback_query(F.data == "ach:settings")
async def tracking_settings(callback: CallbackQuery, state: FSMContext, session, cleanup: MessageCleanupService):
    await state.clear()
    data = await achievements_payload(session, await owner(callback, session))
    reminder = data["reminder"]
    status = "включено" if reminder["effective_enabled"] else "приостановлено" if reminder["enabled"] else "выключено"
    text = f"⚙️ Настройки веса\n\nНапоминание раз в неделю: {status}."
    rows = [[("Напоминание о взвешивании", "ach:reminder")]]
    if data["goal"]:
        rows.append([("Отменить цель", f'ach:cancel:{data["goal"]["id"]}')])
    rows.append([("Вес и цель", "ach:home")])
    await edit_ephemeral(callback, cleanup, text, reply_markup=keyboard(rows))
    await callback.answer()


async def show_reminder(callback, state, session, cleanup):
    await state.clear()
    reminder = await reminder_out(session, await owner(callback, session))
    enabled = "Включено" if reminder["effective_enabled"] else "Выключено" if not reminder["enabled"] else "Доставка приостановлена"
    channel = {"telegram": "Telegram", "app": "телефон", "off": "выключен"}[reminder["channel"]]
    text = (f'🔔 Взвешивание раз в неделю\n\n{enabled}\n{DAYS[reminder["weekday"]]}, {reminder["local_time"]}\n'
            f'Часовой пояс: {reminder["timezone"]}\nКанал: {channel}\n\nЕсли на этой неделе уже есть измерение, напоминание пропускается.')
    if reminder["unavailable_reason"]:
        text += f'\n\n{reminder["unavailable_reason"]}'
    rows = [[("Выбрать день и время", "ach:reminder_day")], [("Выключить" if reminder["enabled"] else "Включить", "ach:reminder_off" if reminder["enabled"] else "ach:reminder_on")]]
    if reminder["channel"] != "telegram":
        rows.append([("Получать уведомления в Telegram", "ach:channel_telegram")])
    elif not reminder["delivery_ready"]:
        rows.append([("Включить общий канал уведомлений", "ach:channel_telegram")])
    rows.append([("Назад к настройкам", "ach:settings")])
    await edit_ephemeral(callback, cleanup, text, reply_markup=keyboard(rows))


@router.callback_query(F.data == "ach:reminder")
async def reminder_settings(callback: CallbackQuery, state: FSMContext, session, cleanup: MessageCleanupService):
    await show_reminder(callback, state, session, cleanup)
    await callback.answer()


@router.callback_query(F.data.in_({"ach:reminder_on", "ach:reminder_off"}))
async def toggle_reminder(callback: CallbackQuery, state: FSMContext, session, cleanup: MessageCleanupService):
    user = await owner(callback, session)
    value = await reminder_out(session, user)
    try:
        await set_reminder(session, user, enabled=callback.data.endswith("_on"), weekday=value["weekday"], local_time=value["local_time"])
    except WeightTrackingError as error:
        await callback.answer(str(error), show_alert=True)
        return
    # Do not edit/delete the persistent reminder itself.
    await answer_ephemeral(callback.message, cleanup, "Напоминание включено." if callback.data.endswith("_on") else "Напоминание о взвешивании выключено. Остальные уведомления сохранены.", track_user=False, reply_markup=keyboard([[("Настройки напоминания", "ach:reminder"), ("Вес и цель", "ach:home")]]))
    await state.clear()
    await callback.answer()


@router.callback_query(F.data == "ach:channel_telegram")
async def confirm_channel(callback: CallbackQuery, cleanup: MessageCleanupService):
    await edit_ephemeral(callback, cleanup, "Получать уведомления в Telegram? Это изменит общий канал уведомлений аккаунта.", reply_markup=keyboard([
        [("Да, получать в Telegram", "ach:channel_confirm")], [("Назад", "ach:reminder")],
    ]))
    await callback.answer()


@router.callback_query(F.data == "ach:channel_confirm")
async def set_telegram_channel(callback: CallbackQuery, state: FSMContext, session, cleanup: MessageCleanupService):
    from src.db.models import NotificationPreference
    user = await owner(callback, session)
    pref = await session.get(NotificationPreference, user.id)
    if pref:
        pref.channel = "telegram"
    else:
        session.add(NotificationPreference(user_id=user.id, channel="telegram"))
    user.notifications_enabled = True
    await session.commit()
    await show_reminder(callback, state, session, cleanup)
    await callback.answer()


@router.callback_query(F.data == "ach:reminder_day")
async def choose_reminder_day(callback: CallbackQuery, state: FSMContext, cleanup: MessageCleanupService):
    await state.clear()
    await edit_ephemeral(callback, cleanup, "В какой день напоминать о взвешивании?", reply_markup=keyboard(
        [[(day, f"ach:day:{index}")] for index, day in enumerate(DAYS)] + [[("Назад", "ach:reminder")]]))
    await callback.answer()


@router.callback_query(F.data.startswith("ach:day:"))
async def choose_reminder_time(callback: CallbackQuery, state: FSMContext, cleanup: MessageCleanupService):
    value = callback.data.split(":")[-1]
    if value not in {str(index) for index in range(7)}:
        await callback.answer("Выберите день из списка.", show_alert=True)
        return
    await state.update_data(reminder_weekday=int(value))
    await state.set_state(WeightTrackingStates.reminder_time)
    await edit_ephemeral(callback, cleanup, f"{DAYS[int(value)]}. Введите время в формате ЧЧ:ММ, например 09:00. Используем часовой пояс аккаунта.", reply_markup=keyboard([[("Назад к дням", "ach:reminder_day")], [("Отмена", "ach:reminder")]]))
    await callback.answer()


@router.message(WeightTrackingStates.reminder_time, form_input)
async def save_reminder_time(message: Message, state: FSMContext, session, cleanup: MessageCleanupService):
    user = await owner(message, session)
    data = await state.get_data()
    pref = await reminder_out(session, user)
    try:
        await set_reminder(session, user, enabled=pref["enabled"], weekday=data["reminder_weekday"], local_time=(message.text or "").strip())
    except WeightTrackingError as error:
        await answer_ephemeral(message, cleanup, str(error), reply_markup=keyboard([[("Отмена", "ach:reminder")]]))
        return
    await state.clear()
    await answer_ephemeral(message, cleanup, "Расписание сохранено. Включение напоминания настраивается отдельно.", reply_markup=keyboard([[("Настройки напоминания", "ach:reminder")]]))
