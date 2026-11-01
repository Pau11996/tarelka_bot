"""Email ownership is verified before an account or session can be created."""
from __future__ import annotations

import asyncio
import hmac
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.bot.config import settings
from src.db.models import EmailRegistration, NotificationPreference, Profile, User
from src.db.repository import DEFAULT_DAILY_CALORIE_TARGET
from src.db.session import get_session
from src.mobile_api.email_auth import Registration, access_token, rate_limit
from src.mobile_api.email_delivery import recovery_email_configured, send_registration_code
from src.mobile_api.passwords import hash_password

router = APIRouter(prefix="/auth/email")
CODE_SECONDS = 600
RESEND_SECONDS = 60
EXPIRED = "Код неверный или истёк. Проверьте последнее письмо или запросите новый код."
EXISTS = "Этот email уже зарегистрирован. Войдите в аккаунт."


class RegistrationChallenge(BaseModel):
    registration_id: UUID


class RegistrationVerification(RegistrationChallenge):
    code: str = Field(pattern=r"^[0-9]{6}$")


def code_hash(registration_id: str, email: str, code: str) -> str:
    return hmac.new(settings.mobile_jwt_secret.encode(),
        f"email-registration:{registration_id}:{email}:{code}".encode(), "sha256").hexdigest()


def challenge_out(registration: EmailRegistration) -> dict:
    return {"status": "verification_required", "registration_id": registration.id,
            "email": registration.email, "expires_in": CODE_SECONDS, "resend_after": RESEND_SECONDS}


async def send_limits(session, request, email):
    await rate_limit(session, "register-send-ip", request.client.host if request.client else "unknown", 10, 3600)
    await rate_limit(session, "register-send-email-hour", email, 5, 3600)
    await rate_limit(session, "register-send-email-minute", email, 1, RESEND_SECONDS)


async def deliver(session, email, code):
    try:
        await send_registration_code(email, code)
        await session.commit()
    except (OSError, smtplib.SMTPException):
        await session.rollback()
        raise HTTPException(503, "Не удалось отправить письмо. Попробуйте позже.") from None


def require_email_delivery():
    if not recovery_email_configured():
        raise HTTPException(503, "Отправка писем временно недоступна. Попробуйте позже.")


@router.post("/register", status_code=202)
async def register(body: Registration, request: Request, session: AsyncSession = Depends(get_session)):
    password = body.password.get_secret_value()
    if not 8 <= len(password) <= 128:
        raise HTTPException(400, "Пароль должен содержать от 8 до 128 символов")
    try:
        ZoneInfo(body.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(400, "Неизвестный часовой пояс") from None
    await rate_limit(session, "register-ip", request.client.host if request.client else "unknown", 10, 3600)
    if await session.scalar(select(User.id).where(User.email == body.email)):
        raise HTTPException(409, EXISTS)
    await send_limits(session, request, body.email)
    require_email_delivery()
    now = datetime.now(timezone.utc)
    await session.execute(delete(EmailRegistration).where(EmailRegistration.created_at < now - timedelta(days=1)))
    rid, code = str(uuid4()), f"{secrets.randbelow(1_000_000):06d}"
    values = dict(id=rid, email=body.email, password_hash=await asyncio.to_thread(hash_password, password),
                  timezone=body.timezone, code_hash=code_hash(rid, body.email, code),
                  expires_at=now + timedelta(seconds=CODE_SECONDS), created_at=now)
    insert = sqlite_insert if session.get_bind().dialect.name == "sqlite" else pg_insert
    await session.execute(insert(EmailRegistration).values(**values).on_conflict_do_update(
        index_elements=[EmailRegistration.email], set_=values))
    if await session.scalar(select(User.id).where(User.email == body.email)):
        await session.rollback()
        raise HTTPException(409, EXISTS)
    await deliver(session, body.email, code)
    return {"status": "verification_required", "registration_id": rid, "email": body.email,
            "expires_in": CODE_SECONDS, "resend_after": RESEND_SECONDS}


@router.post("/register/resend")
async def resend(body: RegistrationChallenge, request: Request, session: AsyncSession = Depends(get_session)):
    rid = str(body.registration_id)
    registration = await session.get(EmailRegistration, rid)
    if registration is None:
        raise HTTPException(400, "Регистрация устарела. Укажите email и пароль заново.")
    await send_limits(session, request, registration.email)
    require_email_delivery()
    registration = await session.scalar(select(EmailRegistration).where(EmailRegistration.id == rid).with_for_update().execution_options(populate_existing=True))
    now = datetime.now(timezone.utc)
    if registration is None or registration.created_at.replace(tzinfo=timezone.utc) < now - timedelta(days=1):
        raise HTTPException(400, "Регистрация устарела. Укажите email и пароль заново.")
    if await session.scalar(select(User.id).where(User.email == registration.email)):
        raise HTTPException(409, EXISTS)
    code = f"{secrets.randbelow(1_000_000):06d}"
    if hmac.compare_digest(registration.code_hash, code_hash(rid, registration.email, code)):
        code = f"{(int(code) + 1) % 1_000_000:06d}"
    registration.code_hash = code_hash(rid, registration.email, code)
    registration.expires_at = now + timedelta(seconds=CODE_SECONDS)
    result = challenge_out(registration)
    await session.flush()
    await deliver(session, registration.email, code)
    return result


@router.post("/register/verify", status_code=201)
async def verify(body: RegistrationVerification, request: Request, session: AsyncSession = Depends(get_session)):
    await rate_limit(session, "register-verify-ip", request.client.host if request.client else "unknown", 30, CODE_SECONDS)
    rid = str(body.registration_id)
    registration = await session.get(EmailRegistration, rid)
    if registration is None:
        raise HTTPException(400, EXPIRED)
    email = registration.email
    await rate_limit(session, "register-verify-email", email, 5, CODE_SECONDS)
    consumed = (await session.execute(delete(EmailRegistration).where(
        EmailRegistration.id == rid, EmailRegistration.code_hash == code_hash(rid, email, body.code),
        EmailRegistration.expires_at > datetime.now(timezone.utc),
    ).returning(EmailRegistration.email, EmailRegistration.password_hash, EmailRegistration.timezone)
        .execution_options(synchronize_session=False))).first()
    if consumed is None:
        raise HTTPException(400, EXPIRED)
    user = User(email=consumed.email, telegram_id=None, password_hash=consumed.password_hash,
                timezone=consumed.timezone, legacy_photo_quota=False)
    session.add(user)
    try:
        await session.flush()
        session.add_all([Profile(user_id=user.id, daily_calorie_target=DEFAULT_DAILY_CALORIE_TARGET),
                         NotificationPreference(user_id=user.id, channel="app")])
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(409, EXISTS) from None
    return access_token(user)
