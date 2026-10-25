"""Authenticated weight-goal and achievement endpoints; rules live in shared services."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import User
from src.db.session import get_session
from src.mobile_api.deps import get_current_user
from src.shared.weight_tracking import (
    ReminderUnavailable, WeightGoalConflict, WeightTrackingError,
    achievements_payload, close_weight_goal, set_reminder, set_weight_goal,
)

router = APIRouter(tags=["Weight and achievements"])


class GoalInput(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    target_weight_kg: float = Field(gt=0, le=1000)
    expected_goal_id: UUID | None = None
    expected_weight_kg: float | None = Field(default=None, gt=0, le=1000)


class GoalCompleteInput(BaseModel):
    goal_id: UUID


class ReminderInput(BaseModel):
    enabled: bool
    weekday: int = Field(default=0, ge=0, le=6)
    local_time: str = Field(default="09:00", pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")


def tracking_http_error(error):
    return HTTPException(409 if isinstance(error, (WeightGoalConflict, ReminderUnavailable)) else 422, str(error))


@router.get("/achievements")
async def achievements(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await achievements_payload(session, user)


@router.put("/weight-goal")
async def put_goal(body: GoalInput, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    try:
        await set_weight_goal(session, user, body.target_weight_kg,
                              expected_goal_id=str(body.expected_goal_id) if body.expected_goal_id else None,
                              expected_weight=body.expected_weight_kg)
    except WeightTrackingError as error:
        await session.rollback()
        raise tracking_http_error(error)
    return await achievements_payload(session, user)


@router.post("/weight-goal/complete")
async def complete_goal(body: GoalCompleteInput, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    try:
        await close_weight_goal(session, user, str(body.goal_id), complete=True)
    except WeightTrackingError as error:
        await session.rollback()
        raise tracking_http_error(error)
    return await achievements_payload(session, user)


@router.delete("/weight-goal")
async def cancel_goal(goal_id: UUID = Query(...), user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    try:
        await close_weight_goal(session, user, str(goal_id), complete=False)
    except WeightTrackingError as error:
        await session.rollback()
        raise tracking_http_error(error)
    return await achievements_payload(session, user)


@router.put("/settings/weigh-in-reminder")
async def reminder(body: ReminderInput, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    try:
        return await set_reminder(session, user, **body.model_dump())
    except WeightTrackingError as error:
        await session.rollback()
        raise tracking_http_error(error)
