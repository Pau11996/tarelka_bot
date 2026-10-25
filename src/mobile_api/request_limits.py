"""Structured daily limits for the app; Telegram keeps its own message format."""

from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException

from src.bot.config import settings
from src.bot.services.request_limit import (
    has_active_subscription,
    limit_status,
    request_policy,
    UsageCounts,
)


async def request_limit_info(repo, user, kind, *, now=None):
    policy = request_policy(user)
    active = has_active_subscription(user)
    try:
        zone = ZoneInfo(user.timezone)
    except ZoneInfoNotFoundError:
        zone = ZoneInfo("UTC")
    current = (now or datetime.now(timezone.utc)).astimezone(zone)
    total, photo, text, voice = await repo.get_daily_usage_counts(user.id, current.date())
    usage = limit_status(user, UsageCounts(total=total, photo=photo, text=text, voice=voice))
    reset = datetime.combine(current.date() + timedelta(days=1), time.min, tzinfo=zone)
    used = usage["requests_used_today"] if policy.mode == "shared" else usage["used"][kind]
    upgrade_limit = {
        "photo": settings.subscription_daily_request_limit,
        "text": settings.subscription_text_daily_limit,
        "voice": settings.subscription_voice_daily_limit,
    }[kind]
    return dict(
        code="daily_limit_reached",
        message="Достигнут дневной лимит запросов",
        kind=kind,
        limit_mode=policy.mode,
        limit=policy.limit_for(kind),
        used=used,
        subscription_active=active,
        can_upgrade=not active and policy.mode == "split" and upgrade_limit > policy.limit_for(kind),
        upgrade_limit=upgrade_limit,
        resets_at=reset.isoformat(),
        timezone=zone.key,
        alternatives=[
            key for key in ("photo", "text", "voice")
            if policy.mode == "split" and key != kind and usage["used"][key] < usage["limits"][key]
        ],
    )


async def request_limit_error(repo, user, kind):
    return HTTPException(429, await request_limit_info(repo, user, kind))
