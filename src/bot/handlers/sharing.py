from __future__ import annotations

import asyncio
import logging

from aiogram import F, Router
from aiogram.enums import ChatType
from aiogram.types import BufferedInputFile, CallbackQuery, Message

from src.bot.config import settings
from src.bot.keyboards.menus import daily_norm_download_keyboard, daily_norm_keyboard
from src.bot.services.message_cleanup import MessageCleanupService
from src.bot.services.messaging import answer_ephemeral, answer_photo_persistent
from src.bot.services.share_cards import DOWNLOAD_PREFIX, DailyNorm, daily_norm_from_profile, render_daily_norm_png
from src.db.repository import UserRepository

router = Router()
logger = logging.getLogger(__name__)
_pending_exports: set[int] = set()


async def _export_norm(
    callback: CallbackQuery,
    session,
    cleanup: MessageCleanupService,
    *,
    snapshot: DailyNorm | None = None,
) -> None:
    message = callback.message
    if not isinstance(message, Message) or message.chat.type != ChatType.PRIVATE or message.chat.id != callback.from_user.id:
        await callback.answer("Откройте «Сегодня» в личном чате с ботом.", show_alert=True)
        return
    user_id = callback.from_user.id
    if user_id in _pending_exports:
        await callback.answer("Карточка уже готовится…")
        return
    _pending_exports.add(user_id)
    try:
        await callback.answer("Готовим карточку…")
        if snapshot is None:
            repo = UserRepository(session)
            user = await repo.get_or_create_user(user_id, settings.default_timezone)
            profile = await repo.ensure_default_profile(user.id)
            norm = daily_norm_from_profile(profile)
        else:
            norm = snapshot
        png = await asyncio.to_thread(render_daily_norm_png, norm)
        file = BufferedInputFile(png, filename="tarelka-daily-norm.png")
        if snapshot is not None:
            # Preserve the full PNG as a document. Export messages intentionally
            # bypass cleanup so the user can save or forward them later.
            await message.answer_document(document=file, disable_content_type_detection=True)
        else:
            await answer_photo_persistent(
                message,
                photo=file,
                reply_markup=daily_norm_download_keyboard(norm.download_callback()),
            )
    except Exception:
        logger.exception("Daily norm export failed")
        await answer_ephemeral(
            message,
            cleanup,
            "Не получилось подготовить картинку. Попробуйте ещё раз.",
            track_user=False,
            reply_markup=daily_norm_download_keyboard(snapshot.download_callback()) if snapshot else daily_norm_keyboard(),
        )
    finally:
        _pending_exports.discard(user_id)


@router.callback_query(F.data == "share:norm")
async def share_daily_norm(callback: CallbackQuery, session, cleanup: MessageCleanupService) -> None:
    await _export_norm(callback, session, cleanup)


@router.callback_query(F.data.startswith(DOWNLOAD_PREFIX))
async def download_daily_norm(callback: CallbackQuery, session, cleanup: MessageCleanupService) -> None:
    try:
        snapshot = DailyNorm.from_callback(callback.data or "")
    except ValueError:
        await callback.answer("Не удалось прочитать карточку. Откройте «Сегодня» и создайте её ещё раз.", show_alert=True)
        return
    await _export_norm(callback, session, cleanup, snapshot=snapshot)
