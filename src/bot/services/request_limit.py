from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone

from aiogram.types import Message

from src.bot.config import settings
from src.bot.keyboards.menus import subscription_keyboard
from src.bot.services.links import increase_limit_hint
from src.bot.services.messaging import answer_ephemeral
from src.bot.services.message_cleanup import MessageCleanupService
from src.bot.services.nutrition import local_today
from src.db.models import User
from src.db.repository import UserRepository


class RequestKind:
    PHOTO = "photo"
    TEXT = "text"
    VOICE = "voice"


_KIND_LABEL = {
    RequestKind.PHOTO: "фото",
    RequestKind.TEXT: "текстовых запросов",
    RequestKind.VOICE: "голосовых запросов",
}


@dataclass(frozen=True)
class RequestGrant:
    source: str  # "daily" | "bonus"
    kind: str

    def __bool__(self) -> bool:
        return True


@dataclass(frozen=True)
class RequestPolicy:
    mode: str  # "shared" | "split"
    shared_limit: int | None
    photo_limit: int
    text_limit: int
    voice_limit: int

    def limit_for(self, kind: str) -> int:
        if self.mode == "shared":
            return int(self.shared_limit or 0)
        if kind == RequestKind.PHOTO:
            return self.photo_limit
        if kind == RequestKind.TEXT:
            return self.text_limit
        if kind == RequestKind.VOICE:
            return self.voice_limit
        raise ValueError(f"Unknown request kind: {kind}")


@dataclass(frozen=True)
class UsageCounts:
    total: int = 0
    photo: int = 0
    text: int = 0
    voice: int = 0


def has_active_subscription(user: User, *, now: datetime | None = None) -> bool:
    if user.subscription_until is None:
        return False
    current = now or datetime.now(timezone.utc)
    until = user.subscription_until
    if until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return until > current


def request_policy(user: User) -> RequestPolicy:
    photo_limit = (
        settings.legacy_free_photo_daily_limit
        if user.legacy_photo_quota
        else settings.free_photo_daily_limit
    )
    text_limit = settings.free_text_daily_limit
    voice_limit = settings.free_voice_daily_limit
    if user.daily_request_limit is not None:
        return RequestPolicy(
            mode="shared",
            shared_limit=user.daily_request_limit,
            photo_limit=photo_limit,
            text_limit=text_limit,
            voice_limit=voice_limit,
        )
    if has_active_subscription(user):
        photo_limit = settings.subscription_daily_request_limit
        text_limit = settings.subscription_text_daily_limit
        voice_limit = settings.subscription_voice_daily_limit
    return RequestPolicy(
        mode="split",
        shared_limit=None,
        photo_limit=photo_limit,
        text_limit=text_limit,
        voice_limit=voice_limit,
    )


def request_kind_for_input(*, has_image: bool, has_audio: bool, has_text: bool) -> str:
    if has_image:
        return RequestKind.PHOTO
    if has_audio:
        return RequestKind.VOICE
    if has_text:
        return RequestKind.TEXT
    raise ValueError("empty analysis input")


def effective_daily_request_limit(user: User) -> int:
    policy = request_policy(user)
    if policy.mode == "shared":
        return int(policy.shared_limit or 0)
    return policy.photo_limit


def _subscriber_without_override(user: User) -> bool:
    return has_active_subscription(user) and user.daily_request_limit is None


def describe_daily_limits(user: User) -> str:
    policy = request_policy(user)
    if policy.mode == "shared":
        return (
            f"{policy.shared_limit} запросов в день "
            "(фото, текст, голос и исправления)"
        )
    if _subscriber_without_override(user):
        return (
            f"{policy.photo_limit} фото, безлимит текстовых "
            f"и {policy.voice_limit} голосовых запросов в день"
        )
    return (
        f"{policy.photo_limit} фото, {policy.text_limit} текстовых "
        f"и {policy.voice_limit} голосовых запросов в день. "
        "Исправления расходуют текстовые"
    )


