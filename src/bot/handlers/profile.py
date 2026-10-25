import math

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message, ReplyKeyboardRemove, InlineKeyboardButton, InlineKeyboardMarkup

from src.bot.config import settings
from src.bot.filters import form_input
from src.bot.keyboards.menus import (
    PROFILE_BUTTON,
    activity_keyboard,
    goal_keyboard,
    profile_card_keyboard,
    sex_keyboard,
)
from src.bot.services.formatting import format_profile_card
from src.bot.services.messaging import (
    answer_ephemeral,
    answer_persistent,
    edit_ephemeral,
    schedule_user_message,
)
from src.bot.services.message_cleanup import MessageCleanupService
from src.bot.services.nutrition import calculate_daily_target
from src.bot.states import ProfileStates
from src.db.models import ActivityLevel, Goal, Sex
from src.db.repository import UserRepository
from src.shared.weight_tracking import (
    DIRECTION_LABELS, WeightTrackingError, active_goal, direction_for,
    record_weight, set_weight_goal, valid_weight,
)

router = Router()


async def profile_step(state, number, title):
    total = 7 if (await state.get_data()).get("initial_setup") else 6
    return f"Шаг {number} из {total} · {title}\n"


@router.message(Command("profile"))
@router.message(F.text == PROFILE_BUTTON)
async def show_or_create_profile(
    message: Message,
    state: FSMContext,
    session,
    cleanup: MessageCleanupService,
) -> None:
    repo = UserRepository(session)
    user = await repo.get_or_create_user(
        telegram_id=message.from_user.id,
        timezone=settings.default_timezone,
    )
    profile = await repo.ensure_default_profile(user.id)

    await state.clear()
    await answer_ephemeral(
        message,
        cleanup,
        format_profile_card(profile),
        reply_markup=profile_card_keyboard(is_complete=profile.is_complete()),
    )


@router.callback_query(F.data == "profile:edit")
async def edit_profile(callback: CallbackQuery, state: FSMContext, session, cleanup: MessageCleanupService) -> None:
    repo = UserRepository(session)
    user = await repo.get_or_create_user(callback.from_user.id, settings.default_timezone)
    profile = await repo.ensure_default_profile(user.id)
    await state.clear()
    await state.update_data(initial_setup=not profile.is_complete())
    await state.set_state(ProfileStates.weight)
    await edit_ephemeral(
        callback,
        cleanup,
        "Редактируем профиль.\n\n" + await profile_step(state, 1, "Вес") + "Введите ваш вес в кг, например: 75",
    )
    await callback.answer()


@router.callback_query(F.data == "profile:edit_calories")
async def edit_daily_calorie_target(
    callback: CallbackQuery,
    state: FSMContext,
    cleanup: MessageCleanupService,
) -> None:
    await state.set_state(ProfileStates.daily_calorie_target)
    await edit_ephemeral(
        callback,
        cleanup,
        "Введите новую дневную норму калорий, например: 2200",
    )
    await callback.answer()


@router.callback_query(F.data == "profile:edit_weight")
async def edit_weight(
    callback: CallbackQuery,
    state: FSMContext,
    cleanup: MessageCleanupService,
) -> None:
    from src.bot.handlers.achievements import begin_weigh

    await begin_weigh(callback, state, cleanup)


@router.message(ProfileStates.edit_weight, form_input)
async def save_weight(
    message: Message,
    state: FSMContext,
    session,
    cleanup: MessageCleanupService,
) -> None:
    try:
        weight = valid_weight(message.text)
    except WeightTrackingError:
        await answer_ephemeral(message, cleanup, "Введите корректный вес в кг.", track_user=False)
        schedule_user_message(cleanup, message)
        return

    repo = UserRepository(session)
    user = await repo.get_or_create_user(
        telegram_id=message.from_user.id,
        timezone=settings.default_timezone,
    )
    profile = await repo.ensure_default_profile(user.id)

    try:
        await record_weight(session, user, weight, operation_key=f"telegram:{message.chat.id}:{message.message_id}")
    except WeightTrackingError as error:
        await session.rollback()
        await answer_ephemeral(message, cleanup, str(error), track_user=False)
        return
    profile = await repo.get_profile(user.id)

    await state.clear()
    schedule_user_message(cleanup, message)
    await answer_ephemeral(
        message,
        cleanup,
        "Вес обновлен.\n\n" f"{format_profile_card(profile)}",
        reply_markup=profile_card_keyboard(is_complete=profile.is_complete()),
        track_user=False,
    )


