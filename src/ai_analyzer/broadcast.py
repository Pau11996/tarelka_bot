from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from enum import Enum
from typing import Awaitable, Callable, Literal

import httpx
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import User

logger = logging.getLogger(__name__)

ADMIN_TELEGRAM_ID = 1048665898
TELEGRAM_MESSAGE_MAX_LENGTH = 4096
SEND_DELAY_SECONDS = 0.04
TELEGRAM_API_URL = "https://api.telegram.org/bot{token}/sendMessage"

SendResult = Literal["sent", "blocked", "failed"]
JobStatus = Literal["idle", "running", "done", "error"]
SendFn = Callable[[httpx.AsyncClient, str, int, str], Awaitable[SendResult]]


class BroadcastAudience(str, Enum):
    ALL = "all"
    SUBSCRIBERS = "subscribers"
    ME = "me"


class BroadcastStatus(BaseModel):
    status: JobStatus = "idle"
    audience: str | None = None
    targeted: int = 0
    sent: int = 0
    failed: int = 0
    blocked: int = 0
    error: str | None = None


class BroadcastState:
    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        self._status = BroadcastStatus()

    @property
    def is_running(self) -> bool:
        return self._status.status == "running"

    def snapshot(self) -> BroadcastStatus:
        return self._status.model_copy()

    def begin(self, audience: str, targeted: int) -> BroadcastStatus:
        self._status = BroadcastStatus(
            status="running",
            audience=audience,
            targeted=targeted,
        )
        return self.snapshot()

    def record(self, result: SendResult) -> None:
        if result == "sent":
            self._status.sent += 1
        elif result == "blocked":
            self._status.blocked += 1
        else:
            self._status.failed += 1

    def finish(self) -> None:
        self._status.status = "done"
        self._status.error = None

    def fail(self, error: str) -> None:
        self._status.status = "error"
        self._status.error = error


broadcast_state = BroadcastState()


def telegram_bot_token() -> str:
    return os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()


async def list_broadcast_telegram_ids(
    session: AsyncSession,
    audience: BroadcastAudience,
    *,
    now: datetime | None = None,
    admin_telegram_id: int = ADMIN_TELEGRAM_ID,
) -> list[int]:
    if audience is BroadcastAudience.ME:
        return [admin_telegram_id]

    query = select(User.telegram_id).where(User.notifications_enabled.is_(True))
    if audience is BroadcastAudience.SUBSCRIBERS:
        current = now or datetime.now(timezone.utc)
        query = query.where(User.subscription_until.is_not(None), User.subscription_until > current)

    result = await session.execute(query)
    return [int(telegram_id) for telegram_id in result.scalars().all()]


def classify_telegram_result(status_code: int, payload: dict[str, object]) -> SendResult:
    if payload.get("ok") is True:
        return "sent"

    description = str(payload.get("description") or "").lower()
    if status_code == 403 or "blocked" in description or "deactivated" in description:
        return "blocked"
    return "failed"


async def send_telegram_message(
    client: httpx.AsyncClient,
    token: str,
    chat_id: int,
    text: str,
    *,
    reply_markup: dict[str, object] | None = None,
    retries_left: int = 3,
) -> SendResult:
    try:
        payload_body: dict[str, object] = {"chat_id": chat_id, "text": text}
        if reply_markup is not None:
            payload_body["reply_markup"] = reply_markup
        response = await client.post(
            TELEGRAM_API_URL.format(token=token),
            json=payload_body,
        )
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}

        if response.status_code == 429 and retries_left > 0:
            retry_after = 1
            parameters = payload.get("parameters")
            if isinstance(parameters, dict) and isinstance(parameters.get("retry_after"), int):
                retry_after = max(1, parameters["retry_after"])
            await asyncio.sleep(retry_after)
            return await send_telegram_message(
                client,
                token,
                chat_id,
                text,
                reply_markup=reply_markup,
                retries_left=retries_left - 1,
            )

        return classify_telegram_result(response.status_code, payload)
    except httpx.HTTPError:
        logger.exception("Telegram broadcast request failed chat_id=%s", chat_id)
        return "failed"


async def send_telegram_message_with_markup(
    client: httpx.AsyncClient,
    token: str,
    chat_id: int,
    text: str,
    reply_markup: dict[str, object],
    *,
    retries_left: int = 3,
) -> SendResult:
    return await send_telegram_message(
        client,
        token,
        chat_id,
        text,
        reply_markup=reply_markup,
        retries_left=retries_left,
    )


def survey_invitation_reply_markup() -> dict[str, object]:
    return {
        "inline_keyboard": [
            [{"text": "Пройти опрос", "callback_data": "survey:start"}]
        ]
    }


async def run_broadcast(
    telegram_ids: list[int],
    text: str,
    *,
    token: str,
    state: BroadcastState | None = None,
    send: SendFn = send_telegram_message,
    reply_markup: dict[str, object] | None = None,
    delay_seconds: float = SEND_DELAY_SECONDS,
) -> BroadcastStatus:
    job = state or broadcast_state
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            for index, chat_id in enumerate(telegram_ids):
                if reply_markup is not None:
                    result = await send_telegram_message_with_markup(
                        client, token, chat_id, text, reply_markup
                    )
                else:
                    result = await send(client, token, chat_id, text)
                job.record(result)
                if delay_seconds > 0 and index + 1 < len(telegram_ids):
                    await asyncio.sleep(delay_seconds)
        job.finish()
    except Exception as exc:
        logger.exception("Broadcast failed")
        job.fail(str(exc))
    return job.snapshot()
