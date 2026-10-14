from __future__ import annotations

from collections import defaultdict
from typing import Annotated
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.bot.config import settings
from src.bot.services.links import channel_url, feedback_chat_url, referral_url
from src.bot.services.nutrition import (
    calculate_daily_balance,
    calculate_daily_nutrient_targets,
    calculate_daily_target,
    calculate_logging_streak,
    local_today,
)
from src.bot.services.request_limit import has_active_subscription, request_usage_payload
from src.db.models import ActivityLevel, DIARY_ENTRY_TYPES, EntryType, Goal, Sex, User
from src.db.repository import UserRepository
from src.db.session import get_session
from src.mobile_api.analysis import AnalysisService
from src.mobile_api.deps import get_current_user
from src.mobile_api.login_codes import LOGIN_EXPIRED
from src.mobile_api.serializers import (
    balance_out,
    entry_out,
    favorite_out,
    nutrient_targets_out,
    profile_out,
    weight_out,
)
from src.mobile_api.tokens import issue_access_token

router = APIRouter()

CHECKOUT_MESSAGE = "Оплата картой появится позже"


class ProfileUpdate(BaseModel):
    weight_kg: float | None = None
    height_cm: float | None = None
    age: int | None = Field(default=None, ge=1, le=120)
    sex: Sex | None = None
    goal: Goal | None = None
    activity_level: ActivityLevel | None = None
    daily_calorie_target: float | None = Field(default=None, ge=500, le=10000)


class WeightUpdate(BaseModel):
    weight_kg: float = Field(gt=0)


class CorrectionRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class CheckoutRequest(BaseModel):
    plan: str = "monthly"


class NotificationsUpdate(BaseModel):
    enabled: bool


def _bot_url(code: str) -> str:
    username = settings.telegram_bot_username or "taarelka_bot"
    return f"https://t.me/{username}?start=app_{code}"


def _parse_day(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Дата должна быть в формате ГГГГ-ММ-ДД") from exc


async def _day_payload(repo: UserRepository, user: User, day: date) -> dict:
    profile = await repo.ensure_default_profile(user.id)
    entries = await repo.get_entries_for_date(user.id, day)
    balance = calculate_daily_balance(profile.daily_calorie_target, entries)
    dates = await repo.get_distinct_entry_dates(user.id)
    balance.streak = calculate_logging_streak(dates, local_today(user.timezone))
    targets = calculate_daily_nutrient_targets(profile)
    usage = await request_usage_payload(repo, user)
    return {
        "date": day.isoformat(),
        "balance": balance_out(balance),
        "nutrient_targets": nutrient_targets_out(targets),
        "entries": [entry_out(entry) for entry in entries],
        "profile_complete": profile.is_complete(),
        "bonus_requests": int(user.bonus_requests or 0),
        **usage,
    }


@router.post("/auth/telegram/start")
async def start_telegram_login(session: AsyncSession = Depends(get_session)) -> dict:
    repo = UserRepository(session)
    challenge = await repo.create_mobile_login(ttl_seconds=settings.mobile_login_ttl_seconds)
    return {
        "code": challenge.id,
        "bot_url": _bot_url(challenge.id),
        "expires_in": settings.mobile_login_ttl_seconds,
    }


@router.get("/auth/telegram/{code}")
async def poll_telegram_login(code: str, session: AsyncSession = Depends(get_session)):
    repo = UserRepository(session)
    status, user_id = await repo.poll_mobile_login(code)
    if status == "pending":
        return JSONResponse({"status": "pending"}, status_code=202)
    if status == "ready" and user_id is not None:
        await repo.ensure_default_profile(user_id)
        return {"access_token": issue_access_token(user_id), "token_type": "bearer"}
    if status == "missing":
        raise HTTPException(status_code=404, detail="Код входа не найден")
    raise HTTPException(status_code=410, detail=LOGIN_EXPIRED)


@router.get("/me")
async def me(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)) -> dict:
    profile = await UserRepository(session).ensure_default_profile(user.id)
    return {
        "id": user.id,
        "telegram_id": user.telegram_id,
        "timezone": user.timezone,
        "profile_complete": profile.is_complete(),
        "subscription_active": has_active_subscription(user),
        "subscription_until": user.subscription_until.isoformat() if user.subscription_until else None,
    }


@router.get("/today")
async def today(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)) -> dict:
    return await _day_payload(UserRepository(session), user, local_today(user.timezone))


