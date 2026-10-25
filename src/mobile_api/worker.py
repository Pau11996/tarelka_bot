"""Persistent jobs: diary mutation and operation completion commit atomically."""

import asyncio
import io
import logging
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.datastructures import Headers, UploadFile

from src.bot.services.coach import NOT_ENOUGH_TEXT, REFRESH_SPENT_TEXT
from src.db.models import MobileMedia, MobileOperation, User
from src.db.repository import UserRepository
from src.db.session import async_session_factory, engine
from src.mobile_api.analysis import AnalysisService, _reward_referrer
from src.mobile_api.experience import media_path, review_out
from src.shared.review_service import get_week_review

log = logging.getLogger(__name__)


class AtomicSession(AsyncSession):
    async def commit(self):
        await self.flush()


atomic_factory = async_sessionmaker(
    engine, class_=AtomicSession, expire_on_commit=False
)


async def process_one():
    now = datetime.now(timezone.utc)
    async with async_session_factory() as session:
        # A live worker holds a row lock; recovery only touches abandoned jobs.
        stale = list(
            (
                await session.scalars(
                    select(MobileOperation)
                    .where(
                        MobileOperation.status == "running",
                        MobileOperation.started_at < now - timedelta(minutes=15),
                    )
                    .with_for_update(skip_locked=True)
                )
            ).all()
        )
        for op in stale:
            op.status = "failed"
            op.error = "Обработка прервалась. Можно повторить запрос."
        job = await session.scalar(
            select(MobileOperation)
            .where(MobileOperation.status == "queued")
            .order_by(MobileOperation.created_at)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        if not job:
            await session.commit()
            return False
        job.status = "running"
        job.started_at = now
        jid = job.id
        uid = job.user_id
        await session.commit()
    try:
        async with atomic_factory() as session:
            session.info["atomic_mobile"] = True
            job = await session.scalar(
                select(MobileOperation)
                .where(MobileOperation.id == jid)
                .with_for_update()
            )
            if not job or job.status != "running":
                return True
            user = await session.get(User, uid)
            if not user:
                return True
            if job.kind == "review":
                action, review = await get_week_review(
                    UserRepository(session),
                    user,
                    refresh=job.payload.get("refresh", False),
                )
                if action == "paywall":
                    raise HTTPException(403, "Разбор недели входит в подписку")
                if action == "need_data":
                    raise HTTPException(422, NOT_ENOUGH_TEXT)
                if action == "refresh_spent":
                    raise HTTPException(409, REFRESH_SPENT_TEXT)
                result = {"review": review_out(review), "action": action}
            else:
                service = AnalysisService(session)
                if job.kind == "correct":
                    result = await service.correct(
                        user, job.payload["entry_id"], job.payload["text"]
                    )
                else:
                    media = list(
                        (
                            await session.scalars(
                                select(MobileMedia).where(
                                    MobileMedia.operation_id == job.id,
                                    MobileMedia.user_id == uid,
                                )
                            )
                        ).all()
                    )
                    images = [
                        UploadFile(
                            io.BytesIO(
                                await asyncio.to_thread(
                                    media_path(uid, m.id).read_bytes
                                )
                            ),
                            filename=m.id + "." + m.mime.split("/")[-1],
                            headers=Headers({"content-type": m.mime}),
                        )
                        for m in media
                        if m.mime.startswith("image/")
                    ]
                    voice = next(
                        (
                            m
                            for m in media
                            if m.id == job.payload.get("voice_id")
                            and m.transcript is not None
                        ),
                        None,
                    )
                    result = await service.analyze(
                        user,
                        text=job.payload["text"],
                        image=images,
                        audio=None,
                        prepaid_voice=voice is not None,
                        defer_reward=True,
                        entry_date=date.fromisoformat(job.payload["entry_date"])
                        if job.payload.get("entry_date")
                        else None,
                    )
                if result.get("entry"):
                    job.entry_id = result["entry"]["id"]
            job.result = result
            job.status = "done"
            job.error = None
            await AsyncSession.commit(session)
        if job.kind == "analyze" and result.get("status") == "saved":
            async with async_session_factory() as session:
                await _reward_referrer(UserRepository(session), uid)
    except asyncio.CancelledError:
        # Rollback above leaves no partial diary mutation. Recovery permits a retry.
        raise
    except Exception as exc:
        log.exception("Mobile operation failed: %s", jid)
        async with async_session_factory() as session:
            job = await session.get(MobileOperation, jid)
            if job and job.status == "running":
                job.status = "failed"
                detail = exc.detail if isinstance(exc, HTTPException) else None
                if isinstance(detail, dict) and detail.get("code") == "daily_limit_reached":
                    job.error = detail["message"]
                    job.result = {"limit_reached": detail}
                else:
                    job.error = str(detail) if detail is not None else "Не удалось завершить запрос. Попробуйте ещё раз."
                    job.result = None
                await session.commit()
    return True


async def run_worker():
    while True:
        try:
            worked = await process_one()
            from src.shared.notifications import process_pushes

            await process_pushes()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Mobile worker iteration failed")
            worked = False
        await asyncio.sleep(0.2 if worked else 2)
