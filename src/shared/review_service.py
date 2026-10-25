"""Shared week review generation and a cross-process PostgreSQL lock."""

from contextlib import asynccontextmanager
from datetime import datetime, timezone

from sqlalchemy import text

from src.bot.services.coach import (
    MIN_LOGGED_DAYS,
    calendar_week_start,
    decide_week_action,
    digest_facts,
    load_week_digest,
    week_review_allowed,
    write_review_text,
)
from src.bot.services.diary_nudges import local_now_for_timezone


@asynccontextmanager
async def review_lock(session, user_id):
    if session.info.get("atomic_mobile"):
        if session.bind.dialect.name == "postgresql":
            await session.execute(
                text("SELECT pg_advisory_xact_lock(72421, :uid)"), {"uid": user_id}
            )
        yield
        return
    # A dedicated connection keeps this session advisory lock across repository commits.
    if session.bind.dialect.name != "postgresql":
        yield
        return
    async with session.bind.connect() as conn:
        await conn.execute(
            text("SELECT pg_advisory_lock(72421, :uid)"), {"uid": user_id}
        )
        try:
            yield
        finally:
            await conn.execute(
                text("SELECT pg_advisory_unlock(72421, :uid)"), {"uid": user_id}
            )
            await conn.commit()


async def get_week_review(repo, user, *, refresh=False, now=None, writer=None):
    now = now or datetime.now(timezone.utc)
    local = local_now_for_timezone(user.timezone, now)
    async with review_lock(repo.session, user.id):
        review = await repo.get_coach_review(user.id, calendar_week_start(local.date()))
        action = decide_week_action(
            subscribed=week_review_allowed(user),
            logged_days=MIN_LOGGED_DAYS,
            has_cache=review is not None,
            refresh=refresh,
            refresh_used=bool(review and review.refresh_used),
        )
        if action not in ("generate", "refresh"):
            return action, review
        _, digest = await load_week_digest(repo, user, now=now)
        if digest.logged_days < MIN_LOGGED_DAYS:
            return "need_data", review
        facts = digest_facts(digest)
        content = await (writer or write_review_text)(facts)
        saved = await repo.save_coach_review(
            user_id=user.id,
            week_start=digest.week_start,
            facts=facts,
            review_text=content,
            refresh_used=action == "refresh",
        )
        return action, saved
