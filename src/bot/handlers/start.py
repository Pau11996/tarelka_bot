from aiogram import F, Router
from aiogram.filters import CommandObject, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from src.bot.config import settings
from src.bot.keyboards.menus import profile_fill_keyboard
from src.bot.handlers.subscription import show_subscription_screen
from src.bot.handlers.survey import start_survey_flow
from src.bot.services.links import (
    channel_welcome_note,
    feedback_welcome_note,
    normalize_acquisition_source,
    parse_referral_code,
)
from src.bot.services.messaging import answer_ephemeral, answer_persistent_with_menu
from src.bot.services.message_cleanup import MessageCleanupService
from src.bot.services.request_limit import limit_welcome_note
from src.bot.states import ProfileStates
from src.db.repository import UserRepository

router = Router()

ACCURACY_NOTE = (
    "Бот не претендует на идеальную точность расчётов — "
    "это инструмент для простого и примерного контроля калорий, БЖУ и полезных веществ.\n\n"
)

PRIVACY_NOTE = (
    "🔒 Для работы дневника хранятся Telegram ID, профиль, записи и результаты анализа. "
    "Подробнее: /privacy. Удалить все данные: /delete_me.\n\n"
)

WELCOME_INTRO = (
    "Привет! Я помогу считать калории, БЖУ и нутриенты.\n\n"
    f"{ACCURACY_NOTE}"
    f"{PRIVACY_NOTE}"
    "Часть служебных сообщений удаляется автоматически, "
    "а карточки еды и активности остаются."
)

HOW_TO_USE = (
    "Как пользоваться:\n"
    "• отправьте фото, голосовое или описание блюда — я посчитаю калории и БЖУ;\n"
    "• отправьте активность текстом, голосом или фото — я учту сожженные калории;\n"
    "• в «Сегодня» можно посмотреть дневной баланс;\n"
    "• в «Статистика» доступен график за месяц и карточка за выбранный день;\n"
    "• блюда можно добавлять в «Избранное» с карточки еды."
)


def build_welcome_new(user) -> str:
    return (
        WELCOME_INTRO
        + limit_welcome_note(user)
        + "\n\n"
        + HOW_TO_USE
        + channel_welcome_note()
        + feedback_welcome_note()
    )

PROFILE_PROMPT = (
    "Заполните короткий профиль за минуту, чтобы бот рассчитал вашу норму калорий и БЖУ."
)

WELCOME_BACK = (
    "Снова привет! Я помогу считать калории, БЖУ и нутриенты.\n\n"
    "Отправляйте фото, голосовое, описание блюда или активность — я обновлю дневной баланс. "
    "В меню доступны «Сегодня», «Статистика», «Избранное», «Профиль» и «Контакты и настройки».\n\n"
    f"{ACCURACY_NOTE}"
    f"{PRIVACY_NOTE}"
    "Часть служебных сообщений удаляется автоматически, "
    "а карточки еды и активности остаются.\n\n"
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

    profile = await repo.get_profile(user.id)
    if profile is None:
        await answer_persistent_with_menu(
            message,
            build_welcome_new(user),
            cleanup=cleanup,
        )
        await answer_ephemeral(
            message,
            cleanup,
            PROFILE_PROMPT,
            reply_markup=profile_fill_keyboard(),
            track_user=False,
        )
        return

    await answer_persistent_with_menu(
        message,
        f"{WELCOME_BACK}{limit_welcome_note(user)}{channel_welcome_note()}{feedback_welcome_note()}\n\n{READY_TEXT}",
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
    profile = await repo.get_profile(user.id)

    if profile is None:
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
