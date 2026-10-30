"""Guided workouts: no AI usage, no Health Connect writes, atomic diary linking."""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import DayEntry, EntryType, Profile, User, WorkoutPreference, WorkoutSession
from src.db.session import get_session
from src.mobile_api.deps import get_current_user
from src.shared.workouts import active_kcal, catalogue, workout_definition

router = APIRouter(tags=["Workouts"])


class WorkoutSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    auto_log: bool = False
    sound: bool = True


class StepResult(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    step_id: str = Field(max_length=100)
    active_seconds: float = Field(ge=0, le=1800)
    rest_seconds: float = Field(default=0, ge=0, le=3600)
    completed: bool


class SessionInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    workout_id: str = Field(max_length=64)
    catalogue_version: int = Field(ge=1)
    status: Literal["completed", "interrupted"]
    started_at: AwareDatetime
    ended_at: AwareDatetime
    timezone: str = Field(min_length=1, max_length=64)
    auto_log: bool
    steps: list[StepResult] = Field(max_length=100)

    @model_validator(mode="after")
    def check_timing(self):
        try:
            ZoneInfo(self.timezone)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Неизвестный часовой пояс")
        if self.ended_at < self.started_at:
            raise ValueError("Некорректное время занятия")
        if self.ended_at > datetime.now(timezone.utc) + timedelta(minutes=5):
            raise ValueError("Проверьте время на устройстве")
        seconds = sum(item.active_seconds + item.rest_seconds for item in self.steps)
        if seconds > (self.ended_at - self.started_at).total_seconds() + 2:
            raise ValueError("Длительность упражнений превышает время занятия")
        return self


async def lock_account(session, user_id):
    # Serializes concurrent finalization, manual linking and preference updates.
    await session.scalar(select(User).where(User.id == user_id).with_for_update())


def session_out(row):
    return dict(id=row.id, workout_id=row.workout_id, catalogue_version=row.catalogue_version,
                title=row.title, status=row.status, started_at=row.started_at.isoformat(),
                ended_at=row.ended_at.isoformat(), local_date=row.local_date.isoformat(),
                active_seconds=row.active_seconds, rest_seconds=row.rest_seconds,
                completed_steps=sum(1 for step in row.steps if step["completed"]),
                total_steps=len(workout_definition(row.catalogue_version, row.workout_id)["steps"]),
                steps=row.steps, calories=row.calories, weight_kg=row.weight_kg,
                auto_log=row.auto_log, diary_entry_id=row.diary_entry_id,
                diary_added=row.diary_added, needs_weight=row.weight_kg is None)


async def estimate(session, row):
    if row.weight_kg is None:
        weight = await session.scalar(select(Profile.weight_kg).where(Profile.user_id == row.user_id))
        if weight is not None and math.isfinite(weight) and weight > 0:
            row.weight_kg = weight
            row.calories = active_kcal(row.catalogue_version, row.steps, weight)


async def link_diary(session, row):
    if row.diary_added or row.status != "completed" or row.active_seconds <= 0:
        return
    await estimate(session, row)
    if row.calories is None:
        return
    # Do not use create_entry(): its internal commit would break atomicity.
    entry = DayEntry(user_id=row.user_id, entry_date=row.local_date, entry_type=EntryType.ACTIVITY,
                     title=f"Тренировка: {row.title} (расход ≈)", calories=row.calories,
                     duration_minutes=max(1, round(row.active_seconds / 60)))
    session.add(entry)
    await session.flush()
    row.diary_entry_id = entry.id
    row.diary_added = True  # Tombstone survives deleting the linked DayEntry.


@router.get("/workouts/catalogue")
async def get_catalogue(user: User = Depends(get_current_user)):
    return catalogue()


@router.get("/settings/workouts")
async def get_settings(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    row = await session.get(WorkoutPreference, user.id)
    return dict(auto_log=row.auto_log if row else False, sound=row.sound if row else True)


@router.put("/settings/workouts")
async def put_settings(body: WorkoutSettings, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    await lock_account(session, user.id)
    row = await session.get(WorkoutPreference, user.id)
    if row is None:
        row = WorkoutPreference(user_id=user.id)
        session.add(row)
    row.auto_log, row.sound = body.auto_log, body.sound
    await session.commit()
    return body


@router.get("/workouts/history")
async def get_history(offset: int = Query(default=0, ge=0), limit: int = Query(default=30, ge=1, le=100),
                      user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    rows = list((await session.scalars(select(WorkoutSession).where(WorkoutSession.user_id == user.id)
                .order_by(WorkoutSession.started_at.desc(), WorkoutSession.id.desc()).offset(offset).limit(limit + 1))).all())
    return dict(items=[session_out(row) for row in rows[:limit]], next_offset=offset + limit if len(rows) > limit else None)


@router.put("/workouts/sessions/{session_id}")
async def save_session(session_id: UUID, body: SessionInput, user: User = Depends(get_current_user),
                       session: AsyncSession = Depends(get_session)):
    definition = workout_definition(body.catalogue_version, body.workout_id)
    if definition is None:
        raise HTTPException(422, "Эта версия тренировки не поддерживается. Обновите каталог.")
    if len(body.steps) > len(definition["steps"]):
        raise HTTPException(422, "Некорректный список упражнений")
    normalized = []
    exercises = {item["id"]: item for item in catalogue(body.catalogue_version)["exercises"]}
    for submitted, step in zip(body.steps, definition["steps"]):
        maximum = step["duration_seconds"] or step["expected_seconds"] * 4
        if submitted.step_id != step["id"] or submitted.active_seconds > maximum + 0.1:
            raise HTTPException(422, "Упражнения не соответствуют программе")
        if submitted.completed and (submitted.active_seconds <= 0 or (
            step["duration_seconds"] and submitted.active_seconds < step["duration_seconds"] - 0.1
        )):
            raise HTTPException(422, "Упражнение завершено раньше времени")
        normalized.append(dict(**submitted.model_dump(), exercise_id=step["exercise_id"],
                               exercise_title=exercises[step["exercise_id"]]["title"]))
    if body.status == "completed" and (len(body.steps) != len(definition["steps"]) or not any(s.completed for s in body.steps)):
        raise HTTPException(422, "Занятие ещё не завершено")
    digest = hashlib.sha256(json.dumps(body.model_dump(mode="json"), sort_keys=True).encode()).hexdigest()
    await lock_account(session, user.id)
    row = await session.get(WorkoutSession, (user.id, str(session_id)))
    if row is not None:
        if row.payload_hash != digest:
            raise HTTPException(409, "Этот результат уже сохранён с другими данными")
        return session_out(row)
    row = WorkoutSession(user_id=user.id, id=str(session_id), payload_hash=digest,
        workout_id=body.workout_id, catalogue_version=body.catalogue_version, title=definition["title"],
        status=body.status, started_at=body.started_at, ended_at=body.ended_at,
        local_date=body.started_at.astimezone(ZoneInfo(body.timezone)).date(), timezone=body.timezone,
        active_seconds=sum(s.active_seconds for s in body.steps), rest_seconds=sum(s.rest_seconds for s in body.steps),
        steps=normalized, auto_log=body.auto_log, diary_added=False)
    session.add(row)
    await estimate(session, row)
    if body.auto_log:
        await link_diary(session, row)
    await session.commit()
    return session_out(row)


@router.post("/workouts/sessions/{session_id}/diary")
async def add_diary(session_id: UUID, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    await lock_account(session, user.id)
    row = await session.get(WorkoutSession, (user.id, str(session_id)))
    if row is None:
        raise HTTPException(404, "Занятие не найдено")
    if row.status != "completed" or row.active_seconds <= 0:
        raise HTTPException(409, "В дневник можно добавить завершённое занятие")
    await link_diary(session, row)
    if row.calories is None:
        raise HTTPException(422, "Укажите вес в профиле, чтобы рассчитать расход и добавить занятие в дневник")
    await session.commit()
    return session_out(row)
