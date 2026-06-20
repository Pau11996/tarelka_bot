from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from src.bot.config import settings
from src.bot.keyboards.menus import (
    activity_keyboard,
    goal_keyboard,
    main_menu,
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

router = Router()


async def _start_profile_form(
    message: Message,
    state: FSMContext,
    cleanup: MessageCleanupService,
) -> None:
    await state.set_state(ProfileStates.weight)
    await answer_ephemeral(message, cleanup, "Введите ваш вес в кг, например: 75", track_user=False)


@router.message(Command("profile"))
@router.message(F.text == "👤 Профиль")
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
    profile = await repo.get_profile(user.id)
    if profile is None:
        await _start_profile_form(message, state, cleanup)
        schedule_user_message(cleanup, message)
        return

    await state.clear()
    await answer_ephemeral(
        message,
        cleanup,
        format_profile_card(profile),
        reply_markup=profile_card_keyboard(),
    )


@router.callback_query(F.data == "profile:edit")
async def edit_profile(callback: CallbackQuery, state: FSMContext, cleanup: MessageCleanupService) -> None:
    await state.set_state(ProfileStates.weight)
    await edit_ephemeral(
        callback,
        cleanup,
        "Редактируем профиль.\nВведите ваш вес в кг, например: 75",
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


@router.message(ProfileStates.daily_calorie_target)
async def save_daily_calorie_target(
    message: Message,
    state: FSMContext,
    session,
    cleanup: MessageCleanupService,
) -> None:
    try:
        daily_target = float(message.text.replace(",", "."))
        if daily_target < 500 or daily_target > 10000:
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
    profile = await repo.get_profile(user.id)
    if profile is None:
        await state.clear()
        await _start_profile_form(message, state, cleanup)
        schedule_user_message(cleanup, message)
        return

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
        reply_markup=profile_card_keyboard(),
        track_user=False,
    )


@router.message(ProfileStates.weight)
async def profile_weight(message: Message, state: FSMContext, cleanup: MessageCleanupService) -> None:
    try:
        weight = float(message.text.replace(",", "."))
        if weight <= 0:
            raise ValueError
    except ValueError:
        await answer_ephemeral(message, cleanup, "Введите корректный вес в кг.", track_user=False)
        schedule_user_message(cleanup, message)
        return
    schedule_user_message(cleanup, message)
    await state.update_data(weight_kg=weight)
    await state.set_state(ProfileStates.height)
    await answer_ephemeral(message, cleanup, "Введите ваш рост в см, например: 178", track_user=False)


@router.message(ProfileStates.height)
async def profile_height(message: Message, state: FSMContext, cleanup: MessageCleanupService) -> None:
    try:
        height = float(message.text.replace(",", "."))
        if height <= 0:
            raise ValueError
    except ValueError:
        await answer_ephemeral(message, cleanup, "Введите корректный рост в см.", track_user=False)
        schedule_user_message(cleanup, message)
        return
    schedule_user_message(cleanup, message)
    await state.update_data(height_cm=height)
    await state.set_state(ProfileStates.age)
    await answer_ephemeral(message, cleanup, "Введите ваш возраст, например: 30", track_user=False)


@router.message(ProfileStates.age)
async def profile_age(message: Message, state: FSMContext, cleanup: MessageCleanupService) -> None:
    try:
        age = int(message.text.strip())
        if age <= 0:
            raise ValueError
    except ValueError:
        await answer_ephemeral(message, cleanup, "Введите корректный возраст.", track_user=False)
        schedule_user_message(cleanup, message)
        return
    schedule_user_message(cleanup, message)
    await state.update_data(age=age)
    await state.set_state(ProfileStates.sex)
    await answer_ephemeral(message, cleanup, "Выберите пол:", reply_markup=sex_keyboard(), track_user=False)


@router.callback_query(ProfileStates.sex, F.data.startswith("sex:"))
async def profile_sex(callback: CallbackQuery, state: FSMContext, cleanup: MessageCleanupService) -> None:
    sex = Sex(callback.data.split(":")[1])
    await state.update_data(sex=sex.value)
    await state.set_state(ProfileStates.goal)
    await edit_ephemeral(callback, cleanup, "Выберите цель:", reply_markup=goal_keyboard())
    await callback.answer()


@router.callback_query(ProfileStates.goal, F.data.startswith("goal:"))
async def profile_goal(callback: CallbackQuery, state: FSMContext, cleanup: MessageCleanupService) -> None:
    goal = Goal(callback.data.split(":")[1])
    await state.update_data(goal=goal.value)
    await state.set_state(ProfileStates.activity_level)
    await edit_ephemeral(callback, cleanup, "Выберите уровень активности:", reply_markup=activity_keyboard())
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
    daily_target = calculate_daily_target(
        weight_kg=data["weight_kg"],
        height_cm=data["height_cm"],
        age=data["age"],
        sex=sex,
        goal=goal,
        activity_level=activity_level,
    )

    repo = UserRepository(session)
    user = await repo.get_or_create_user(
        telegram_id=callback.from_user.id,
        timezone=settings.default_timezone,
    )
    profile = await repo.upsert_profile(
        user.id,
        weight_kg=data["weight_kg"],
        height_cm=data["height_cm"],
        age=data["age"],
        sex=sex,
        goal=goal,
        activity_level=activity_level,
        daily_calorie_target=daily_target,
    )

    await state.clear()
    await edit_ephemeral(
        callback,
        cleanup,
        "Профиль сохранен.\n\n" f"{format_profile_card(profile)}",
        reply_markup=profile_card_keyboard(),
    )
    await answer_persistent(
        callback.message,
        "Можно отправлять фото еды или описание блюда.",
        cleanup=cleanup,
        reply_markup=main_menu(),
    )
    await callback.answer()
