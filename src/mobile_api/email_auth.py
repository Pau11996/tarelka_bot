from __future__ import annotations

import asyncio
import hashlib
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, SecretStr, field_validator
from sqlalchemy import case, delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.bot.config import settings
from src.db.models import AuthRateLimit, NotificationPreference, Profile, User
from src.db.repository import DEFAULT_DAILY_CALORIE_TARGET
from src.db.session import get_session
from src.mobile_api.passwords import DUMMY_HASH, hash_password, verify_password
from src.mobile_api.tokens import issue_access_token

router = APIRouter(prefix="/auth/email")


class Credentials(BaseModel):
    email: str = Field(max_length=254)
    password: SecretStr

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+", value):
            raise ValueError("Укажите корректный email")
        return value


class Registration(Credentials):
    timezone: str = Field(default=settings.default_timezone, max_length=64)


async def rate_limit(session: AsyncSession, scope: str, value: str, limit: int, seconds: int):
    """An atomic bucket shared by API workers; keys contain no raw email or IP."""
    now = datetime.now(timezone.utc)
    resets_at = now + timedelta(seconds=seconds)
    insert = sqlite_insert if session.get_bind().dialect.name == "sqlite" else pg_insert
    expired = AuthRateLimit.resets_at <= now
    statement = insert(AuthRateLimit).values(
        key=hashlib.sha256(f"{scope}:{value}".encode()).hexdigest(),
        attempts=1, resets_at=resets_at,
    ).on_conflict_do_update(
        index_elements=[AuthRateLimit.key],
        set_={
            "attempts": case((expired, 1), else_=AuthRateLimit.attempts + 1),
            "resets_at": case((expired, resets_at), else_=AuthRateLimit.resets_at),
        },
    ).returning(AuthRateLimit.attempts, AuthRateLimit.resets_at)
    attempts, reset = (await session.execute(statement)).one()
    await session.execute(delete(AuthRateLimit).where(AuthRateLimit.resets_at < now - timedelta(days=1)))
    await session.commit()
    if attempts > limit:
        if reset.tzinfo is None:
            reset = reset.replace(tzinfo=timezone.utc)
        retry_after = max(1, int((reset - now).total_seconds()))
        raise HTTPException(
            429, "Слишком много попыток. Попробуйте позже.",
            headers={"Retry-After": str(retry_after)},
        )


def access_token(user: User) -> dict:
    return {"access_token": issue_access_token(user.id), "token_type": "bearer"}


@router.post("/register", status_code=201)
async def register(
    body: Registration, request: Request, session: AsyncSession = Depends(get_session),
):
    password = body.password.get_secret_value()
    if not 8 <= len(password) <= 128:
        raise HTTPException(400, "Пароль должен содержать от 8 до 128 символов")
    try:
        ZoneInfo(body.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(400, "Неизвестный часовой пояс") from None
    await rate_limit(session, "register-ip", request.client.host if request.client else "unknown", 10, 3600)
    if await session.scalar(select(User.id).where(User.email == body.email)):
        raise HTTPException(409, "Этот email уже зарегистрирован. Войдите в аккаунт.")
    user = User(
        email=body.email, telegram_id=None,
        password_hash=await asyncio.to_thread(hash_password, password),
        timezone=body.timezone, legacy_photo_quota=False,
    )
    session.add(user)
    try:
        await session.flush()
        session.add_all([
            Profile(user_id=user.id, daily_calorie_target=DEFAULT_DAILY_CALORIE_TARGET),
            NotificationPreference(user_id=user.id, channel="app"),
        ])
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(409, "Этот email уже зарегистрирован. Войдите в аккаунт.") from None
    await session.refresh(user)
    return access_token(user)


@router.post("/login")
async def login(
    body: Credentials, request: Request, session: AsyncSession = Depends(get_session),
):
    password = body.password.get_secret_value()
    if not 1 <= len(password) <= 128:
        raise HTTPException(401, "Неверный email или пароль")
    await rate_limit(session, "login-ip", request.client.host if request.client else "unknown", 30, 300)
    await rate_limit(session, "login-email", body.email, 10, 300)
    user = await session.scalar(select(User).where(User.email == body.email))
    encoded = user.password_hash if user and user.password_hash else DUMMY_HASH
    valid = await asyncio.to_thread(verify_password, password, encoded)
    if not valid or not user or not user.password_hash:
        raise HTTPException(401, "Неверный email или пароль")
    return access_token(user)
