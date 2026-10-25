"""Read-only wearable imports. Never create DayEntry or update Profile here."""
from __future__ import annotations

import hashlib
import json
import os
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import HealthConnection, HealthDailySummary, HealthRecord, HealthSyncReceipt, User
from src.db.session import get_session
from src.mobile_api.deps import get_current_user

router = APIRouter(prefix="/health", tags=["Health Connect"])
HealthType = Literal["Steps", "Distance", "ActiveCaloriesBurned", "ExerciseSession", "Weight"]
FIELDS = {"Steps": "steps", "Distance": "distance_m", "ActiveCaloriesBurned": "active_kcal", "ExerciseSession": "exercise_minutes"}


def health_enabled():
    return os.getenv("HEALTH_CONNECT_ENABLED", "0") == "1"


def require_enabled():
    if not health_enabled():
        raise HTTPException(503, "Подключение устройств временно недоступно")


def zone_for(user):
    try:
        return ZoneInfo(user.timezone)
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def aware(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def utc_bounds(day, zone):
    return (datetime.combine(day, time.min, tzinfo=zone).astimezone(timezone.utc),
            datetime.combine(day + timedelta(days=1), time.min, tzinfo=zone).astimezone(timezone.utc))


class ConnectInput(BaseModel):
    installation_id: UUID
    permissions: list[HealthType] = Field(max_length=5)
    workout_origin: str | None = Field(default=None, max_length=255)
    replace_existing: bool = False


class DailyInput(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    date: date
    steps: int | None = Field(default=None, ge=0, le=10000000)
    distance_m: float | None = Field(default=None, ge=0, le=10000000)
    active_kcal: float | None = Field(default=None, ge=0, le=100000)
    exercise_minutes: float | None = Field(default=None, ge=0, le=1500)
    origins: list[str] = Field(default_factory=list, max_length=100)


class RecordInput(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    record_type: Literal["Weight", "ExerciseSession"]
    external_id: str = Field(min_length=1, max_length=200)
    origin: str = Field(min_length=1, max_length=255)
    start_at: AwareDatetime
    end_at: AwareDatetime | None = None
    weight_kg: float | None = Field(default=None, gt=0, le=1000)
    title: str | None = Field(default=None, max_length=255)
    exercise_type: int | None = None
    duration_minutes: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_record(self):
        if self.record_type == "Weight" and (self.weight_kg is None or self.end_at is not None):
            raise ValueError("Измерение веса должно содержать вес и время")
        if self.record_type == "ExerciseSession":
            if self.end_at is None or self.end_at <= self.start_at:
                raise ValueError("Некорректный интервал тренировки")
            if self.duration_minutes is not None and self.duration_minutes > (self.end_at - self.start_at).total_seconds() / 60 + 1:
                raise ValueError("Длительность превышает интервал тренировки")
        return self


class DeletedInput(BaseModel):
    record_type: Literal["Weight", "ExerciseSession"]
    external_id: str = Field(min_length=1, max_length=200)


class SyncInput(BaseModel):
    connection_id: UUID
    generation: UUID
    batch_id: UUID
    base_revision: int = Field(ge=0)
    timezone: str = Field(min_length=1, max_length=64)
    start_date: date
    end_date: date
    types: list[HealthType] = Field(min_length=1, max_length=5)
    days: list[DailyInput] = Field(default_factory=list, max_length=31)
    records: list[RecordInput] = Field(default_factory=list, max_length=10000)
    deleted: list[DeletedInput] = Field(default_factory=list, max_length=10000)
    reconcile: bool = False

    @model_validator(mode="after")
    def validate_batch(self):
        if not 0 <= (self.end_date - self.start_date).days <= 30:
            raise ValueError("Пакет должен охватывать не больше 31 дня")
        if len(set(self.types)) != len(self.types):
            raise ValueError("Типы данных повторяются")
        dates = [day.date for day in self.days]
        if len(set(dates)) != len(dates) or any(d < self.start_date or d > self.end_date for d in dates):
            raise ValueError("Некорректные даты пакета")
        if self.reconcile and len(dates) != (self.end_date - self.start_date).days + 1:
            raise ValueError("Полная сверка должна содержать каждый день диапазона")
        ids = [(item.record_type, item.external_id) for item in self.records]
        if len(ids) != len(set(ids)):
            raise ValueError("Записи пакета повторяются")
        if set(ids) & {(item.record_type, item.external_id) for item in self.deleted}:
            raise ValueError("Запись одновременно обновляется и удаляется")
        if any(item.record_type not in self.types for item in [*self.records, *self.deleted]):
            raise ValueError("Тип записи не включён в пакет")
        return self


async def connection_for(session, user, lock=False):
    query = select(HealthConnection).where(HealthConnection.user_id == user.id)
    return await session.scalar(query.with_for_update() if lock else query)


async def connection_out(session, user, row, start=None, end=None):
    zone = zone_for(user)
    today = datetime.now(zone).date()
    first = start or today - timedelta(days=29)
    last = end or today
    if first > last or (last - first).days > 30 or last > today:
        raise HTTPException(422, "Выберите диапазон до 31 дня, не позже сегодняшнего дня")
    oldest = await session.scalar(select(func.min(HealthDailySummary.local_date)).where(HealthDailySummary.user_id == user.id)) if row else None
    return dict(
        available=health_enabled(), provider="health_connect", connection_id=row.id if row else None,
        installation_id=row.installation_id if row else None, generation=row.generation if row else None,
        connected=bool(row and row.enabled), permissions=row.permissions if row else [],
        workout_origin=row.workout_origin if row else None, revision=row.revision if row else 0,
        last_synced_at=aware(row.last_sync_at).isoformat() if row and row.last_sync_at else None,
        timezone=zone.key, today=today.isoformat(), history_start=(oldest or first).isoformat(),
        windows=[dict(date=(day := first + timedelta(days=i)).isoformat(), start_at=utc_bounds(day, zone)[0].isoformat(), end_at=utc_bounds(day, zone)[1].isoformat()) for i in range((last-first).days+1)],
    )


@router.get("/connection")
async def get_connection(start: date | None = None, end: date | None = None, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    if not health_enabled():
        return dict(available=False, connected=False, connection_id=None, permissions=[])
    return await connection_out(session, user, await connection_for(session, user), start, end)


@router.put("/connection")
async def connect(body: ConnectInput, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    require_enabled()
    # Serialize first-time connects too, before a connection row exists.
    await session.execute(select(User.id).where(User.id == user.id).with_for_update())
    row = await connection_for(session, user, lock=True)
    now = datetime.now(timezone.utc)
    if row and row.enabled and row.installation_id != str(body.installation_id) and not body.replace_existing:
        raise HTTPException(409, "Подключён другой телефон. Подтвердите замену источника.")
    if not row:
        row = HealthConnection(id=str(uuid4()), user_id=user.id, installation_id=str(body.installation_id), generation=str(uuid4()), enabled=True, permissions=[], revision=0, connected_at=now)
        session.add(row)
    if not row.enabled or row.installation_id != str(body.installation_id) or row.workout_origin != body.workout_origin or sorted(row.permissions) != sorted(set(body.permissions)):
        row.generation = str(uuid4())
        row.connected_at = now
        row.revision = 0
    row.installation_id = str(body.installation_id)
    row.enabled = True
    row.permissions = sorted(set(body.permissions))
    row.workout_origin = body.workout_origin
    await session.commit()
    return await connection_out(session, user, row)


@router.delete("/connection", status_code=204)
async def disconnect(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    require_enabled()
    row = await connection_for(session, user, lock=True)
    if row:
        row.enabled = False
        row.generation = str(uuid4())
        row.permissions = []
        await session.commit()


@router.delete("/data", status_code=204)
async def erase_imports(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    require_enabled()
    row = await connection_for(session, user, lock=True)
    if row:
        row.enabled = False
        row.permissions = []
        row.generation = str(uuid4())
        row.last_sync_at = None
        row.revision = 0
    for model in (HealthDailySummary, HealthRecord, HealthSyncReceipt):
        await session.execute(delete(model).where(model.user_id == user.id))
    await session.commit()


@router.post("/sync")
async def sync(body: SyncInput, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    require_enabled()
    row = await connection_for(session, user, lock=True)
    if not row or not row.enabled or row.id != str(body.connection_id) or row.generation != str(body.generation):
        raise HTTPException(409, "Подключение изменилось. Подключите Health Connect заново.")
    if not set(body.types) <= set(row.permissions):
        raise HTTPException(409, "Разрешения изменились. Обновите подключение.")
    zone = zone_for(user)
    if body.timezone != zone.key:
        raise HTTPException(409, "Часовой пояс изменился. Повторите синхронизацию.")
    if "ExerciseSession" in body.types and not row.workout_origin:
        raise HTTPException(422, "Выберите источник тренировок")
    if body.end_date > datetime.now(zone).date():
        raise HTTPException(422, "Нельзя загружать данные будущих дней")
    start_at, _ = utc_bounds(body.start_date, zone)
    _, end_at = utc_bounds(body.end_date, zone)
    for item in body.records:
        if not start_at <= item.start_at < end_at:
            # A session can start before midnight and finish inside this window.
            if item.record_type != "ExerciseSession" or not item.end_at or not start_at < item.end_at <= end_at:
                raise HTTPException(422, "Запись находится вне диапазона пакета")
        if item.record_type == "ExerciseSession" and row.workout_origin and item.origin != row.workout_origin:
            raise HTTPException(422, "Тренировка из другого выбранного источника")
    digest = hashlib.sha256(json.dumps(body.model_dump(mode="json"), sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    receipt = await session.get(HealthSyncReceipt, (user.id, str(body.batch_id)))
    if receipt:
        if receipt.digest != digest:
            raise HTTPException(409, "Идентификатор пакета уже использован")
        return receipt.result
    claimed = await session.execute(update(HealthConnection).where(HealthConnection.id == row.id, HealthConnection.revision == body.base_revision, HealthConnection.generation == str(body.generation), HealthConnection.enabled.is_(True)).values(revision=body.base_revision + 1))
    if claimed.rowcount != 1:
        raise HTTPException(409, "Данные уже обновлены. Повторите синхронизацию.")
    now = datetime.now(timezone.utc)
    existing_days = {d.local_date: d for d in (await session.scalars(select(HealthDailySummary).where(HealthDailySummary.user_id == user.id, HealthDailySummary.local_date >= body.start_date, HealthDailySummary.local_date <= body.end_date))).all()}
    for item in body.days:
        saved = existing_days.get(item.date)
        if not saved:
            saved = HealthDailySummary(user_id=user.id, local_date=item.date, timezone=zone.key, values={}, origins=[], updated_at=now)
            session.add(saved)
        values = dict(saved.values) if saved.timezone == zone.key else {}
        for kind, key in FIELDS.items():
            if kind in body.types:
                values[key] = getattr(item, key)
        saved.values = values
        saved.origins = sorted(set(item.origins) if body.reconcile else set(saved.origins or []) | set(item.origins))
        saved.timezone, saved.updated_at = zone.key, now
    if body.reconcile:
        kinds = [kind for kind in body.types if kind in ("Weight", "ExerciseSession")]
        if kinds:
            await session.execute(delete(HealthRecord).where(HealthRecord.user_id == user.id, HealthRecord.record_type.in_(kinds), HealthRecord.start_at >= start_at, HealthRecord.start_at < end_at))
    for item in body.deleted:
        await session.execute(delete(HealthRecord).where(HealthRecord.user_id == user.id, HealthRecord.record_type == item.record_type, HealthRecord.external_id == item.external_id))
    changed_weight_ids = set()
    for item in body.records:
        saved = await session.scalar(select(HealthRecord).where(HealthRecord.user_id == user.id, HealthRecord.record_type == item.record_type, HealthRecord.external_id == item.external_id))
        if not saved:
            saved = HealthRecord(user_id=user.id, generation=row.generation, record_type=item.record_type, external_id=item.external_id)
            session.add(saved)
        saved.generation = row.generation
        saved.origin, saved.start_at, saved.end_at = item.origin, item.start_at, item.end_at
        saved.values = {k: v for k, v in item.model_dump(mode="json").items() if k in ("weight_kg", "title", "exercise_type", "duration_minutes") and v is not None}
        saved.updated_at = now
        if item.record_type == "Weight":
            changed_weight_ids.add(saved)
    row.last_sync_at = now
    result = dict(revision=body.base_revision + 1, last_synced_at=now.isoformat(), batch_id=str(body.batch_id))
    session.add(HealthSyncReceipt(user_id=user.id, batch_id=str(body.batch_id), digest=digest, result=result, created_at=now))
    await session.execute(delete(HealthSyncReceipt).where(HealthSyncReceipt.user_id == user.id, HealthSyncReceipt.created_at < now - timedelta(days=30)))
    if "Weight" in body.types:
        from src.shared.weight_tracking import sync_awards, sync_goal_message

        await session.flush()
        await sync_goal_message(session, user, measurement_ids={f"health:{record.id}" for record in changed_weight_ids})
        await sync_awards(session, user)
    await session.commit()
    return result


def record_out(record, zone):
    start = aware(record.start_at)
    values = dict(record.values)
    return dict(id=f"health:{record.id}", source="health_connect", origin=record.origin,
                recorded_at=start.isoformat(), local_date=start.astimezone(zone).date().isoformat(),
                start_at=start.isoformat(), end_at=aware(record.end_at).isoformat() if record.end_at else None, **values)


async def health_weight(session, user, start_at=None, end_at=None):
    if not health_enabled():
        return []
    query = select(HealthRecord).where(HealthRecord.user_id == user.id, HealthRecord.record_type == "Weight")
    if start_at:
        query = query.where(HealthRecord.start_at >= start_at)
    if end_at:
        query = query.where(HealthRecord.start_at <= end_at)
    records = (await session.scalars(query.order_by(HealthRecord.start_at))).all()
    return [record_out(record, zone_for(user)) for record in records]


async def health_payload(session, user, start, end):
    if not health_enabled():
        return None
    connection = await connection_for(session, user)
    if not connection:
        return None
    rows = (await session.scalars(select(HealthDailySummary).where(HealthDailySummary.user_id == user.id, HealthDailySummary.local_date >= start, HealthDailySummary.local_date <= end).order_by(HealthDailySummary.local_date))).all()
    zone = zone_for(user)
    first, _ = utc_bounds(start, zone)
    _, last = utc_bounds(end, zone)
    query = select(HealthRecord).where(HealthRecord.user_id == user.id, HealthRecord.record_type == "ExerciseSession", HealthRecord.start_at < last, HealthRecord.end_at > first)
    workouts = (await session.scalars(query.order_by(HealthRecord.start_at))).all()
    day_rows = {r.local_date: r for r in rows}
    days = []
    for i in range((end-start).days+1):
        day = start + timedelta(days=i)
        row = day_rows.get(day)
        if row and row.timezone != zone.key:
            row = None
        days.append(dict(date=day.isoformat(), **{key: row.values.get(key) if row else None for key in FIELDS.values()}))
    return dict(timezone=zone.key, connected=connection.enabled, last_synced_at=aware(connection.last_sync_at).isoformat() if connection.last_sync_at else None,
                contributes_to_budget=False, days=days, workouts=[record_out(record, zone) for record in workouts])
