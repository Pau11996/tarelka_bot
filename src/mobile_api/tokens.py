from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt

from src.bot.config import settings


def issue_access_token(user_id: int, *, now: datetime | None = None) -> str:
    current = now or datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "iat": int(current.timestamp()),
        "exp": int((current + timedelta(days=settings.mobile_token_ttl_days)).timestamp()),
    }
    return jwt.encode(payload, settings.mobile_jwt_secret, algorithm="HS256")


def read_user_id(token: str) -> int:
    payload = jwt.decode(token, settings.mobile_jwt_secret, algorithms=["HS256"])
    return int(payload["sub"])
