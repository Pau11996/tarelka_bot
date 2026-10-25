from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.bot.services.ai_client import AIAnalyzerClient
from src.bot.services.coach import (
    calendar_week_start,
    rolling_week,
)
from src.bot.services.nutrition import local_today
from src.bot.services.request_limit import has_active_subscription
from src.db.models import (
    CoachReview,
    DayEntry,
    MobileMedia,
    MobileOperation,
    NotificationPreference,
    PushDevice,
    User,
)
from src.db.repository import UserRepository
from src.db.session import get_session
from src.mobile_api.deps import get_current_user
from src.mobile_api.serializers import entry_out
from src.mobile_api.request_limits import request_limit_error
from src.shared.weight_tracking import goal_chat_messages

router = APIRouter()
logger = logging.getLogger(__name__)
MEDIA_ROOT = Path(os.environ.get("MOBILE_MEDIA_DIR", "/tmp/tarelka-media"))
MAX_FILE = 10 * 1024 * 1024


def media_path(user_id, media_id):
    return MEDIA_ROOT / str(user_id) / media_id


def operation_out(op):
    return dict(
        id=op.id,
        kind=op.kind,
        status=op.status,
        text=op.payload.get("text", ""),
        created_at=op.created_at.isoformat(),
        entry_id=op.entry_id,
        result=op.result,
        error=op.error,
        limit_reached=(op.result or {}).get("limit_reached") if op.status == "failed" else None,
        request_key=op.request_key,
    )


def review_out(review):
    return dict(
        id=review.id,
        week_start=review.week_start.isoformat(),
        facts=review.facts,
        text=review.review_text,
        refresh_used=review.refresh_used,
        created_at=review.created_at.isoformat(),
    )


async def save_media(session, user, upload, operation_id=None):
    mime = upload.content_type or ""
    if mime not in {
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/heic",
        "image/heif",
        "audio/mp4",
        "audio/m4a",
        "audio/x-m4a",
        "audio/mpeg",
        "audio/wav",
        "audio/x-wav",
        "audio/ogg",
        "audio/webm",
    }:
        raise HTTPException(415, "Нужны фото или аудиозапись")
    content = await upload.read(MAX_FILE + 1)
    if not content or len(content) > MAX_FILE:
        raise HTTPException(413, "Размер файла должен быть от 1 байта до 10 МБ")
    mid = str(uuid4())
    path = media_path(user.id, mid)
    path.parent.mkdir(parents=True, exist_ok=True)
    await asyncio.to_thread(path.write_bytes, content)
    media = MobileMedia(
        id=mid, user_id=user.id, operation_id=operation_id, mime=mime, size=len(content)
    )
    session.add(media)
    return media, content


