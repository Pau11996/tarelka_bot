from __future__ import annotations

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import User
from src.db.repository import UserRepository
from src.db.session import get_session
from src.mobile_api.tokens import read_user_id

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_session),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Нужен вход")
    try:
        user_id = read_user_id(credentials.credentials)
    except (jwt.InvalidTokenError, ValueError):
        raise HTTPException(status_code=401, detail="Нужен вход") from None
    user = await UserRepository(session).get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Нужен вход")
    return user
