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

from src.db.models import DayEntry, EntryType, Profile, User, WorkoutPreference, WorkoutSession, WorkoutCourseDay
from src.db.session import get_session
from src.mobile_api.deps import get_current_user
from src.shared.workouts import CATALOGS, COURSES, active_kcal, catalogue, workout_definition
from src.shared.workout_course import COURSE_ID, required_course_steps

router = APIRouter(tags=["Workouts"])


class WorkoutSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    auto_log: bool = False
    sound: bool = True
    activity_level: Literal["light", "medium", "intense"] | None = None


class CourseCheckIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    course_id: Literal["full_body_28_v1", "full_body_home_28_v1"]
    completed_at: AwareDatetime
    timezone: str = Field(min_length=1, max_length=64)

    @model_validator(mode="after")
    def check_date(self):
        try:
            ZoneInfo(self.timezone)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Неизвестный часовой пояс")
        if self.completed_at > datetime.now(timezone.utc) + timedelta(minutes=5):
            raise ValueError("Проверьте время на устройстве")
        return self


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


async def course_progress(session, user_id, course_id=COURSE_ID):
    rows = (await session.scalars(select(WorkoutCourseDay).where(
        WorkoutCourseDay.user_id == user_id, WorkoutCourseDay.course_id == course_id
    ).order_by(WorkoutCourseDay.day))).all()
    return [dict(day=r.day, completed_at=r.completed_at.isoformat(), local_date=r.local_date.isoformat(),
                 session_id=r.session_id) for r in rows]


async def credit_course_day(session, user_id, day, completed_at, tz, session_id=None, started_at=None, *, course_id=COURSE_ID):
    previous = await course_progress(session, user_id, course_id)
    if any(item["day"] == day for item in previous):
        return True  # Retries and another device cannot advance a day twice.
    date = completed_at.astimezone(ZoneInfo(tz)).date()
    start_date = (started_at or completed_at).astimezone(ZoneInfo(tz)).date()
    if day != len(previous) + 1 or (previous and start_date.isoformat() <= previous[-1]["local_date"]):
        return False
    session.add(WorkoutCourseDay(user_id=user_id, course_id=course_id, day=day,
        completed_at=completed_at, local_date=date, session_id=session_id))
    await session.flush()
    return True


def session_out(row):
    definition = workout_definition(row.catalogue_version, row.workout_id)
    return dict(id=row.id, workout_id=row.workout_id, catalogue_version=row.catalogue_version,
                title=row.title, status=row.status, started_at=row.started_at.isoformat(),
                ended_at=row.ended_at.isoformat(), local_date=row.local_date.isoformat(),
                active_seconds=row.active_seconds, rest_seconds=row.rest_seconds,
                completed_steps=sum(1 for step in row.steps if step["completed"]),
                total_steps=len(definition["steps"]),
                steps=row.steps, calories=row.calories, weight_kg=row.weight_kg,
                auto_log=row.auto_log, diary_entry_id=row.diary_entry_id,
                diary_added=row.diary_added, needs_weight=row.weight_kg is None,
                **({"course_id": definition["course_id"], "course_variant": definition.get("course_variant")}
                   if definition.get("course_id") else {}))


async def saved_session_out(session, row):
    result = session_out(row)
    if result.get("course_id"):
        result["course_progress"] = await course_progress(session, row.user_id, result["course_id"])
    return result


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
async def get_catalogue(max_version: int = Query(default=1, ge=1), user: User = Depends(get_current_user)):
    # Old APKs keep receiving the animations they can render, even when the
    # API is released before the new APK. Histories resolve their own version.
    return catalogue(max(version for version in CATALOGS if version <= max_version))


@router.get("/settings/workouts")
async def get_settings(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    row = await session.get(WorkoutPreference, user.id)
    return dict(auto_log=row.auto_log if row else False, sound=row.sound if row else True,
                activity_level=row.activity_level if row else "medium")


@router.put("/settings/workouts")
async def put_settings(body: WorkoutSettings, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    await lock_account(session, user.id)
    row = await session.get(WorkoutPreference, user.id)
    if row is None:
        row = WorkoutPreference(user_id=user.id)
        session.add(row)
    row.auto_log, row.sound = body.auto_log, body.sound
    if body.activity_level is not None:
        row.activity_level = body.activity_level
    await session.commit()
    return dict(auto_log=row.auto_log, sound=row.sound, activity_level=row.activity_level)


@router.get("/workouts/course/progress")
async def get_course_progress(course_id: str = Query(default=COURSE_ID, max_length=64),
                              user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    if course_id not in COURSES:
        raise HTTPException(422, "Курс не найден")
    return await course_progress(session, user.id, course_id)


@router.put("/workouts/course/days/{day}")
async def complete_course_day(day: int, body: CourseCheckIn, user: User = Depends(get_current_user),
                              session: AsyncSession = Depends(get_session)):
    # Both variants have the same day kinds and share one course calendar.
    course = COURSES[body.course_id]["variants"]["female"]
    if not 1 <= day <= len(course["days"]) or course["days"][day - 1]["kind"] not in ("walk", "rest"):
        raise HTTPException(422, "Этот день завершается после прохождения занятия")
    await lock_account(session, user.id)
    if not await credit_course_day(session, user.id, day, body.completed_at, body.timezone, course_id=body.course_id):
        raise HTTPException(409, "Сначала завершите предыдущий день курса. Следующий день доступен со следующей даты.")
    await session.commit()
    return await course_progress(session, user.id, body.course_id)


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
    if body.status == "completed" and definition.get("course_id"):
        completed = {s.step_id for s in body.steps if s.completed}
        if any(s["id"] not in completed for s in required_course_steps(definition)):
            raise HTTPException(422, "Основная часть дня курса ещё не завершена")
    digest = hashlib.sha256(json.dumps(body.model_dump(mode="json"), sort_keys=True).encode()).hexdigest()
    await lock_account(session, user.id)
    row = await session.get(WorkoutSession, (user.id, str(session_id)))
    if row is not None:
        if row.payload_hash != digest:
            raise HTTPException(409, "Этот результат уже сохранён с другими данными")
        return await saved_session_out(session, row)
    row = WorkoutSession(user_id=user.id, id=str(session_id), payload_hash=digest,
        workout_id=body.workout_id, catalogue_version=body.catalogue_version, title=definition["title"],
        status=body.status, started_at=body.started_at, ended_at=body.ended_at,
        local_date=body.started_at.astimezone(ZoneInfo(body.timezone)).date(), timezone=body.timezone,
        active_seconds=sum(s.active_seconds for s in body.steps), rest_seconds=sum(s.rest_seconds for s in body.steps),
        steps=normalized, auto_log=body.auto_log, diary_added=False)
    session.add(row)
    if body.status == "completed" and definition.get("course_id") in COURSES:
        await credit_course_day(session, user.id, definition["course_day"], body.ended_at, body.timezone,
                                str(session_id), body.started_at, course_id=definition["course_id"])
    await estimate(session, row)
    if body.auto_log:
        await link_diary(session, row)
    await session.commit()
    return await saved_session_out(session, row)


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
