from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt

from src.bot.config import settings


def issue_access_token(user_id: int, *, now: datetime | None = None, auth_version: int = 0) -> str:
    current = now or datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "ver": auth_version,
        "iat": int(current.timestamp()),
        "exp": int(
            (current + timedelta(days=settings.mobile_token_ttl_days)).timestamp()
        ),
    }
    return jwt.encode(payload, settings.mobile_jwt_secret, algorithm="HS256")


def read_user_id(token: str) -> int:
    payload = read_access_token(token)
    return int(payload["sub"])


def read_access_token(token: str) -> dict:
    return jwt.decode(token, settings.mobile_jwt_secret, algorithms=["HS256"], options={"require": ["sub", "exp"]})
