from aiogram import F, Router
from aiogram.filters import CommandObject, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from src.bot.config import settings
from src.bot.keyboards.menus import profile_fill_keyboard
from src.bot.handlers.subscription import show_subscription_screen
from src.bot.handlers.survey import start_survey_flow
from src.bot.services.links import (
    ACCURACY_NOTE,
    channel_welcome_note,
    normalize_acquisition_source,
    parse_referral_code,
)
from src.bot.services.messaging import answer_persistent_with_menu
from src.bot.services.message_cleanup import MessageCleanupService
from src.bot.services.request_limit import limit_welcome_note
from src.bot.states import ProfileStates
from src.db.repository import DEFAULT_DAILY_CALORIE_TARGET, UserRepository

router = Router()

WELCOME_INTRO = (
    "Привет! Я помогу считать калории, БЖУ и нутриенты, чтобы худеть, "
    "набирать вес или контролировать питание.\n"
    "Просто отправь фото, голосовое или текст для своего первого расчёта."
)

DEFAULT_TARGET_NOTE = (
    f"\n\nСтартовая норма — {DEFAULT_DAILY_CALORIE_TARGET:.0f} ккал. "
    "Можно сразу отправлять фото, голос или текст. "
    "Если заполнить профиль — норма будет точнее.\n\n"
    "Как пользоваться: /help"
)


def build_welcome_new(user) -> str:
    return (
        WELCOME_INTRO
        + limit_welcome_note(user)
        + channel_welcome_note()
        + f"\n\n{ACCURACY_NOTE}"
        + DEFAULT_TARGET_NOTE
    )


WELCOME_BACK = (
    "Снова привет! Я помогу считать калории, БЖУ и нутриенты, чтобы худеть, "
    "набирать вес или контролировать питание.\n\n"
    "Отправляйте фото, голосовое, описание блюда или активность — я обновлю дневной баланс.\n\n"
    "Как пользоваться: /help"
)
READY_TEXT = (
    "Отправь фото, голосовое или текст.\n"
    "Я сам определю, это еда или активность, и пересчитаю дневной баланс."
)


@router.message(CommandStart())
async def cmd_start(
    message: Message,
    command: CommandObject,
    state: FSMContext,
    session,
    cleanup: MessageCleanupService,
) -> None:
    await state.clear()
    repo = UserRepository(session)
    user = await repo.get_or_create_user(
        telegram_id=message.from_user.id,
        timezone=settings.default_timezone,
    )
    if command.args == "premium":
        await show_subscription_screen(message, user, cleanup)
        return

    if command.args == "survey":
        await start_survey_flow(message, state, session, cleanup)
        return

    source = normalize_acquisition_source(command.args)
    if source is not None:
        await repo.set_acquisition_source_if_empty(user, source)
    referral_code = parse_referral_code(command.args)
    if referral_code is not None:
        await repo.set_referrer_if_eligible(user, referral_code)

    profile = await repo.ensure_default_profile(user.id)
    if not profile.is_complete():
        await answer_persistent_with_menu(
            message,
            build_welcome_new(user),
            cleanup=cleanup,
            reply_markup=profile_fill_keyboard(),
        )
        return

    await answer_persistent_with_menu(
        message,
        f"{WELCOME_BACK}{limit_welcome_note(user)}{channel_welcome_note()}\n\n{ACCURACY_NOTE}\n\n{READY_TEXT}",
        cleanup=cleanup,
    )


@router.callback_query(F.data == "start:begin")
async def start_begin(
    callback: CallbackQuery,
    state: FSMContext,
    session,
    cleanup: MessageCleanupService,
) -> None:
    repo = UserRepository(session)
    user = await repo.get_or_create_user(
        telegram_id=callback.from_user.id,
        timezone=settings.default_timezone,
    )
    profile = await repo.ensure_default_profile(user.id)

    if not profile.is_complete():
        await state.set_state(ProfileStates.weight)
        try:
            await callback.message.edit_reply_markup(reply_markup=None)
        except Exception:
            pass
        await answer_persistent_with_menu(
            callback.message,
            "Шаг 1 из 6 · Вес\nВведите ваш вес в кг, например: 75",
            cleanup=cleanup,
        )
        await callback.answer()
        return

    await answer_persistent_with_menu(
        callback.message,
        READY_TEXT,
        cleanup=cleanup,
    )
    await callback.answer()
