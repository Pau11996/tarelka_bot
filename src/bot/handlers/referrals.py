from __future__ import annotations

from urllib.parse import quote

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message

from src.bot.config import settings
from src.bot.keyboards.menus import LEGACY_INVITE_BUTTON
from src.bot.services.links import referral_url
from src.bot.services.message_cleanup import MessageCleanupService
from src.bot.services.messaging import answer_ephemeral
from src.db.repository import UserRepository

router = Router()


def invite_keyboard(url: str) -> InlineKeyboardMarkup:
    share_text = (
        "Я веду дневник питания в Telegram: фото еды превращается "
        "в примерный расчёт калорий и БЖУ."
    )
    share_url = (
        "https://t.me/share/url"
        f"?url={quote(url, safe='')}"
        f"&text={quote(share_text, safe='')}"
    )
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Поделиться приглашением", url=share_url)]
        ]
    )


@router.message(Command("invite"))
@router.message(F.text == LEGACY_INVITE_BUTTON)
async def show_invite(
    message: Message,
    session,
    cleanup: MessageCleanupService,
) -> None:
    repo = UserRepository(session)
    user = await repo.get_or_create_user(message.from_user.id, settings.default_timezone)
    code = await repo.ensure_referral_code(user)
    url = referral_url(code)
    if url is None:
        await answer_ephemeral(
            message,
            cleanup,
            "Приглашения временно недоступны: username бота не настроен.",
        )
        return

    await answer_ephemeral(
        message,
        cleanup,
        "Пригласите друга в ТАРЕЛКУ.\n\n"
        "Когда он заполнит профиль и отправит первый AI-анализ, "
        f"вы получите {settings.referral_bonus_requests} бонусных запроса.\n"
        f"Сейчас бонусных запросов: {int(user.bonus_requests or 0)}.\n\n"
        f"{url}",
        reply_markup=invite_keyboard(url),
    )