@router.message(ProfileStates.daily_calorie_target, form_input)
async def save_daily_calorie_target(
    message: Message,
    state: FSMContext,
    session,
    cleanup: MessageCleanupService,
) -> None:
    try:
        daily_target = float((message.text or "").replace(",", "."))
        if not math.isfinite(daily_target) or daily_target < 500 or daily_target > 10000:
            raise ValueError
    except ValueError:
        await answer_ephemeral(
            message,
            cleanup,
            "Введите корректную дневную норму калорий числом, например: 2200.",
            track_user=False,
        )
        schedule_user_message(cleanup, message)
        return

    repo = UserRepository(session)
    user = await repo.get_or_create_user(
        telegram_id=message.from_user.id,
        timezone=settings.default_timezone,
    )
    profile = await repo.ensure_default_profile(user.id)

    profile = await repo.upsert_profile(
        user.id,
        weight_kg=profile.weight_kg,
        height_cm=profile.height_cm,
        age=profile.age,
        sex=profile.sex,
        goal=profile.goal,
        activity_level=profile.activity_level,
        daily_calorie_target=daily_target,
    )

    await state.clear()
    schedule_user_message(cleanup, message)
    await answer_ephemeral(
        message,
        cleanup,
        "Дневная норма обновлена.\n\n" f"{format_profile_card(profile)}",
        reply_markup=profile_card_keyboard(is_complete=profile.is_complete()),
        track_user=False,
    )


@router.message(ProfileStates.weight, form_input)
async def profile_weight(message: Message, state: FSMContext, cleanup: MessageCleanupService) -> None:
    try:
        weight = valid_weight(message.text)
    except WeightTrackingError:
        await answer_ephemeral(message, cleanup, "Введите корректный вес в кг.", track_user=False)
        schedule_user_message(cleanup, message)
        return
    schedule_user_message(cleanup, message)
    await state.update_data(weight_kg=weight)
    await state.set_state(ProfileStates.height)
    await answer_ephemeral(
        message,
        cleanup,
        await profile_step(state, 2, "Рост") + "Введите ваш рост в см, например: 178",
        track_user=False,
    )


@router.message(ProfileStates.height, form_input)
async def profile_height(message: Message, state: FSMContext, cleanup: MessageCleanupService) -> None:
    try:
        height = float((message.text or "").replace(",", "."))
        if not math.isfinite(height) or height <= 0:
            raise ValueError
    except ValueError:
        await answer_ephemeral(message, cleanup, "Введите корректный рост в см.", track_user=False)
        schedule_user_message(cleanup, message)
        return
    schedule_user_message(cleanup, message)
    await state.update_data(height_cm=height)
    await state.set_state(ProfileStates.age)
    await answer_ephemeral(
        message,
        cleanup,
        await profile_step(state, 3, "Возраст") + "Введите ваш возраст, например: 30",
        track_user=False,
    )


@router.message(ProfileStates.age, form_input)
async def profile_age(message: Message, state: FSMContext, cleanup: MessageCleanupService) -> None:
    try:
        age = int((message.text or "").strip())
        if age <= 0:
            raise ValueError
    except ValueError:
        await answer_ephemeral(message, cleanup, "Введите корректный возраст.", track_user=False)
        schedule_user_message(cleanup, message)
        return
    schedule_user_message(cleanup, message)
    await state.update_data(age=age)
    await state.set_state(ProfileStates.sex)
    await answer_ephemeral(
        message,
        cleanup,
        await profile_step(state, 4, "Пол") + "Выберите вариант:",
        reply_markup=sex_keyboard(),
        track_user=False,
    )


@router.callback_query(ProfileStates.sex, F.data.startswith("sex:"))
async def profile_sex(callback: CallbackQuery, state: FSMContext, cleanup: MessageCleanupService) -> None:
    sex = Sex(callback.data.split(":")[1])
    await state.update_data(sex=sex.value)
    await state.set_state(ProfileStates.goal)
    await edit_ephemeral(
        callback,
        cleanup,
        await profile_step(state, 5, "Цель") + "Выберите основную цель:",
        reply_markup=goal_keyboard(),
    )
    await callback.answer()


@router.callback_query(ProfileStates.goal, F.data.startswith("goal:"))
async def profile_goal(callback: CallbackQuery, state: FSMContext, session, cleanup: MessageCleanupService) -> None:
    goal = Goal(callback.data.split(":")[1])
    user = await UserRepository(session).get_or_create_user(callback.from_user.id, settings.default_timezone)
    weight_goal = await active_goal(session, user.id)
    if weight_goal and goal.value != weight_goal.direction:
        await state.clear()
        await edit_ephemeral(callback, cleanup, "Направление связано с вашей целью по весу. Измените её в разделе «Вес и цель». Норма калорий останется прежней.", reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="Изменить цель по весу", callback_data="ach:goal")],
            [InlineKeyboardButton(text="Вес и цель", callback_data="ach:home")],
        ]))
        await callback.answer()
        return
    await state.update_data(goal=goal.value)
    if (await state.get_data()).get("initial_setup"):
        await state.set_state(ProfileStates.target_weight)
        await edit_ephemeral(callback, cleanup, "Шаг 6 из 7 · Желаемый вес — необязательно\nВведите желаемый вес в кг или пропустите этот шаг.", reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="Пропустить", callback_data="profile:skip_target_weight")],
        ]))
        await callback.answer()
        return
    await state.set_state(ProfileStates.activity_level)
    await edit_ephemeral(
        callback,
        cleanup,
        "Шаг 6 из 6 · Активность\nВыберите обычный уровень активности:",
        reply_markup=activity_keyboard(),
    )
    await callback.answer()


