from __future__ import annotations

from datetime import timezone

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import CallbackQuery, LabeledPrice, Message, PreCheckoutQuery

from src.bot.config import settings
from src.bot.keyboards.menus import SUBSCRIPTION_BUTTON, subscription_keyboard
from src.bot.services.links import feedback_chat_url, support_email_link
from src.bot.services.messaging import answer_ephemeral
from src.bot.services.message_cleanup import MessageCleanupService
from src.bot.services.request_limit import has_active_subscription
from src.db.repository import UserRepository

router = Router()

SUBSCRIPTION_PAYLOAD = "subscription:30d"


def format_payment_support() -> str:
    url = feedback_chat_url()
    lines = [
        "По вопросам оплаты, подписки и возвратов пишите на почту "
        f"{support_email_link()}.",
        "Отдельные вопросы поддержки и идеи по улучшению — тоже на эту почту.",
        "Telegram Support не обрабатывает покупки внутри этого бота.",
    ]
    if url:
        lines.append(f'Чат поддержки: <a href="{url}">открыть</a>.')
    return "\n".join(lines)


def format_subscription_status(user) -> str:
    if has_active_subscription(user):
        until = user.subscription_until.astimezone(timezone.utc).strftime("%d.%m.%Y")
        return (
            f"Подписка активна до {until}.\n\n"
            f"Доступно {settings.subscription_daily_request_limit} запросов в день "
            "(фото, голос, текст и исправления)."
        )
    return (
        f"Подписка не активна.\n\n"
        f"Бесплатно: {settings.daily_request_limit} запросов в день.\n"
        f"С подпиской: {settings.subscription_daily_request_limit} запросов в день "
        f"на {settings.subscription_duration_days} дней за {settings.subscription_price_stars}⭐.\n"
        "Автоматического продления нет."
    )


async def show_subscription_screen(
    message: Message,
    user,
    cleanup: MessageCleanupService,
) -> None:
    await answer_ephemeral(
        message,
        cleanup,
        format_subscription_status(user),
        reply_markup=subscription_keyboard(is_active=has_active_subscription(user)),
    )


@router.message(Command("premium"))
@router.message(F.text == SUBSCRIPTION_BUTTON)
async def show_subscription(
    message: Message,
    session,
    cleanup: MessageCleanupService,
) -> None:
    repo = UserRepository(session)
    user = await repo.get_or_create_user(
        telegram_id=message.from_user.id,
        timezone=settings.default_timezone,
    )
    await show_subscription_screen(message, user, cleanup)


@router.message(Command("paysupport"))
async def payment_support(message: Message, cleanup: MessageCleanupService) -> None:
    await answer_ephemeral(message, cleanup, format_payment_support(), track_user=False)


@router.callback_query(F.data == "sub:buy")
async def buy_subscription(callback: CallbackQuery) -> None:
    await callback.message.answer_invoice(
        title="Подписка ТАРЕЛКА",
        description=(
            f"{settings.subscription_daily_request_limit} запросов в день "
            f"на {settings.subscription_duration_days} дней"
        ),
        payload=SUBSCRIPTION_PAYLOAD,
        currency="XTR",
        prices=[
            LabeledPrice(
                label=f"Подписка на {settings.subscription_duration_days} дней",
                amount=settings.subscription_price_stars,
            )
        ],
    )
    await callback.answer()


@router.pre_checkout_query()
async def pre_checkout(pre_checkout_query: PreCheckoutQuery) -> None:
    ok = pre_checkout_query.invoice_payload == SUBSCRIPTION_PAYLOAD
    await pre_checkout_query.answer(ok=ok)


@router.message(F.successful_payment)
async def successful_payment(message: Message, session, cleanup: MessageCleanupService) -> None:
    payment = message.successful_payment
    if payment.invoice_payload != SUBSCRIPTION_PAYLOAD:
        return

    repo = UserRepository(session)
    user = await repo.get_or_create_user(
        telegram_id=message.from_user.id,
        timezone=settings.default_timezone,
    )
    user = await repo.activate_subscription(
        user,
        duration_days=settings.subscription_duration_days,
        charge_id=payment.telegram_payment_charge_id,
        stars_amount=payment.total_amount,
    )
    until = user.subscription_until.astimezone(timezone.utc).strftime("%d.%m.%Y")
    await answer_ephemeral(
        message,
        cleanup,
        f"Подписка активирована до {until}.\n\n"
        f"Теперь доступно {settings.subscription_daily_request_limit} запросов в день.",
        reply_markup=subscription_keyboard(is_active=True),
        track_user=False,
    )
