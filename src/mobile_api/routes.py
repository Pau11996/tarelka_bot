from __future__ import annotations

from collections import defaultdict
from calendar import monthrange
from datetime import date, datetime, timedelta
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, update
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
from src.bot.services.request_limit import (
    has_active_subscription,
    request_usage_payload,
)
from src.db.models import (
    DIARY_ENTRY_TYPES,
    ActivityLevel,
    EntryType,
    Goal,
    MobileMedia,
    MobileOperation,
    NotificationPreference,
    Sex,
    User,
)
from src.db.repository import FavoriteOrderConflict, UserRepository
from src.db.session import get_session
from src.mobile_api.analysis import AnalysisService
from src.mobile_api.deps import get_current_user
from src.mobile_api.login_codes import LOGIN_EXPIRED
from src.mobile_api.serializers import (
    analysis_out,
    balance_out,
    entry_out,
    favorite_out,
    nutrient_targets_out,
    profile_out,
    weight_out,
)
from src.mobile_api.statistics import chart_facts
from src.mobile_api.request_limits import request_limit_info
from src.mobile_api.tokens import issue_access_token
from src.mobile_api.health import router as health_router, health_payload, health_weight
from src.mobile_api.weight import router as weight_router, tracking_http_error
from src.shared.weight_tracking import (
    WeightTrackingError, active_goal, direction_for, goal_out,
    current_weight, record_weight, set_weight_goal,
)

router = APIRouter()
router.include_router(health_router)
router.include_router(weight_router)

CHECKOUT_MESSAGE = "Оплата картой появится позже"


class ProfileUpdate(BaseModel):
    weight_kg: float | None = Field(default=None, gt=0, le=1000, allow_inf_nan=False)
    height_cm: float | None = None
    age: int | None = Field(default=None, ge=1, le=120)
    sex: Sex | None = None
    goal: Goal | None = None
    activity_level: ActivityLevel | None = None
    daily_calorie_target: float | None = Field(default=None, ge=500, le=10000)
    target_weight_kg: float | None = Field(default=None, gt=0, le=1000, allow_inf_nan=False)


class WeightUpdate(BaseModel):
    weight_kg: float = Field(gt=0, le=1000, allow_inf_nan=False)
    operation_id: str | None = Field(default=None, min_length=1, max_length=120, pattern=r"^[A-Za-z0-9_-]+$")


class CorrectionRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class FavoriteOrderRequest(BaseModel):
    favorite_ids: list[Annotated[int, Field(strict=True, gt=0)]]
    original_ids: list[Annotated[int, Field(strict=True, gt=0)]]


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
        raise HTTPException(
            status_code=400, detail="Дата должна быть в формате ГГГГ-ММ-ДД"
        ) from exc


async def _day_payload(repo: UserRepository, user: User, day: date) -> dict:
    profile = await repo.ensure_default_profile(user.id)
    entries = await repo.get_entries_for_date(user.id, day)
    favorite_ids = await repo.get_favorite_ids_for_entries(user.id, [e.id for e in entries])
    balance = calculate_daily_balance(profile.daily_calorie_target, entries)
    dates = await repo.get_distinct_entry_dates(user.id)
    balance.streak = calculate_logging_streak(dates, local_today(user.timezone))
    targets = calculate_daily_nutrient_targets(profile)
    usage = await request_usage_payload(repo, user)
    return {
        "date": day.isoformat(),
        "entry_dates": [value.isoformat() for value in sorted(dates)],
        "balance": balance_out(balance),
        "nutrient_targets": nutrient_targets_out(targets),
        "entries": [entry_out(entry, favorite_id=favorite_ids.get(entry.id)) for entry in entries],
        "health": await health_payload(repo.session, user, day, day),
        "profile_complete": profile.is_complete(),
        "bonus_requests": int(user.bonus_requests or 0),
        **usage,
    }


