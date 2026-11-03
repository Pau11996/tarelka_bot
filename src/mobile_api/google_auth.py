"""Native Google sign-in: signed ID tokens, one-use nonces, stable Google subjects."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, SecretStr
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.bot.config import settings
from src.db.models import GoogleLoginChallenge, NotificationPreference, Profile, User
from src.db.repository import DEFAULT_DAILY_CALORIE_TARGET
from src.db.session import get_session
from src.mobile_api.email_auth import EmailAddress, access_token, rate_limit
from src.mobile_api.passwords import verify_password

router = APIRouter(prefix="/auth/google")
CHALLENGE_SECONDS = 300
UNAVAILABLE = "Вход через Google временно недоступен. Попробуйте позже."
INVALID = "Не удалось подтвердить вход через Google. Попробуйте ещё раз."
keys = jwt.PyJWKClient("https://www.googleapis.com/oauth2/v3/certs", lifespan=300, timeout=5)


class GoogleLogin(BaseModel):
    challenge_id: UUID
    id_token: SecretStr = Field(min_length=1, max_length=8192)
    timezone: str = Field(default=settings.default_timezone, max_length=64)
    password: SecretStr | None = Field(default=None, max_length=128)


def require_client_id() -> str:
    value = settings.google_web_client_id.strip()
    if not value or not value.endswith(".apps.googleusercontent.com"):
        raise HTTPException(503, UNAVAILABLE)
    return value


def verify_google_token(token: str, client_id: str) -> dict:
    try:
        key = keys.get_signing_key_from_jwt(token).key
        claims = jwt.decode(token, key, algorithms=["RS256"], audience=client_id,
            issuer=["https://accounts.google.com", "accounts.google.com"],
            options={"require": ["sub", "exp", "iat", "aud", "iss", "nonce", "email", "email_verified"]})
        if (claims["email_verified"] is not True or not isinstance(claims["sub"], str)
                or not 1 <= len(claims["sub"]) <= 255
                or not isinstance(claims["nonce"], str) or not claims["nonce"]):
            raise ValueError("Invalid Google identity")
        claims["email"] = EmailAddress(email=claims["email"]).email
        return claims
    except jwt.PyJWKClientConnectionError:
        raise HTTPException(503, UNAVAILABLE) from None
    except (jwt.PyJWTError, ValueError, TypeError, KeyError):
        raise HTTPException(401, INVALID) from None


@router.post("/start")
async def start(request: Request, session: AsyncSession = Depends(get_session)):
    client_id = require_client_id()
    await rate_limit(session, "google-start-ip", request.client.host if request.client else "unknown", 30, 300)
    now = datetime.now(timezone.utc)
    await session.execute(delete(GoogleLoginChallenge).where(GoogleLoginChallenge.expires_at <= now))
    nonce = secrets.token_urlsafe(32)
    challenge = GoogleLoginChallenge(id=str(uuid4()), nonce_hash=hashlib.sha256(nonce.encode()).hexdigest(),
        expires_at=now + timedelta(seconds=CHALLENGE_SECONDS))
    session.add(challenge)
    await session.commit()
    return {"challenge_id": challenge.id, "nonce": nonce, "web_client_id": client_id, "expires_in": CHALLENGE_SECONDS}


@router.post("/login")
async def login(body: GoogleLogin, request: Request, session: AsyncSession = Depends(get_session)):
    client_id = require_client_id()
    try:
        ZoneInfo(body.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(400, "Неизвестный часовой пояс") from None
    await rate_limit(session, "google-login-ip", request.client.host if request.client else "unknown", 30, 300)
    await rate_limit(session, "google-challenge", str(body.challenge_id), 8, CHALLENGE_SECONDS)
    challenge = await session.get(GoogleLoginChallenge, str(body.challenge_id))
    now = datetime.now(timezone.utc)
    if challenge is None or challenge.expires_at.replace(tzinfo=timezone.utc) <= now:
        raise HTTPException(401, INVALID)
    claims = await asyncio.to_thread(verify_google_token, body.id_token.get_secret_value(), client_id)
    nonce_hash = hashlib.sha256(claims["nonce"].encode()).hexdigest()
    if not hmac.compare_digest(challenge.nonce_hash, nonce_hash):
        raise HTTPException(401, INVALID)
    if body.password is not None:
        # Share the email-login bucket so new challenges/IPs cannot bypass password throttling.
        await rate_limit(session, "login-email", claims["email"], 10, 300)
    # A Google subject is stable even when the user changes their Google email.
    user = await session.scalar(select(User).where(User.google_subject == claims["sub"]).with_for_update())
    if user is None:
        user = await session.scalar(select(User).where(User.email == claims["email"]).with_for_update())
        if user is not None:
            if user.google_subject is not None:
                raise HTTPException(409, "Этот email уже связан с другим аккаунтом Google. Войдите по email.")
            # Google does not guarantee current mailbox ownership for third-party email.
            authoritative = claims["email"].endswith("@gmail.com") or bool(claims.get("hd"))
            if not authoritative:
                if body.password is None:
                    return {"status": "password_required", "email": user.email}
                if not user.password_hash or not await asyncio.to_thread(
                    verify_password, body.password.get_secret_value(), user.password_hash,
                ):
                    raise HTTPException(401, "Неверный пароль от существующего аккаунта.")

    # DELETE ... RETURNING makes replay/concurrent consumption fail atomically.
    consumed = await session.scalar(delete(GoogleLoginChallenge).where(
        GoogleLoginChallenge.id == str(body.challenge_id), GoogleLoginChallenge.nonce_hash == nonce_hash,
        GoogleLoginChallenge.expires_at > datetime.now(timezone.utc),
    ).returning(GoogleLoginChallenge.id).execution_options(synchronize_session=False))
    if consumed is None:
        raise HTTPException(401, INVALID)
    try:
        if user is None:
            user = User(email=claims["email"], google_subject=claims["sub"], timezone=body.timezone,
                telegram_id=None, password_hash=None, legacy_photo_quota=False)
            session.add(user)
            await session.flush()
            session.add_all([Profile(user_id=user.id, daily_calorie_target=DEFAULT_DAILY_CALORIE_TARGET),
                NotificationPreference(user_id=user.id, channel="app")])
        else:
            user.google_subject = claims["sub"]
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(409, "Аккаунт уже обновлён. Повторите вход через Google.") from None
    return access_token(user)
