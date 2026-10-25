"""Route reminders to the selected channel; persist app deliveries before sending."""

import re
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx
from sqlalchemy import select

from src.db.models import NotificationPreference, PushDelivery, PushDevice
from src.db.session import async_session_factory


async def notify_user(
    bot, repo, user, text, *, event_key, path="/(tabs)/chat", **kwargs
):
    if not user.notifications_enabled:
        return
    pref = await repo.session.get(NotificationPreference, user.id)
    channel = pref.channel if pref else ("telegram" if user.telegram_id is not None else "app")
    if channel == "off":
        return
    if channel == "telegram":
        if user.telegram_id is None:
            return
        await bot.send_message(user.telegram_id, text, **kwargs)
        return
    devices = list(
        (
            await repo.session.scalars(
                select(PushDevice).where(
                    PushDevice.user_id == user.id, PushDevice.enabled.is_(True)
                )
            )
        ).all()
    )
    for device in devices:
        existing = await repo.session.scalar(
            select(PushDelivery.id).where(
                PushDelivery.user_id == user.id,
                PushDelivery.token == device.token,
                PushDelivery.event_key == event_key,
            )
        )
        if existing:
            continue
        repo.session.add(
            PushDelivery(
                id=str(uuid4()),
                user_id=user.id,
                event_key=event_key,
                token=device.token,
                status="pending",
                attempts=0,
                payload={
                    "to": device.token,
                    "title": "Тарелка",
                    "body": "Ваш разбор недели готов"
                    if path == "/assistant"
                    else re.sub("<[^>]+>", "", text)[:180],
                    "data": {"path": path},
                    "sound": "default",
                },
            )
        )
    await repo.session.commit()


async def process_pushes():
    now = datetime.now(timezone.utc)
    async with async_session_factory() as session:
        deliveries = list(
            (
                await session.scalars(
                    select(PushDelivery)
                    .where(
                        PushDelivery.status.in_(["pending", "ticket"]),
                        PushDelivery.updated_at < now - timedelta(seconds=15),
                    )
                    .order_by(PushDelivery.updated_at)
                    .limit(20)
                    .with_for_update(skip_locked=True)
                )
            ).all()
        )
        async with httpx.AsyncClient(timeout=15) as client:
            for d in deliveries:
                device = await session.get(PushDevice, d.token)
                pref = await session.get(NotificationPreference, d.user_id)
                from src.db.models import User

                user = await session.get(User, d.user_id)
                if (
                    not device
                    or not device.enabled
                    or device.user_id != d.user_id
                    or not user
                    or not user.notifications_enabled
                    or (pref.channel if pref else ("telegram" if user.telegram_id is not None else "app")) != "app"
                ):
                    d.status = "cancelled"
                    continue
                if d.status == "pending" and d.event_key.startswith("weigh:"):
                    from src.shared.weight_reminders import reminder_delivery_valid

                    if not await reminder_delivery_valid(session, user, d.event_key, now):
                        d.status = "cancelled"
                        continue
                d.attempts += 1
                d.updated_at = now
                try:
                    if d.status == "pending":
                        response = await client.post(
                            "https://exp.host/--/api/v2/push/send", json=d.payload
                        )
                        response.raise_for_status()
                        data = response.json()["data"]
                        if isinstance(data, list):
                            data = data[0]
                        if data.get("status") == "ok":
                            d.ticket = data["id"]
                            d.status = "ticket"
                        else:
                            if (
                                data.get("details", {}).get("error")
                                == "DeviceNotRegistered"
                            ):
                                device.enabled = False
                            d.status = "failed"
                    else:
                        response = await client.post(
                            "https://exp.host/--/api/v2/push/getReceipts",
                            json={"ids": [d.ticket]},
                        )
                        response.raise_for_status()
                        data = response.json()["data"].get(d.ticket)
                        if data:
                            d.status = (
                                "sent" if data.get("status") == "ok" else "failed"
                            )
                            if (
                                data.get("details", {}).get("error")
                                == "DeviceNotRegistered"
                            ):
                                device.enabled = False
                    if d.attempts >= 20 and d.status in ("pending", "ticket"):
                        d.status = "failed"
                except (httpx.HTTPError, KeyError, ValueError):
                    if d.attempts >= 20:
                        d.status = "failed"
            await session.commit()