@router.post("/auth/telegram/start")
async def start_telegram_login(session: AsyncSession = Depends(get_session)) -> dict:
    repo = UserRepository(session)
    challenge = await repo.create_mobile_login(
        ttl_seconds=settings.mobile_login_ttl_seconds
    )
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
async def me(
    user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> dict:
    profile = await UserRepository(session).ensure_default_profile(user.id)
    return {
        "id": user.id,
        "telegram_id": user.telegram_id,
        "email": user.email,
        "auth_method": "telegram" if user.telegram_id is not None else "email",
        "timezone": user.timezone,
        "timezone": user.timezone,
        "profile_complete": profile.is_complete(),
        "subscription_active": has_active_subscription(user),
        "subscription_until": user.subscription_until.isoformat()
        if user.subscription_until
        else None,
    }


@router.get("/today")
async def today(
    user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> dict:
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
    repo = UserRepository(session)
    entry = await repo.get_entry(entry_id, user.id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    analysis = await repo.get_analysis(entry.ai_analysis_id) if entry.ai_analysis_id else None
    favorite = await repo.get_favorite_by_source_entry(user.id, entry.id)
    media = list(
        (
            await session.scalars(
                select(MobileMedia)
                .join(MobileOperation, MobileMedia.operation_id == MobileOperation.id)
                .where(
                    MobileOperation.entry_id == entry.id,
                    MobileOperation.user_id == user.id,
                    MobileMedia.user_id == user.id,
                )
                .order_by(MobileMedia.created_at, MobileMedia.id)
            )
        ).all()
    )
    return {
        **entry_out(entry, favorite_id=favorite.id if favorite else None),
        "analysis": analysis_out(analysis)
        if analysis is not None and analysis.user_id == user.id
        else None,
        "media": [
            {"id": item.id, "mime": item.mime, "url": f"/v1/media/{item.id}"}
            for item in media
        ],
    }


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
    await session.execute(
        update(MobileOperation)
        .where(MobileOperation.user_id == user.id, MobileOperation.entry_id == entry.id)
        .values(result=None)
    )
    await repo.delete_entry(entry)


@router.post("/entries/analyze")
async def analyze_entry(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    text: str | None = Form(None),
    image: Annotated[list[UploadFile], File()] = [],
    audio: UploadFile | None = File(None),
    operation_id: str | None = Form(None, min_length=1, max_length=120, pattern=r"^[A-Za-z0-9_-]+$"),
) -> dict:
    return await AnalysisService(session).analyze(
        user, text=text, image=image, audio=audio,
    )


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


@router.put("/favorites/order")
async def reorder_favorites(
    body: FavoriteOrderRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    try:
        favorites = await UserRepository(session).reorder_favorites(
            user.id, body.favorite_ids, body.original_ids
        )
    except FavoriteOrderConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
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
    from src.mobile_api.favorites import latest_correction

    repo = UserRepository(session)
    await repo.ensure_default_profile(user.id)
    favorite = await repo.get_favorite(favorite_id, user.id)
    if favorite is None:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    correction = await latest_correction(session, user.id, favorite_id)
    if correction and correction.status in ("queued", "running"):
        raise HTTPException(409, "Избранное уточняется. Дождитесь результата перед добавлением.")
    service = EntryService(session)
    if favorite.entry_type == EntryType.ACTIVITY:
        entry, balance = await service.save_activity_from_favorite(
            user=user, favorite=favorite
        )
    elif favorite.entry_type == EntryType.WATER:
        entry, balance = await service.save_water_from_favorite(
            user=user, favorite=favorite
        )
    else:
        entry, balance = await service.save_meal_from_favorite(
            user=user, favorite=favorite
        )
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
    goal = await active_goal(session, user.id)
    return {**profile_out(profile), "weight_goal": goal_out(goal, await current_weight(session, user)) if goal else None}


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
    target_weight = data.pop("target_weight_kg", None)
    if target_weight is not None and was_complete:
        previous = await active_goal(session, user.id)
        if previous and previous.target_weight_kg == target_weight:
            # A retry of the initial form must not replay stale profile fields.
            return {**profile_out(profile), "weight_goal": goal_out(previous, await current_weight(session, user))}
        raise HTTPException(409, "Измените цель по весу в «Прогрессе».")
    if target_weight is not None and not was_complete and data["weight_kg"] is not None:
        data["goal"] = Goal(direction_for(data["weight_kg"], target_weight))
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
    try:
        if target_weight is not None and not was_complete:
            if not becoming_complete:
                raise WeightTrackingError("Заполните основные данные перед сохранением цели.")
            saved = await repo.upsert_profile(user.id, commit=False, **data)
            previous = await active_goal(session, user.id)
            await set_weight_goal(session, user, target_weight, expected_goal_id=previous.id if previous else None,
                                  start_weight=data["weight_kg"], commit=False)
            await session.commit()
        else:
            saved = await repo.upsert_profile(user.id, **data)
    except WeightTrackingError as error:
        await session.rollback()
        raise tracking_http_error(error)
    goal = await active_goal(session, user.id)
    return {**profile_out(saved), "weight_goal": goal_out(goal, await current_weight(session, user)) if goal else None}


@router.get("/weight")
async def weight_history(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    records = await UserRepository(session).get_weight_history(user.id)
    imported = await health_weight(session, user)
    combined = [{**weight_out(record), "source": "manual"} for record in records] + imported
    return {"weight": sorted(combined, key=lambda record: record["recorded_at"])}


@router.post("/weight")
async def update_weight(
    body: WeightUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    repo = UserRepository(session)
    await repo.ensure_default_profile(user.id)
    from uuid import uuid4
    try:
        await record_weight(session, user, body.weight_kg, operation_key=f"app:{body.operation_id or uuid4()}")
    except WeightTrackingError as error:
        await session.rollback()
        raise tracking_http_error(error)
    saved = await repo.get_profile(user.id)
    return profile_out(saved)


@router.get("/stats/calendar")
async def statistics_calendar(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    month: str | None = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
) -> dict:
    today = local_today(user.timezone)
    start = _parse_day(f"{month}-01") if month else today.replace(day=1)
    end = start.replace(day=monthrange(start.year, start.month)[1])
    counts = await UserRepository(session).get_entry_counts_for_period(user.id, start, end)
    return {
        "month": start.strftime("%Y-%m"),
        "today": today.isoformat(),
        "days": [
            {"date": (start + timedelta(days=offset)).isoformat(), "entry_count": counts.get(start + timedelta(days=offset), 0)}
            for offset in range((end - start).days + 1)
        ],
    }


@router.get("/stats")
async def stats(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    start: str | None = None,
    end: str | None = None,
    days: int = Query(30, ge=1, le=366),
) -> dict:
    repo = UserRepository(session)
    profile = await repo.ensure_default_profile(user.id)
    today = local_today(user.timezone)
    end_date = _parse_day(end) if end else today
    start_date = _parse_day(start) if start else end_date - timedelta(days=days - 1)
    if start_date > end_date:
        raise HTTPException(status_code=400, detail="Начало периода позже конца")

    if (end_date - start_date).days > 365:
        raise HTTPException(status_code=422, detail="Выберите период не больше года")
    if not has_active_subscription(user) and (end_date - start_date).days > 29:
        raise HTTPException(
            status_code=403, detail="Расширенная статистика входит в подписку"
        )
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
    health = await health_payload(session, user, start_date, end_date)
    imported_weight = await health_weight(session, user, start_at, end_at)
    combined_weight = [
        {**weight_out(record), "source": "manual", "local_date": record.recorded_at.astimezone(zone).date().isoformat()}
        for record in weight
    ] + imported_weight
    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "profile_complete": profile.is_complete(),
        "daily_calorie_target": profile.daily_calorie_target,
        "total_calories": total,
        "average_calories": (total / len(nonempty)) if nonempty else 0,
        "days": days,
        "weight": sorted(combined_weight, key=lambda record: record["recorded_at"]),
        "health": health,
        **chart_facts(
            entries, profile, start_date, end_date, has_active_subscription(user)
        ),
    }


@router.get("/request-limits")
async def request_limits(
    kind: Literal["photo", "text", "voice"],
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    return await request_limit_info(UserRepository(session), user, kind)


@router.get("/subscription")
async def subscription(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    repo = UserRepository(session)
    usage = await request_usage_payload(repo, user)
    return {
        "active": has_active_subscription(user),
        "until": user.subscription_until.isoformat()
        if user.subscription_until
        else None,
        "bonus_requests": int(user.bonus_requests or 0),
        **usage,
    }


@router.post("/billing/checkout")
async def checkout(
    body: CheckoutRequest, user: User = Depends(get_current_user)
) -> dict:
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
    pref = await session.get(NotificationPreference, user.id)
    return {
        "auth_method": "telegram" if user.telegram_id is not None else "email",
        "email": user.email,
        "telegram_connected": user.telegram_id is not None,
        "notification_channel": (pref.channel if pref else ("telegram" if user.telegram_id is not None else "app"))
        if user.notifications_enabled
        else "off",
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
    updated = await UserRepository(session).set_notifications_enabled(
        user, body.enabled
    )
    return {"notifications_enabled": bool(updated.notifications_enabled)}


@router.delete("/account", status_code=204, response_model=None)
async def delete_account(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await UserRepository(session).delete_user(user)