@router.get("/media/{media_id}")
async def read_media(
    media_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    media = await session.get(MobileMedia, media_id)
    if not media or media.user_id != user.id:
        raise HTTPException(404, "Вложение не найдено")
    path = media_path(user.id, media.id)
    if not path.is_file():
        raise HTTPException(404, "Вложение недоступно")
    return FileResponse(
        path,
        media_type=media.mime,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/voice/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    # Reserve the voice quota at transcription; the saved voice draft is consumed once.
    from src.bot.services.request_limit import (
        RequestKind,
        consume_request_grant,
        refund_request,
    )

    repo = UserRepository(session)
    user_id = user.id
    grant = await consume_request_grant(repo, user, RequestKind.VOICE)
    if grant is None:
        raise await request_limit_error(repo, user, RequestKind.VOICE)
    media = None
    try:
        media, content = await save_media(session, user, audio)
        if not media.mime.startswith("audio/"):
            raise HTTPException(415, "Нужна аудиозапись")
        transcript = await AIAnalyzerClient().transcribe(
            audio_bytes=content, filename=audio.filename or "voice.m4a"
        )
        if not transcript.strip():
            raise HTTPException(422, "Речь не распознана. Попробуйте ещё раз.")
        media.transcript = transcript
        await session.commit()
        return {"transcript": transcript, "media_id": media.id}
    except Exception:
        await session.rollback()
        if media:
            media_path(user_id, media.id).unlink(missing_ok=True)
        await session.refresh(user)
        await refund_request(repo, user, grant)
        raise


@router.post("/operations", status_code=202)
async def enqueue(
    request_key: str = Form(..., min_length=8, max_length=100),
    text: str = Form("", max_length=2000),
    image: list[UploadFile] | None = File(None),
    voice_id: str | None = Form(None),
    entry_id: int | None = Form(None),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    user_id = user.id
    existing = await session.scalar(
        select(MobileOperation).where(
            MobileOperation.user_id == user_id,
            MobileOperation.request_key == request_key,
        )
    )
    if existing:
        if existing.kind not in ("analyze", "correct"):
            raise HTTPException(409, "Этот идентификатор принадлежит другому запросу")
        return operation_out(existing)
    if len(image or []) > 10:
        raise HTTPException(422, "Можно приложить до 10 фото")
    if not text.strip() and not image and not voice_id:
        raise HTTPException(422, "Добавьте сообщение или фото")
    if entry_id is not None and not await UserRepository(session).get_entry(
        entry_id, user.id
    ):
        raise HTTPException(404, "Запись не найдена")
    if voice_id and (image or entry_id is not None):
        raise HTTPException(
            422, "Отправьте голосовую запись отдельно от фото и исправлений"
        )
    media = None
    if voice_id:
        media = await session.scalar(
            select(MobileMedia)
            .where(MobileMedia.id == voice_id, MobileMedia.user_id == user.id)
            .with_for_update()
        )
        replay = await session.scalar(
            select(MobileOperation).where(
                MobileOperation.user_id == user_id,
                MobileOperation.request_key == request_key,
            )
        )
        if replay:
            return operation_out(replay)
        if not media or media.transcript is None or media.operation_id:
            raise HTTPException(409, "Голосовая запись уже отправлена или недоступна")
    op = MobileOperation(
        id=str(uuid4()),
        user_id=user.id,
        request_key=request_key,
        kind="correct" if entry_id else "analyze",
        status="queued",
        payload={
            "text": text.strip() or (media.transcript if media else ""),
            "voice_id": voice_id,
            "entry_id": entry_id,
            "entry_date": local_today(user.timezone).isoformat(),
        },
    )
    session.add(op)
    files = []
    try:
        await session.flush()
        if media:
            media.operation_id = op.id
        for upload in image or []:
            saved, _ = await save_media(session, user, upload, op.id)
            files.append(saved.id)
        await session.commit()
        await session.refresh(op)
    except IntegrityError:
        await session.rollback()
        for mid in files:
            media_path(user_id, mid).unlink(missing_ok=True)
        existing = await session.scalar(
            select(MobileOperation).where(
                MobileOperation.user_id == user_id,
                MobileOperation.request_key == request_key,
            )
        )
        if existing:
            return operation_out(existing)
        raise
    except Exception:
        await session.rollback()
        for mid in files:
            media_path(user_id, mid).unlink(missing_ok=True)
        raise
    return operation_out(op)


@router.get("/operations/{operation_id}")
async def operation(
    operation_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    op = await session.get(MobileOperation, operation_id)
    if not op or op.user_id != user.id:
        raise HTTPException(404, "Запрос не найден")
    if op.kind == "review" and not has_active_subscription(user):
        raise HTTPException(403, "Разбор недели входит в подписку")
    return operation_out(op)


@router.post("/operations/{operation_id}/retry", status_code=202)
async def retry_operation(
    operation_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    op = await session.scalar(
        select(MobileOperation)
        .where(MobileOperation.id == operation_id, MobileOperation.user_id == user.id)
        .with_for_update()
    )
    if not op:
        raise HTTPException(404, "Запрос не найден")
    if op.kind == "review" and not has_active_subscription(user):
        raise HTTPException(403, "Разбор недели входит в подписку")
    if op.status == "failed":
        op.status = "queued"
        op.error = None
        op.result = None
        op.started_at = None
    await session.commit()
    return operation_out(op)


@router.get("/chat")
async def chat(
    before: int | None = None,
    limit: int = Query(30, ge=1, le=60),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    query = select(DayEntry).where(DayEntry.user_id == user.id)
    if before:
        query = query.where(DayEntry.id < before)
    entries = list(
        (
            await session.scalars(query.order_by(DayEntry.id.desc()).limit(limit + 1))
        ).all()
    )
    more = len(entries) > limit
    entries = entries[:limit]
    ids = [e.id for e in entries]
    favorite_ids = await UserRepository(session).get_favorite_ids_for_entries(user.id, ids)
    operations = list(
        (
            await session.scalars(
                select(MobileOperation)
                .where(
                    MobileOperation.user_id == user.id,
                    MobileOperation.kind != "review",
                    or_(
                        MobileOperation.entry_id.in_(ids),
                        MobileOperation.status.in_(["queued", "running", "failed"]),
                        (
                            (MobileOperation.entry_id.is_(None))
                            & MobileOperation.result.is_not(None)
                        ),
                    ),
                )
                .order_by(MobileOperation.created_at.desc())
                .limit(100)
            )
        ).all()
    )
    media = list(
        (
            await session.scalars(
                select(MobileMedia).where(
                    MobileMedia.user_id == user.id,
                    MobileMedia.operation_id.in_([o.id for o in operations]),
                )
            )
        ).all()
    )
    return dict(
        notices=await goal_chat_messages(session, user),
        entries=[entry_out(e, favorite_id=favorite_ids.get(e.id)) for e in reversed(entries)],
        operations=[operation_out(o) for o in reversed(operations)],
        media=[
            dict(
                id=m.id,
                operation_id=m.operation_id,
                mime=m.mime,
                url=f"/v1/media/{m.id}",
            )
            for m in media
        ],
        next_before=entries[-1].id if more else None,
    )


@router.get("/chat/notices")
async def chat_notices(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return {"notices": await goal_chat_messages(session, user)}


@router.get("/coach/reviews")
async def reviews(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    before: int | None = None,
):
    if not has_active_subscription(user):
        raise HTTPException(403, "Разбор недели входит в подписку")
    query = select(CoachReview).where(CoachReview.user_id == user.id)
    if before:
        query = query.where(CoachReview.id < before)
    saved = list(
        (await session.scalars(query.order_by(CoachReview.id.desc()).limit(21))).all()
    )
    current = local_today(user.timezone)
    start, end = rolling_week(current)
    jobs = list(
        (
            await session.scalars(
                select(MobileOperation)
                .where(
                    MobileOperation.user_id == user.id,
                    MobileOperation.kind == "review",
                    MobileOperation.status.in_(["queued", "running"]),
                )
                .order_by(MobileOperation.created_at.desc())
                .limit(1)
            )
        ).all()
    )
    return dict(
        reviews=[review_out(r) for r in saved[:20]],
        next_before=saved[19].id if len(saved) > 20 else None,
        week_start=calendar_week_start(current).isoformat(),
        period_start=start.isoformat(),
        period_end=end.isoformat(),
        operation=operation_out(jobs[0]) if jobs else None,
    )


class ReviewRequest(BaseModel):
    request_key: str = Field(min_length=8, max_length=100)
    refresh: bool = False


@router.post("/coach/reviews", status_code=202)
async def create_review(
    body: ReviewRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    if not has_active_subscription(user):
        raise HTTPException(403, "Разбор недели входит в подписку")
    # Lock the user while accepting a job, across all API workers.
    await session.execute(select(User).where(User.id == user.id).with_for_update())
    op = await session.scalar(
        select(MobileOperation)
        .where(
            MobileOperation.user_id == user.id,
            or_(
                MobileOperation.request_key == body.request_key,
                (
                    (MobileOperation.kind == "review")
                    & MobileOperation.status.in_(["queued", "running"])
                ),
            ),
        )
        .order_by(MobileOperation.created_at.desc())
        .limit(1)
    )
    if op:
        return operation_out(op)
    op = MobileOperation(
        id=str(uuid4()),
        user_id=user.id,
        kind="review",
        request_key=body.request_key,
        status="queued",
        payload={"refresh": body.refresh},
    )
    session.add(op)
    await session.commit()
    await session.refresh(op)
    return operation_out(op)


class DeviceRequest(BaseModel):
    token: str = Field(
        pattern=r"^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$", max_length=255
    )
    platform: Literal["ios", "android"]


@router.post("/devices")
async def register_device(
    body: DeviceRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    device = await session.get(PushDevice, body.token)
    if device:
        device.user_id = user.id
        device.enabled = True
        device.platform = body.platform
    else:
        session.add(
            PushDevice(
                token=body.token, user_id=user.id, platform=body.platform, enabled=True
            )
        )
    await session.commit()
    return {"registered": True}


@router.post("/devices/unregister")
async def unregister_device(
    body: DeviceRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    await session.execute(
        delete(PushDevice).where(
            PushDevice.token == body.token, PushDevice.user_id == user.id
        )
    )
    await session.commit()
    return {"registered": False}


class ChannelRequest(BaseModel):
    channel: Literal["telegram", "app", "off"]


@router.put("/settings/channel")
async def set_channel(
    body: ChannelRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    if body.channel == "telegram" and user.telegram_id is None:
        raise HTTPException(400, "Этот аккаунт зарегистрирован без Telegram")
    if body.channel == "app" and not await session.scalar(
        select(PushDevice.token)
        .where(PushDevice.user_id == user.id, PushDevice.enabled.is_(True))
        .limit(1)
    ):
        raise HTTPException(409, "Сначала разрешите уведомления на устройстве")
    pref = await session.get(NotificationPreference, user.id)
    if pref:
        pref.channel = body.channel
    else:
        session.add(NotificationPreference(user_id=user.id, channel=body.channel))
    user.notifications_enabled = body.channel != "off"
    await session.commit()
    return {"channel": body.channel}


class DemoCheckout(BaseModel):
    outcome: Literal["success", "declined"] = "success"


@router.post("/billing/demo")
async def demo_checkout(body: DemoCheckout, user: User = Depends(get_current_user)):
    if os.environ.get("MOBILE_DEMO_BILLING") != "1":
        raise HTTPException(404, "Демонстрационная оплата отключена")
    return {
        "demo": True,
        "status": body.outcome,
        "subscription_changed": False,
        "message": "Это демонстрация. Деньги не списаны, подписка не изменена.",
    }


class FeedbackRequest(BaseModel):
    app_rating: int = Field(ge=1, le=5)
    photo_rating: int | None = Field(default=None, ge=1, le=5)
    feedback_text: str | None = Field(default=None, max_length=2000)


@router.post("/feedback")
async def feedback(
    body: FeedbackRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    await session.execute(select(User).where(User.id == user.id).with_for_update())
    repo = UserRepository(session)
    if await repo.has_survey_response(user.id):
        return {"saved": True, "already_sent": True}
    await repo.save_survey_response(
        user.id,
        app_rating=body.app_rating,
        photo_rating=body.photo_rating,
        feedback_text=body.feedback_text,
    )
    return {"saved": True, "already_sent": False}