def format_limit_reached_message(user: User, kind: str = RequestKind.PHOTO) -> str:
    policy = request_policy(user)
    if has_active_subscription(user):
        if policy.mode == "shared":
            headline = f"Вы достигли дневного лимита запросов ({policy.shared_limit} в день)."
        elif kind == RequestKind.TEXT:
            headline = "Сработала защита от чрезмерного числа текстовых запросов."
        else:
            headline = f"Вы достигли дневного лимита {_KIND_LABEL[kind]} ({policy.limit_for(kind)} в день)."
        return (
            f"{headline}\n\nДоступ восстановится завтра по вашему часовому поясу. "
            "Подписка уже активна; её продление не сбрасывает дневные ограничения."
        )
    if policy.mode == "shared":
        limit = policy.limit_for(kind)
        return f"Вы достигли дневного лимита запросов ({limit} в день).\n\n{increase_limit_hint()}"
    limit = policy.limit_for(kind)
    label = _KIND_LABEL[kind]
    return f"Вы достигли дневного лимита {label} ({limit} в день).\n\n{increase_limit_hint()}"


def limit_welcome_note(user: User) -> str:
    bonus_requests = int(user.bonus_requests or 0)
    bonus_note = (
        f" Бонусных запросов: {bonus_requests}."
        if bonus_requests > 0
        else ""
    )
    return f"\n\nДоступно {describe_daily_limits(user)}.{bonus_note}"


def limit_status(user: User, usage: UsageCounts) -> dict:
    policy = request_policy(user)
    limits = {
        "photo": policy.limit_for(RequestKind.PHOTO),
        "text": policy.limit_for(RequestKind.TEXT),
        "voice": policy.limit_for(RequestKind.VOICE),
    }
    used = {"photo": usage.photo, "text": usage.text, "voice": usage.voice}
    if policy.mode == "shared":
        headline_limit = int(policy.shared_limit or 0)
        headline_used = usage.total
    else:
        headline_limit = policy.photo_limit
        headline_used = usage.photo
    return {
        "limit_mode": policy.mode,
        "daily_limit": headline_limit,
        "requests_used_today": headline_used,
        "limits": limits,
        "used": used,
    }


async def request_usage_payload(repo: UserRepository, user: User) -> dict:
    total, photo, text, voice = await repo.get_daily_usage_counts(user.id, local_today(user.timezone))
    return limit_status(user, UsageCounts(total=total, photo=photo, text=text, voice=voice))


async def try_consume_daily_request(
    repo: UserRepository,
    user: User,
    kind: str,
    usage_date: date | None = None,
) -> bool:
    day = usage_date or local_today(user.timezone)
    policy = request_policy(user)
    return await repo.try_consume_daily_request(
        user.id,
        day,
        kind=kind,
        limit=policy.limit_for(kind),
        shared=policy.mode == "shared",
    )


async def consume_request_grant(repo: UserRepository, user: User, kind: str) -> RequestGrant | None:
    if await try_consume_daily_request(repo, user, kind):
        return RequestGrant(source="daily", kind=kind)
    if await repo.try_consume_bonus_request(user.id):
        if (user.bonus_requests or 0) > 0:
            user.bonus_requests -= 1
        return RequestGrant(source="bonus", kind=kind)
    return None


async def ensure_request_allowed(
    message: Message,
    repo: UserRepository,
    user: User,
    cleanup: MessageCleanupService,
    *,
    kind: str,
    track_user: bool = False,
) -> RequestGrant | None:
    grant = await consume_request_grant(repo, user, kind)
    if grant is not None:
        return grant

    await answer_ephemeral(
        message,
        cleanup,
        format_limit_reached_message(user, kind),
        reply_markup=subscription_keyboard(is_active=has_active_subscription(user)),
        track_user=track_user,
    )
    return None


async def refund_request(repo: UserRepository, user: User, grant: RequestGrant) -> None:
    if grant.source == "bonus":
        await repo.refund_bonus_request(user.id)
        user.bonus_requests = int(user.bonus_requests or 0) + 1
        return
    await repo.refund_daily_request(user.id, local_today(user.timezone), kind=grant.kind)