@router.get("/days/{day}")
async def day_view(
    day: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    return await _day_payload(UserRepository(session), user, _parse_day(day))


@router.get("/entries/{entry_id}")
async def get_entry(
    entry_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    entry = await UserRepository(session).get_entry(entry_id, user.id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    return entry_out(entry)


@router.delete("/entries/{entry_id}", status_code=204, response_model=None)
async def delete_entry(
    entry_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    repo = UserRepository(session)
    entry = await repo.get_entry(entry_id, user.id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    await repo.delete_entry(entry)


@router.post("/entries/analyze")
async def analyze_entry(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    text: str | None = Form(None),
    image: Annotated[list[UploadFile], File()] = [],
    audio: UploadFile | None = File(None),
) -> dict:
    return await AnalysisService(session).analyze(user, text=text, image=image, audio=audio)


@router.post("/entries/{entry_id}/correct")
async def correct_entry(
    entry_id: int,
    body: CorrectionRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Опишите, что нужно исправить")
    return await AnalysisService(session).correct(user, entry_id, text)


@router.get("/favorites")
async def list_favorites(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    favorites = await UserRepository(session).get_favorites(user.id)
    return {"favorites": [favorite_out(item) for item in favorites]}


@router.post("/entries/{entry_id}/favorite")
async def favorite_entry(
    entry_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    repo = UserRepository(session)
    entry = await repo.get_entry(entry_id, user.id)
    if entry is None or entry.entry_type not in DIARY_ENTRY_TYPES:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    existing = await repo.get_favorite_by_source_entry(user.id, entry.id)
    if existing is not None:
        return {"favorite": favorite_out(existing), "created": False}
    favorite = await repo.create_favorite_from_entry(entry)
    return {"favorite": favorite_out(favorite), "created": True}


@router.post("/favorites/{favorite_id}/log")
async def log_favorite(
    favorite_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from src.bot.services.entry_service import EntryService

    repo = UserRepository(session)
    await repo.ensure_default_profile(user.id)
    favorite = await repo.get_favorite(favorite_id, user.id)
    if favorite is None:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    service = EntryService(session)
    if favorite.entry_type == EntryType.ACTIVITY:
        entry, balance = await service.save_activity_from_favorite(user=user, favorite=favorite)
    elif favorite.entry_type == EntryType.WATER:
        entry, balance = await service.save_water_from_favorite(user=user, favorite=favorite)
    else:
        entry, balance = await service.save_meal_from_favorite(user=user, favorite=favorite)
    return {"entry": entry_out(entry), "balance": balance_out(balance)}


@router.delete("/favorites/{favorite_id}", status_code=204, response_model=None)
async def delete_favorite(
    favorite_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    repo = UserRepository(session)
    favorite = await repo.get_favorite(favorite_id, user.id)
    if favorite is None:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    await repo.delete_favorite(favorite)


@router.get("/profile")
async def get_profile(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    profile = await UserRepository(session).ensure_default_profile(user.id)
    return profile_out(profile)


@router.put("/profile")
async def update_profile(
    body: ProfileUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    repo = UserRepository(session)
    profile = await repo.ensure_default_profile(user.id)
    payload = {
        key: value
        for key, value in body.model_dump(exclude_unset=True).items()
        if value is not None
    }
    if "weight_kg" in payload and payload["weight_kg"] <= 0:
        raise HTTPException(status_code=422, detail="Введите корректный вес в кг")
    if "height_cm" in payload and payload["height_cm"] <= 0:
        raise HTTPException(status_code=422, detail="Введите корректный рост в см")

    was_complete = profile.is_complete()
    data = {
        "weight_kg": profile.weight_kg,
        "height_cm": profile.height_cm,
        "age": profile.age,
        "sex": profile.sex,
        "goal": profile.goal,
        "activity_level": profile.activity_level,
        "daily_calorie_target": profile.daily_calorie_target,
    }
    data.update(payload)
    becoming_complete = all(
        data[key] is not None
        for key in ("weight_kg", "height_cm", "age", "sex", "goal", "activity_level")
    )
    if "daily_calorie_target" not in payload and not was_complete and becoming_complete:
        data["daily_calorie_target"] = calculate_daily_target(
            weight_kg=data["weight_kg"],
            height_cm=data["height_cm"],
            age=data["age"],
            sex=data["sex"],
            goal=data["goal"],
            activity_level=data["activity_level"],
        )
    saved = await repo.upsert_profile(user.id, **data)
    return profile_out(saved)


@router.get("/weight")
async def weight_history(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    records = await UserRepository(session).get_weight_history(user.id)
    return {"weight": [weight_out(record) for record in records]}


@router.post("/weight")
async def update_weight(
    body: WeightUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    repo = UserRepository(session)
    await repo.ensure_default_profile(user.id)
    saved = await repo.upsert_profile(user.id, weight_kg=body.weight_kg)
    return profile_out(saved)


@router.get("/stats")
async def stats(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    start: str | None = None,
    end: str | None = None,
) -> dict:
    repo = UserRepository(session)
    profile = await repo.ensure_default_profile(user.id)
    today = local_today(user.timezone)
    end_date = _parse_day(end) if end else today
    start_date = _parse_day(start) if start else end_date - timedelta(days=29)
    if start_date > end_date:
        raise HTTPException(status_code=400, detail="Начало периода позже конца")

    entries = await repo.get_entries_for_period(user.id, start_date, end_date)
    calories_by_date: dict[date, float] = defaultdict(float)
    protein_by_date: dict[date, float] = defaultdict(float)
    fat_by_date: dict[date, float] = defaultdict(float)
    carbs_by_date: dict[date, float] = defaultdict(float)
    for entry in entries:
        if entry.entry_type != EntryType.MEAL:
            continue
        calories_by_date[entry.entry_date] += entry.calories
        protein_by_date[entry.entry_date] += entry.protein_g
        fat_by_date[entry.entry_date] += entry.fat_g
        carbs_by_date[entry.entry_date] += entry.carbs_g

    days_count = (end_date - start_date).days + 1
    days = []
    for offset in range(days_count):
        day = start_date + timedelta(days=offset)
        days.append(
            {
                "date": day.isoformat(),
                "calories": calories_by_date[day],
                "protein_g": protein_by_date[day],
                "fat_g": fat_by_date[day],
                "carbs_g": carbs_by_date[day],
            }
        )
    nonempty = [day["calories"] for day in days if day["calories"] > 0]
    total = sum(day["calories"] for day in days)
    try:
        zone = ZoneInfo(user.timezone)
    except ZoneInfoNotFoundError:
        zone = ZoneInfo("UTC")
    start_at = datetime.combine(start_date, datetime.min.time(), tzinfo=zone)
    end_at = datetime.combine(end_date, datetime.max.time(), tzinfo=zone)
    weight = await repo.get_weight_history(user.id, start_at=start_at, end_at=end_at)
    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "daily_calorie_target": profile.daily_calorie_target,
        "total_calories": total,
        "average_calories": (total / len(nonempty)) if nonempty else 0,
        "days": days,
        "weight": [weight_out(record) for record in weight],
    }


@router.get("/subscription")
async def subscription(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    repo = UserRepository(session)
    usage = await request_usage_payload(repo, user)
    return {
        "active": has_active_subscription(user),
        "until": user.subscription_until.isoformat() if user.subscription_until else None,
        "bonus_requests": int(user.bonus_requests or 0),
        **usage,
    }


@router.post("/billing/checkout")
async def checkout(body: CheckoutRequest, user: User = Depends(get_current_user)) -> dict:
    del body, user
    return {"status": "unavailable", "message": CHECKOUT_MESSAGE}


@router.get("/settings")
async def account_settings(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    repo = UserRepository(session)
    code = await repo.ensure_referral_code(user)
    progress, rewarded = await repo.referral_month_status(user)
    return {
        "notifications_enabled": bool(user.notifications_enabled),
        "referral_url": referral_url(code),
        "bonus_requests": int(user.bonus_requests or 0),
        "referral_monthly_goal": settings.referral_monthly_goal,
        "referral_progress": progress,
        "referral_rewarded_this_month": rewarded,
        "support_email": settings.support_email,
        "channel_url": channel_url(),
        "feedback_url": feedback_chat_url(),
    }


@router.put("/settings/notifications")
async def update_notifications(
    body: NotificationsUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    updated = await UserRepository(session).set_notifications_enabled(user, body.enabled)
    return {"notifications_enabled": bool(updated.notifications_enabled)}


@router.delete("/account", status_code=204, response_model=None)
async def delete_account(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await UserRepository(session).delete_user(user)
