from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from src.bot.config import settings
from src.bot.services.message_cleanup import MessageCleanupService
from src.bot.services.messaging import answer_ephemeral
from src.db.repository import UserRepository

router = Router()


def privacy_text() -> str:
    return (
        "Какие данные хранит ТАРЕЛКА\n\n"
        "• Telegram ID и технические настройки;\n"
        "• данные профиля: вес, рост, возраст, пол, цель и активность;\n"
        "• записи дневника, избранное, история веса и результаты AI-анализа;\n"
        "• расход лимита, источник первого запуска и сведения об оплатах в Stars.\n\n"
        "Фото временно передаётся сервису AI-анализа и удаляется с его диска после "
        "обработки. Для карточки еды может сохраняться Telegram file ID. Голос "
        "распознаётся локально, после чего текст отправляется на AI-анализ.\n\n"
        "Данные нужны только для работы дневника, статистики, лимитов, поддержки "
        "и улучшения сервиса. Удалить аккаунт и все связанные записи: /delete_me\n\n"
        f"Вопросы по данным: {settings.support_email}"
    )


def delete_confirmation_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Да, удалить все данные",
                    callback_data="data:delete_confirm",
                )
            ],
            [
                InlineKeyboardButton(
                    text="Отмена",
                    callback_data="data:delete_cancel",
                )
            ],
        ]
    )


@router.message(Command("privacy"))
async def show_privacy(message: Message, cleanup: MessageCleanupService) -> None:
    await answer_ephemeral(message, cleanup, privacy_text())


@router.message(Command("notifications_off"))
async def notifications_off(
    message: Message,
    session,
    cleanup: MessageCleanupService,
) -> None:
    repo = UserRepository(session)
    user = await repo.get_or_create_user(message.from_user.id, settings.default_timezone)
    await repo.set_notifications_enabled(user, False)
    await answer_ephemeral(
        message,
        cleanup,
        "Напоминания и информационные рассылки отключены. "
        "Сервисные сообщения об оплате могут приходить отдельно.\n\n"
        "Включить снова: /notifications_on",
        track_user=False,
    )


@router.message(Command("notifications_on"))
async def notifications_on(
    message: Message,
    session,
    cleanup: MessageCleanupService,
) -> None:
    repo = UserRepository(session)
    user = await repo.get_or_create_user(message.from_user.id, settings.default_timezone)
    await repo.set_notifications_enabled(user, True)
    await answer_ephemeral(
        message,
        cleanup,
        "Напоминания включены. Отключить: /notifications_off",
        track_user=False,
    )


@router.message(Command("delete_me"))
async def request_account_deletion(
    message: Message,
    cleanup: MessageCleanupService,
) -> None:
    await answer_ephemeral(
        message,
        cleanup,
        "Удалить профиль, дневник, анализы, избранное, историю веса и сведения "
        "об оплатах? Действие нельзя отменить.",
        reply_markup=delete_confirmation_keyboard(),
    )


@router.callback_query(F.data == "data:delete_cancel")
async def cancel_account_deletion(callback: CallbackQuery) -> None:
    await callback.message.edit_text("Удаление отменено.")
    await callback.answer()


@router.callback_query(F.data == "data:delete_confirm")
async def confirm_account_deletion(
    callback: CallbackQuery,
    state: FSMContext,
    session,
) -> None:
    repo = UserRepository(session)
    user = await repo.get_user_by_telegram_id(callback.from_user.id)
    if user is not None:
        await repo.delete_user(user)
    await state.clear()
    await callback.message.edit_text(
        "Все данные ТАРЕЛКИ удалены. Если захотите начать заново, отправьте /start."
    )
    await callback.answer()
