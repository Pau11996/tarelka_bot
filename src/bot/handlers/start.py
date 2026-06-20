from aiogram import F, Router
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from src.bot.config import settings
from src.bot.keyboards.menus import main_menu, profile_fill_keyboard
from src.bot.services.links import feedback_welcome_note
from src.bot.services.messaging import answer_ephemeral, answer_persistent
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
    "🔒 Мы не храним вашу персональную информацию — только Telegram ID "
    "и данные, которые вы сами укажете в профиле.\n\n"
)

WELCOME_INTRO = (
    "Привет! Я помогу считать калории, БЖУ и нутриенты.\n\n"
    f"{ACCURACY_NOTE}"
    f"{PRIVACY_NOTE}"
    "Часть служебных сообщений удаляется автоматически в течение 5 минут, "
    "а карточки еды и активности остаются."
)

HOW_TO_USE = (
    "Как пользоваться:\n"
    "• отправьте фото еды или описание блюда — я посчитаю калории и БЖУ;\n"
    "• отправьте активность текстом или фото — я учту сожженные калории;\n"
    "• в «Сегодня» можно посмотреть дневной баланс;\n"
    "• в «Статистика» доступен график за месяц и карточка за выбранный день;\n"
    "• блюда можно добавлять в «Избранное» с карточки еды."
)


def build_welcome_new(user) -> str:
    return WELCOME_INTRO + limit_welcome_note(user) + "\n\n" + HOW_TO_USE + feedback_welcome_note()

PROFILE_PROMPT = "Заполните профиль, чтобы бот рассчитал вашу норму калорий и БЖУ."

WELCOME_BACK = (
    "Снова привет! Я помогу считать калории, БЖУ и нутриенты.\n\n"
    "Отправляйте фото еды, описание блюда или активность — я обновлю дневной баланс. "
    "В меню доступны «Сегодня», «Статистика», «Избранное» и «Профиль».\n\n"
    f"{ACCURACY_NOTE}"
    f"{PRIVACY_NOTE}"
    "Часть служебных сообщений удаляется автоматически в течение 5 минут, "
    "а карточки еды и активности остаются.\n\n"
)
READY_TEXT = (
    "Отправь фото или текст.\n"
    "Я сам определю, это еда или активность, и пересчитаю дневной баланс."
)


@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext, session, cleanup: MessageCleanupService) -> None:
    await state.clear()
    repo = UserRepository(session)
    user = await repo.get_or_create_user(
        telegram_id=message.from_user.id,
        timezone=settings.default_timezone,
    )
    profile = await repo.get_profile(user.id)
    if profile is None:
        await answer_persistent(
            message,
            build_welcome_new(user),
        )
        await answer_ephemeral(
            message,
            cleanup,
            PROFILE_PROMPT,
            reply_markup=profile_fill_keyboard(),
            track_user=False,
        )
        return

    await answer_persistent(
        message,
        f"{WELCOME_BACK}{limit_welcome_note(user)}{feedback_welcome_note()}\n\n{READY_TEXT}",
        cleanup=cleanup,
        reply_markup=main_menu(),
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
        await answer_persistent(
            callback.message,
            "Введите ваш вес в кг, например: 75",
            cleanup=cleanup,
            reply_markup=main_menu(),
        )
        await callback.answer()
        return

    await answer_persistent(
        callback.message,
        READY_TEXT,
        cleanup=cleanup,
        reply_markup=main_menu(),
    )
    await callback.answer()