@router.message(ProfileStates.target_weight, form_input)
async def profile_target_weight(message: Message, state: FSMContext, cleanup: MessageCleanupService):
    try:
        value = valid_weight(message.text)
    except WeightTrackingError as error:
        await answer_ephemeral(message, cleanup, str(error), reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="Пропустить", callback_data="profile:skip_target_weight")],
        ]))
        return
    data = await state.get_data()
    if value == data["weight_kg"]:
        await answer_ephemeral(message, cleanup,
            "Этот вес уже достигнут. Укажите другой желаемый вес или продолжите заполнение профиля без цели.",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
                InlineKeyboardButton(text="Продолжить без цели", callback_data="profile:skip_target_weight"),
            ]]))
        return
    direction = direction_for(data["weight_kg"], value)
    await state.update_data(target_weight_kg=value, goal=direction)
    await state.set_state(ProfileStates.activity_level)
    await answer_ephemeral(message, cleanup,
        f"Цель: {DIRECTION_LABELS[direction]} · {value:g} кг.\n\nШаг 7 из 7 · Активность\nВыберите обычный уровень активности, чтобы сохранить анкету и рассчитать норму:",
        reply_markup=activity_keyboard())


@router.callback_query(ProfileStates.target_weight, F.data == "profile:skip_target_weight")
async def skip_profile_target(callback: CallbackQuery, state: FSMContext, cleanup: MessageCleanupService):
    await state.update_data(target_weight_kg=None)
    await state.set_state(ProfileStates.activity_level)
    await edit_ephemeral(callback, cleanup, "Шаг 7 из 7 · Активность\nВыберите обычный уровень активности:", reply_markup=activity_keyboard())
    await callback.answer()


@router.callback_query(ProfileStates.activity_level, F.data.startswith("activity:"))
async def profile_activity(
    callback: CallbackQuery,
    state: FSMContext,
    session,
    cleanup: MessageCleanupService,
) -> None:
    activity_level = ActivityLevel(callback.data.split(":")[1])
    data = await state.get_data()
    sex = Sex(data["sex"])
    goal = Goal(data["goal"])

    repo = UserRepository(session)
    user = await repo.get_or_create_user(
        telegram_id=callback.from_user.id,
        timezone=settings.default_timezone,
    )
    current_profile = await repo.get_profile(user.id)
    was_complete = current_profile is not None and current_profile.is_complete()
    daily_target = (
        current_profile.daily_calorie_target
        if was_complete
        else calculate_daily_target(
            weight_kg=data["weight_kg"],
            height_cm=data["height_cm"],
            age=data["age"],
            sex=sex,
            goal=goal,
            activity_level=activity_level,
        )
    )
    fields = dict(
        weight_kg=data["weight_kg"],
        height_cm=data["height_cm"],
        age=data["age"],
        sex=sex,
        goal=goal,
        activity_level=activity_level,
        daily_calorie_target=daily_target,
    )
    try:
        if data.get("target_weight_kg") is not None and not was_complete:
            profile = await repo.upsert_profile(user.id, commit=False, **fields)
            previous = await active_goal(session, user.id)
            await set_weight_goal(session, user, data["target_weight_kg"], expected_goal_id=previous.id if previous else None,
                                  start_weight=data["weight_kg"], commit=False)
            await session.commit()
        else:
            profile = await repo.upsert_profile(user.id, **fields)
    except WeightTrackingError as error:
        await session.rollback()
        await callback.answer(str(error), show_alert=True)
        return

    await state.clear()
    await edit_ephemeral(
        callback,
        cleanup,
        "Профиль сохранен.\n\n" f"{format_profile_card(profile)}",
        reply_markup=profile_card_keyboard(is_complete=True),
    )
    await answer_persistent(
        callback.message,
        "Готово. Отправьте первое фото еды — бот примерно оценит калории и БЖУ "
        "и покажет остаток на день. Также можно использовать голос или текст.",
        cleanup=cleanup,
        reply_markup=ReplyKeyboardRemove(),
    )
    await callback.answer()
