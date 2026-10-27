"""Saved templates have their own corrections, independent of diary entries."""

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import MobileMedia, MobileOperation, User
from src.db.repository import UserRepository
from src.db.session import get_session
from src.mobile_api.deps import get_current_user
from src.mobile_api.experience import operation_out
from src.mobile_api.serializers import favorite_out

router = APIRouter()


class FavoriteCorrection(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    request_key: str = Field(min_length=8, max_length=100)
    text: str = Field(min_length=1, max_length=2000)


async def latest_correction(session: AsyncSession, user_id: int, favorite_id: int):
    return await session.scalar(
        select(MobileOperation)
        .where(
            MobileOperation.user_id == user_id,
            MobileOperation.kind == "correct_favorite",
            MobileOperation.payload["favorite_id"].as_integer() == favorite_id,
        )
        .order_by(MobileOperation.created_at.desc(), MobileOperation.id.desc())
        .limit(1)
    )


@router.get("/favorites/{favorite_id}")
async def favorite_details(
    favorite_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    favorite = await UserRepository(session).get_favorite(favorite_id, user.id)
    if favorite is None:
        raise HTTPException(404, "Запись в избранном не найдена")
    operation = await latest_correction(session, user.id, favorite.id)
    media = []
    if favorite.source_entry_id is not None:
        media = (await session.scalars(
            select(MobileMedia).join(MobileOperation, MobileMedia.operation_id == MobileOperation.id)
            .where(
                MobileMedia.user_id == user.id,
                MobileOperation.user_id == user.id,
                MobileOperation.entry_id == favorite.source_entry_id,
            )
            .order_by(MobileMedia.created_at, MobileMedia.id)
        )).all()
    return {
        "favorite": {**favorite_out(favorite), "media": [
            {"id": item.id, "mime": item.mime, "url": f"/v1/media/{item.id}"}
            for item in media
        ]},
        "operation": operation_out(operation) if operation else None,
    }


@router.post("/favorites/{favorite_id}/correct", status_code=202)
async def correct_favorite(
    favorite_id: int,
    body: FavoriteCorrection,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    # Same lock as favorite removal: concurrent submissions cannot create two
    # corrections of the same template. The worker applies each result atomically.
    await session.execute(select(User.id).where(User.id == user.id).with_for_update())
    favorite = await UserRepository(session).get_favorite(favorite_id, user.id)
    if favorite is None:
        raise HTTPException(404, "Запись в избранном не найдена")
    existing = await session.scalar(select(MobileOperation).where(
        MobileOperation.user_id == user.id, MobileOperation.request_key == body.request_key,
    ))
    if existing and (
        existing.kind != "correct_favorite"
        or existing.payload.get("favorite_id") != favorite_id
        or existing.payload.get("text") != body.text
    ):
        raise HTTPException(409, "Этот идентификатор принадлежит другому запросу")
    if existing and existing.status != "failed":
        return operation_out(existing)
    latest = await latest_correction(session, user.id, favorite_id)
    if latest and latest.status in ("queued", "running"):
        raise HTTPException(409, "Эта запись избранного уже уточняется")
    if existing:
        if latest.id != existing.id:
            raise HTTPException(409, "Избранное уже уточнялось. Отправьте новое уточнение")
        existing.status = "queued"
        existing.error = existing.result = existing.started_at = None
        operation = existing
    else:
        operation = MobileOperation(
            id=str(uuid4()), user_id=user.id, request_key=body.request_key,
            kind="correct_favorite", status="queued",
            payload={"favorite_id": favorite_id, "text": body.text},
            created_at=datetime.now(timezone.utc),
        )
        session.add(operation)
    await session.commit()
    await session.refresh(operation)
    return operation_out(operation)
