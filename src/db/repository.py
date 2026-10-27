from __future__ import annotations

from sqlalchemy import delete

import secrets
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import (
    DIARY_ENTRY_TYPES,
    AIAnalysis,
    AnalysisType,
    DailyRequestUsage,
    CoachReview,
    DayEntry,
    DiaryNudge,
    EntryType,
    FavoriteMeal,
    MarketingCampaign,
    MobileLoginChallenge,
    Payment,
    Profile,
    SurveyResponse,
    User,
    WeightHistory,
)

DEFAULT_DAILY_CALORIE_TARGET = 2000.0
_REFERRAL_FALLBACK_TIMEZONE = "Europe/Moscow"


class FavoriteOrderConflict(ValueError):
    """The user changed favorites after this ordering session began."""


@dataclass(frozen=True)
class ReferralGrant:
    referrer: User
    progress: int
    goal: int
    granted: bool
    already_rewarded: bool


_USAGE_COUNT_ATTR = {
    "photo": "photo_count",
    "text": "text_count",
    "voice": "voice_count",
}


def _usage_count_attr(kind: str) -> str:
    try:
        return _USAGE_COUNT_ATTR[kind]
    except KeyError as exc:
        raise ValueError(f"Unknown request kind: {kind}") from exc


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def referral_month_window(
    timezone_name: str | None, now: datetime
) -> tuple[datetime, datetime, str]:
    """Local calendar month [start, end) and its YYYY-MM key."""
    zone = _referral_zone(timezone_name)
    local = _as_utc(now).astimezone(zone)
    start = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return start, end, f"{start.year:04d}-{start.month:02d}"


def _referral_zone(timezone_name: str | None) -> ZoneInfo:
    name = (timezone_name or "").strip() or _REFERRAL_FALLBACK_TIMEZONE
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        return ZoneInfo(_REFERRAL_FALLBACK_TIMEZONE)


def _extend_subscription(user: User, *, duration_days: int, now: datetime) -> None:
    current = _as_utc(now)
    existing = _as_utc(user.subscription_until) if user.subscription_until else None
    base = existing if existing and existing > current else current
    user.subscription_until = base + timedelta(days=duration_days)
    user.subscription_last_notified_until = None


def _mobile_login_open(challenge: MobileLoginChallenge, now: datetime) -> bool:
    if challenge.consumed_at is not None:
        return False
    return _as_utc(challenge.expires_at) > now


class UserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_or_create_user(self, telegram_id: int, timezone: str) -> User:
        result = await self.session.execute(
            select(User).where(User.telegram_id == telegram_id)
        )
        user = result.scalar_one_or_none()
        if user is None:
            user = User(telegram_id=telegram_id, timezone=timezone)
            self.session.add(user)
            await self.session.commit()
            await self.session.refresh(user)
        return user

    async def set_acquisition_source_if_empty(self, user: User, source: str) -> bool:
        """First-touch: set acquisition_source only when it is still empty."""
        if user.acquisition_source:
            return False
        user.acquisition_source = source
        await self.session.commit()
        await self.session.refresh(user)
        return True

    async def set_notifications_enabled(self, user: User, enabled: bool) -> User:
        user.notifications_enabled = enabled
        if enabled:
            from src.db.models import NotificationPreference

            preference = await self.session.get(NotificationPreference, user.id)
            if preference and preference.channel == "off":
                preference.channel = "telegram" if user.telegram_id is not None else "app"
            user.reengagement_last_sent_at = None
        await self.session.commit()
        await self.session.refresh(user)
        return user

    async def delete_user(self, user: User) -> None:
        from src.mobile_api.experience import MEDIA_ROOT
        import shutil

        user_id = user.id
        await self.session.delete(user)
        await self.session.commit()
        shutil.rmtree(MEDIA_ROOT / str(user_id), ignore_errors=True)

    async def ensure_referral_code(self, user: User) -> str:
        if user.referral_code:
            return user.referral_code

        for _ in range(10):
            candidate = secrets.token_hex(5)
            result = await self.session.execute(
                select(User.id).where(User.referral_code == candidate)
            )
            if result.scalar_one_or_none() is None:
                user.referral_code = candidate
                await self.session.commit()
                await self.session.refresh(user)
                return candidate
        raise RuntimeError("Could not generate a unique referral code")

    async def set_referrer_if_eligible(
        self,
        user: User,
        referral_code: str,
        *,
        now: datetime | None = None,
    ) -> bool:
        if (
            user.referred_by_user_id is not None
            or user.referral_reward_granted_at is not None
        ):
            return False

        current = now or datetime.now(timezone.utc)
        created_at = user.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        if created_at < current - timedelta(days=1):
            return False

        result = await self.session.execute(
            select(User).where(User.referral_code == referral_code)
        )
        referrer = result.scalar_one_or_none()
        if referrer is None or referrer.id == user.id:
            return False

        user.referred_by_user_id = referrer.id
        await self.session.commit()
        await self.session.refresh(user)
        return True

    async def referral_month_status(
        self,
        user: User,
        *,
        now: datetime | None = None,
    ) -> tuple[int, bool]:
        current = now or datetime.now(timezone.utc)
        start, end, month_key = referral_month_window(user.timezone, current)
        progress = await self._count_qualified_referrals(user.id, start, end)
        return progress, user.referral_subscription_month == month_key

    async def grant_referral_reward(
        self,
        user_id: int,
        *,
        monthly_goal: int,
        duration_days: int,
        now: datetime | None = None,
    ) -> ReferralGrant | None:
        current = now or datetime.now(timezone.utc)
        result = await self.session.execute(
            select(User).where(User.id == user_id).with_for_update()
        )
        referred_user = result.scalar_one_or_none()
        if (
            referred_user is None
            or referred_user.referred_by_user_id is None
            or referred_user.referral_reward_granted_at is not None
        ):
            return None

        referrer_result = await self.session.execute(
            select(User)
            .where(User.id == referred_user.referred_by_user_id)
            .with_for_update()
        )
        referrer = referrer_result.scalar_one_or_none()
        if referrer is None:
            return None

        referred_user.referral_reward_granted_at = current
        await self.session.flush()

        start, end, month_key = referral_month_window(referrer.timezone, current)
        progress = await self._count_qualified_referrals(referrer.id, start, end)
        already_rewarded = referrer.referral_subscription_month == month_key
        granted = progress >= monthly_goal and not already_rewarded
        if granted:
            _extend_subscription(referrer, duration_days=duration_days, now=current)
            referrer.referral_subscription_month = month_key

        await self.session.commit()
        await self.session.refresh(referrer)
        return ReferralGrant(
            referrer=referrer,
            progress=progress,
            goal=monthly_goal,
            granted=granted,
            already_rewarded=already_rewarded,
        )

    async def _count_qualified_referrals(
        self,
        referrer_id: int,
        start: datetime,
        end: datetime,
    ) -> int:
        start_utc = start.astimezone(timezone.utc)
        end_utc = end.astimezone(timezone.utc)
        result = await self.session.execute(
            select(func.count())
            .select_from(User)
            .where(
                User.referred_by_user_id == referrer_id,
                User.referral_reward_granted_at.is_not(None),
                User.referral_reward_granted_at >= start_utc,
                User.referral_reward_granted_at < end_utc,
            )
        )
        return int(result.scalar_one())

    async def try_consume_bonus_request(self, user_id: int) -> bool:
        result = await self.session.execute(
            select(User).where(User.id == user_id).with_for_update()
        )
        user = result.scalar_one_or_none()
        if user is None or int(user.bonus_requests or 0) <= 0:
            await self.session.commit()
            return False
        user.bonus_requests -= 1
        await self.session.commit()
        return True

    async def refund_bonus_request(self, user_id: int) -> None:
        result = await self.session.execute(
            select(User).where(User.id == user_id).with_for_update()
        )
        user = result.scalar_one_or_none()
        if user is None:
            await self.session.commit()
            return
        user.bonus_requests = int(user.bonus_requests or 0) + 1
        await self.session.commit()

    async def get_user_by_telegram_id(self, telegram_id: int) -> User | None:
        result = await self.session.execute(
            select(User).where(User.telegram_id == telegram_id)
        )
        return result.scalar_one_or_none()

    async def get_user_by_id(self, user_id: int) -> User | None:
        result = await self.session.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def create_mobile_login(
        self, *, ttl_seconds: int, now: datetime | None = None
    ) -> MobileLoginChallenge:
        current = now or datetime.now(timezone.utc)
        challenge = MobileLoginChallenge(
            id=str(uuid.uuid4()),
            expires_at=current + timedelta(seconds=ttl_seconds),
        )
        self.session.add(challenge)
        await self.session.commit()
        await self.session.refresh(challenge)
        return challenge

    async def attach_mobile_login(
        self,
        code: str,
        user_id: int,
        *,
        now: datetime | None = None,
    ) -> bool:
        current = now or datetime.now(timezone.utc)
        challenge = await self._lock_mobile_login(code)
        linked = (
            challenge is not None
            and _mobile_login_open(challenge, current)
            and (challenge.user_id is None or challenge.user_id == user_id)
        )
        if linked and challenge is not None:
            challenge.user_id = user_id
        await self.session.commit()
        return linked

    async def poll_mobile_login(
        self,
        code: str,
        *,
        now: datetime | None = None,
    ) -> tuple[str, int | None]:
        current = now or datetime.now(timezone.utc)
        challenge = await self._lock_mobile_login(code)
        if challenge is None:
            return "missing", None
        user_id: int | None = None
        if challenge.consumed_at is not None:
            status = "consumed"
        elif _as_utc(challenge.expires_at) <= current:
            status = "expired"
        elif challenge.user_id is None:
            status = "pending"
        else:
            challenge.consumed_at = current
            user_id = challenge.user_id
            status = "ready"
        await self.session.commit()
        return status, user_id

    async def _lock_mobile_login(self, code: str) -> MobileLoginChallenge | None:
        result = await self.session.execute(
            select(MobileLoginChallenge)
            .where(MobileLoginChallenge.id == code)
            .with_for_update()
        )
        return result.scalar_one_or_none()

    async def get_daily_request_count(self, user_id: int, usage_date: date) -> int:
        total, _, _, _ = await self.get_daily_usage_counts(user_id, usage_date)
        return total

    async def get_daily_usage_counts(
        self, user_id: int, usage_date: date
    ) -> tuple[int, int, int, int]:
        result = await self.session.execute(
            select(
                DailyRequestUsage.request_count,
                DailyRequestUsage.photo_count,
                DailyRequestUsage.text_count,
                DailyRequestUsage.voice_count,
            ).where(
                DailyRequestUsage.user_id == user_id,
                DailyRequestUsage.usage_date == usage_date,
            )
        )
        row = result.one_or_none()
        if row is None:
            return 0, 0, 0, 0
        return tuple(int(value or 0) for value in row)

    async def get_profile(self, user_id: int) -> Profile | None:
        result = await self.session.execute(
            select(Profile).where(Profile.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def ensure_default_profile(self, user_id: int) -> Profile:
        profile = await self.get_profile(user_id)
        if profile is not None:
            return profile
        return await self.upsert_profile(
            user_id,
            daily_calorie_target=DEFAULT_DAILY_CALORIE_TARGET,
        )

    async def upsert_profile(self, user_id: int, *, commit: bool = True, **kwargs: Any) -> Profile:
        from src.shared.weight_tracking import guard_profile_direction, lock_user, sync_awards, sync_goal_message

        await lock_user(self.session, user_id)
        await guard_profile_direction(self.session, user_id, kwargs.get("goal"))
        profile = await self.get_profile(user_id)
        old_weight = profile.weight_kg if profile is not None else None
        new_weight = kwargs.get("weight_kg", old_weight)
        if profile is None:
            profile = Profile(user_id=user_id, **kwargs)
            self.session.add(profile)
        else:
            for key, value in kwargs.items():
                setattr(profile, key, value)
        if new_weight is not None and (old_weight is None or old_weight != new_weight):
            measurement = WeightHistory(user_id=user_id, weight_kg=new_weight, recorded_at=datetime.now(timezone.utc))
            self.session.add(measurement)
            await self.session.flush()
            user = await self.session.get(User, user_id)
            await sync_goal_message(self.session, user, measurement_ids={f"manual:{measurement.id}"})
            await sync_awards(self.session, user)
        if commit:
            await self.session.commit()
            await self.session.refresh(profile)
        else:
            await self.session.flush()
        return profile

    async def get_weight_history(
        self,
        user_id: int,
        *,
        start_at: datetime | None = None,
        end_at: datetime | None = None,
    ) -> list[WeightHistory]:
        query = select(WeightHistory).where(WeightHistory.user_id == user_id)
        if start_at is not None:
            query = query.where(WeightHistory.recorded_at >= start_at)
        if end_at is not None:
            query = query.where(WeightHistory.recorded_at <= end_at)
        result = await self.session.execute(
            query.order_by(WeightHistory.recorded_at.asc())
        )
        return list(result.scalars().all())

    async def create_analysis(
        self,
        *,
        user_id: int,
        analysis_type: AnalysisType,
        input_text: str | None,
        image_path: str | None,
        previous_analysis_id: int | None,
        raw_response: str | None,
        parsed_json: dict[str, Any] | None,
        confidence: float | None,
    ) -> AIAnalysis:
        analysis = AIAnalysis(
            user_id=user_id,
            analysis_type=analysis_type,
            input_text=input_text,
            image_path=image_path,
            previous_analysis_id=previous_analysis_id,
            raw_response=raw_response,
            parsed_json=parsed_json,
            confidence=confidence,
        )
        self.session.add(analysis)
        await self.session.commit()
        await self.session.refresh(analysis)
        return analysis

    async def get_analysis(self, analysis_id: int) -> AIAnalysis | None:
        result = await self.session.execute(
            select(AIAnalysis).where(AIAnalysis.id == analysis_id)
        )
        return result.scalar_one_or_none()

    async def create_entry(
        self,
        *,
        user_id: int,
        entry_date: date,
        entry_type: EntryType,
        title: str,
        calories: float,
        protein_g: float = 0.0,
        fat_g: float = 0.0,
        carbs_g: float = 0.0,
        micronutrients: dict[str, Any] | None = None,
        items: list[dict[str, Any]] | None = None,
        duration_minutes: int | None = None,
        meal_slot: str | None = None,
        volume_ml: float | None = None,
        ai_analysis_id: int | None = None,
    ) -> DayEntry:
        entry = DayEntry(
            user_id=user_id,
            entry_date=entry_date,
            entry_type=entry_type,
            title=title,
            calories=calories,
            protein_g=protein_g,
            fat_g=fat_g,
            carbs_g=carbs_g,
            micronutrients=micronutrients,
            items=items,
            duration_minutes=duration_minutes,
            meal_slot=meal_slot,
            volume_ml=volume_ml,
            ai_analysis_id=ai_analysis_id,
        )
        self.session.add(entry)
        await self.session.commit()
        await self.session.refresh(entry)
        return entry

    async def get_entry(self, entry_id: int, user_id: int) -> DayEntry | None:
        result = await self.session.execute(
            select(DayEntry).where(DayEntry.id == entry_id, DayEntry.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def get_entries_for_date(
        self, user_id: int, entry_date: date
    ) -> list[DayEntry]:
        result = await self.session.execute(
            select(DayEntry)
            .where(DayEntry.user_id == user_id, DayEntry.entry_date == entry_date)
            .order_by(DayEntry.created_at.asc())
        )
        return list(result.scalars().all())

    async def get_distinct_entry_dates(self, user_id: int) -> list[date]:
        result = await self.session.execute(
            select(DayEntry.entry_date)
            .where(DayEntry.user_id == user_id)
            .distinct()
            .order_by(DayEntry.entry_date.desc())
        )
        return list(result.scalars().all())

    async def get_entry_counts_for_period(
        self, user_id: int, start_date: date, end_date: date
    ) -> dict[date, int]:
        result = await self.session.execute(
            select(DayEntry.entry_date, func.count(DayEntry.id))
            .where(
                DayEntry.user_id == user_id,
                DayEntry.entry_date >= start_date,
                DayEntry.entry_date <= end_date,
                DayEntry.entry_type.in_(DIARY_ENTRY_TYPES),
            )
            .group_by(DayEntry.entry_date)
        )
        return dict(result.all())

    async def get_entries_for_period(
        self, user_id: int, start_date: date, end_date: date
    ) -> list[DayEntry]:
        result = await self.session.execute(
            select(DayEntry)
            .where(
                DayEntry.user_id == user_id,
                DayEntry.entry_date >= start_date,
                DayEntry.entry_date <= end_date,
            )
            .order_by(DayEntry.entry_date.asc(), DayEntry.created_at.asc())
        )
        return list(result.scalars().all())

    async def get_recent_meal_entries(
        self, user_id: int, limit: int = 5
    ) -> list[DayEntry]:
        result = await self.session.execute(
            select(DayEntry)
            .where(DayEntry.user_id == user_id, DayEntry.entry_type == EntryType.MEAL)
            .order_by(DayEntry.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def update_entry(
        self,
        entry: DayEntry,
        *,
        title: str,
        calories: float,
        protein_g: float,
        fat_g: float,
        carbs_g: float,
        micronutrients: dict[str, Any] | None,
        items: list[dict[str, Any]] | None,
        ai_analysis_id: int | None,
        duration_minutes: int | None = None,
        meal_slot: str | None = None,
        volume_ml: float | None = None,
    ) -> DayEntry:
        entry.title = title
        entry.calories = calories
        entry.protein_g = protein_g
        entry.fat_g = fat_g
        entry.carbs_g = carbs_g
        entry.micronutrients = micronutrients
        entry.items = items
        entry.duration_minutes = duration_minutes
        entry.meal_slot = meal_slot
        entry.volume_ml = volume_ml
        entry.ai_analysis_id = ai_analysis_id
        await self.session.commit()
        await self.session.refresh(entry)
        return entry

    async def delete_entry(self, entry: DayEntry) -> None:
        from src.db.models import MobileOperation, MobileMedia
        from src.mobile_api.experience import media_path

        ops = list(
            (
                await self.session.scalars(
                    select(MobileOperation.id).where(
                        MobileOperation.entry_id == entry.id,
                        MobileOperation.user_id == entry.user_id,
                    )
                )
            ).all()
        )
        files = (
            list(
                (
                    await self.session.scalars(
                        select(MobileMedia.id).where(
                            MobileMedia.operation_id.in_(ops),
                            MobileMedia.user_id == entry.user_id,
                        )
                    )
                ).all()
            )
            if ops
            else []
        )
        if ops:
            await self.session.execute(
                delete(MobileMedia).where(MobileMedia.operation_id.in_(ops))
            )
            # Retain idempotency keys, but discard deleted message contents.
            await self.session.execute(
                update(MobileOperation)
                .where(MobileOperation.id.in_(ops))
                .values(payload={}, result=None, status="deleted", entry_id=None)
            )
        user_id = entry.user_id
        await self.session.delete(entry)
        await self.session.commit()
        for media_id in files:
            media_path(user_id, media_id).unlink(missing_ok=True)

    async def get_favorites(self, user_id: int) -> list[FavoriteMeal]:
        result = await self.session.execute(
            select(FavoriteMeal)
            .where(FavoriteMeal.user_id == user_id)
            .order_by(FavoriteMeal.sort_order, FavoriteMeal.created_at.desc(), FavoriteMeal.id.desc())
        )
        return list(result.scalars().all())

    async def reorder_favorites(
        self, user_id: int, favorite_ids: list[int], original_ids: list[int]
    ) -> list[FavoriteMeal]:
        if (len(set(favorite_ids)) != len(favorite_ids)
                or len(set(original_ids)) != len(original_ids)
                or set(favorite_ids) != set(original_ids)):
            raise ValueError("Передайте все записи без повторений")
        # The same lock also protects additions and removals from both clients.
        await self.session.execute(select(User.id).where(User.id == user_id).with_for_update())
        favorites = await self.get_favorites(user_id)
        current_ids = [item.id for item in favorites]
        # A retry after a lost response is safe, even if the original list is old.
        if current_ids == favorite_ids:
            await self.session.commit()
            return favorites
        if current_ids != original_ids:
            raise FavoriteOrderConflict("Избранное изменилось. Обновите список и измените порядок заново.")
        by_id = {item.id: item for item in favorites}
        ordered = [by_id[item_id] for item_id in favorite_ids]
        for position, item in enumerate(ordered):
            item.sort_order = position
        await self.session.commit()
        return ordered

    async def get_favorite(self, favorite_id: int, user_id: int) -> FavoriteMeal | None:
        result = await self.session.execute(
            select(FavoriteMeal).where(
                FavoriteMeal.id == favorite_id, FavoriteMeal.user_id == user_id
            )
        )
        return result.scalar_one_or_none()

    async def get_favorite_by_source_entry(
        self, user_id: int, entry_id: int
    ) -> FavoriteMeal | None:
        result = await self.session.execute(
            select(FavoriteMeal).where(
                FavoriteMeal.user_id == user_id,
                FavoriteMeal.source_entry_id == entry_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_favorite_ids_for_entries(
        self, user_id: int, entry_ids: list[int]
    ) -> dict[int, int]:
        if not entry_ids:
            return {}
        result = await self.session.execute(
            select(FavoriteMeal.source_entry_id, FavoriteMeal.id).where(
                FavoriteMeal.user_id == user_id,
                FavoriteMeal.source_entry_id.in_(entry_ids),
            )
        )
        return dict(result.all())

    async def create_favorite_from_entry(self, entry: DayEntry) -> FavoriteMeal:
        # Serialize duplicate clicks before checking the unique source-entry index.
        await self.session.execute(select(User.id).where(User.id == entry.user_id).with_for_update())
        existing = await self.get_favorite_by_source_entry(entry.user_id, entry.id)
        if existing is not None:
            await self.session.commit()
            return existing
        first_position = await self.session.scalar(
            select(func.min(FavoriteMeal.sort_order)).where(FavoriteMeal.user_id == entry.user_id)
        )
        favorite = FavoriteMeal(
            user_id=entry.user_id,
            source_entry_id=entry.id,
            sort_order=first_position - 1 if first_position is not None else 0,
            entry_type=entry.entry_type,
            title=entry.title,
            calories=entry.calories,
            protein_g=entry.protein_g,
            fat_g=entry.fat_g,
            carbs_g=entry.carbs_g,
            micronutrients=entry.micronutrients,
            items=entry.items,
            duration_minutes=entry.duration_minutes,
            volume_ml=entry.volume_ml,
        )
        self.session.add(favorite)
        await self.session.commit()
        await self.session.refresh(favorite)
        return favorite

    async def delete_favorite(self, favorite: FavoriteMeal) -> None:
        await self.session.execute(select(User.id).where(User.id == favorite.user_id).with_for_update())
        await self.session.delete(favorite)
        await self.session.commit()

    async def try_consume_daily_request(
        self,
        user_id: int,
        usage_date: date,
        *,
        kind: str,
        limit: int,
        shared: bool,
    ) -> bool:
        kind_attr = _usage_count_attr(kind)
        # A new usage row cannot itself be locked; use the user's existing row.
        await self.session.execute(select(User.id).where(User.id == user_id).with_for_update())
        result = await self.session.execute(
            select(DailyRequestUsage)
            .where(
                DailyRequestUsage.user_id == user_id,
                DailyRequestUsage.usage_date == usage_date,
            )
            .with_for_update()
        )
        usage = result.scalar_one_or_none()
        if usage is None:
            if limit <= 0:
                return False
            self.session.add(
                DailyRequestUsage(
                    user_id=user_id,
                    usage_date=usage_date,
                    request_count=1,
                    photo_count=1 if kind_attr == "photo_count" else 0,
                    text_count=1 if kind_attr == "text_count" else 0,
                    voice_count=1 if kind_attr == "voice_count" else 0,
                )
            )
            await self.session.commit()
            return True

        current = (
            int(usage.request_count or 0)
            if shared
            else int(getattr(usage, kind_attr) or 0)
        )
        if current >= limit:
            await self.session.commit()
            return False

        usage.request_count = int(usage.request_count or 0) + 1
        setattr(usage, kind_attr, int(getattr(usage, kind_attr) or 0) + 1)
        await self.session.commit()
        return True

    async def refund_daily_request(
        self, user_id: int, usage_date: date, *, kind: str
    ) -> None:
        kind_attr = _usage_count_attr(kind)
        result = await self.session.execute(
            select(DailyRequestUsage)
            .where(
                DailyRequestUsage.user_id == user_id,
                DailyRequestUsage.usage_date == usage_date,
            )
            .with_for_update()
        )
        usage = result.scalar_one_or_none()
        if usage is None:
            await self.session.commit()
            return
        usage.request_count = max(0, int(usage.request_count or 0) - 1)
        setattr(usage, kind_attr, max(0, int(getattr(usage, kind_attr) or 0) - 1))
        await self.session.commit()

    async def activate_subscription(
        self,
        user: User,
        *,
        duration_days: int,
        charge_id: str,
        stars_amount: int,
        now: datetime | None = None,
    ) -> User:
        # Serialize renewals and refresh the term after waiting for another payment.
        result = await self.session.execute(
            select(User)
            .where(User.id == user.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        user = result.scalar_one()
        payment = await self.session.scalar(
            select(Payment).where(Payment.telegram_payment_charge_id == charge_id)
        )
        if payment is not None:
            if payment.user_id != user.id:
                raise ValueError("Payment belongs to another user")
            await self.session.commit()
            return user
        _extend_subscription(
            user,
            duration_days=duration_days,
            now=_as_utc(now or datetime.now(timezone.utc)),
        )
        self.session.add(
            Payment(
                user_id=user.id,
                telegram_payment_charge_id=charge_id,
                stars_amount=stars_amount,
                subscription_until=user.subscription_until,
            )
        )
        await self.session.commit()
        await self.session.refresh(user)
        return user

    async def get_users_needing_renewal_reminder(
        self,
        *,
        now: datetime | None = None,
        window: timedelta | None = None,
    ) -> list[User]:
        current = now or datetime.now(timezone.utc)
        reminder_window = window or timedelta(days=1)
        result = await self.session.execute(
            select(User).where(
                User.subscription_until.is_not(None),
                User.subscription_until > current,
                User.subscription_until <= current + reminder_window,
                or_(
                    User.subscription_last_notified_until.is_(None),
                    User.subscription_last_notified_until != User.subscription_until,
                ),
            )
        )
        return list(result.scalars().all())

    async def mark_renewal_reminded(self, user: User) -> User:
        user.subscription_last_notified_until = user.subscription_until
        await self.session.commit()
        await self.session.refresh(user)
        return user

    async def get_diary_nudge_candidates(
        self,
        *,
        now: datetime | None = None,
    ) -> list[tuple[User, date]]:
        current = now or datetime.now(timezone.utc)
        utc_today = current.date()
        # entry_date is the user's local calendar day; a 5-day UTC window covers
        # evening (yesterday) and revive (3 days ago) across timezones.
        window_start = utc_today - timedelta(days=5)
        window_end = utc_today + timedelta(days=1)
        last_entry = (
            select(
                DayEntry.user_id.label("user_id"),
                func.max(DayEntry.entry_date).label("last_entry_date"),
            )
            .group_by(DayEntry.user_id)
            .subquery()
        )
        result = await self.session.execute(
            select(User, last_entry.c.last_entry_date)
            .join(last_entry, last_entry.c.user_id == User.id)
            .where(
                User.notifications_enabled.is_(True),
                last_entry.c.last_entry_date >= window_start,
                last_entry.c.last_entry_date <= window_end,
            )
        )
        return [(user, last_entry_date) for user, last_entry_date in result.all()]

    async def claim_diary_nudge(
        self,
        *,
        user_id: int,
        kind: str,
        last_entry_date: date,
        local_date: date,
        now: datetime | None = None,
    ) -> bool:
        sent_at = now or datetime.now(timezone.utc)
        stmt = (
            pg_insert(DiaryNudge)
            .values(
                user_id=user_id,
                kind=kind,
                last_entry_date=last_entry_date,
                local_date=local_date,
                sent_at=sent_at,
            )
            .on_conflict_do_nothing(constraint="uq_diary_nudges_user_kind_last_entry")
            .returning(DiaryNudge.id)
        )
        result = await self.session.execute(stmt)
        claimed = result.scalar_one_or_none() is not None
        await self.session.commit()
        return claimed

    async def get_coach_review(
        self, user_id: int, week_start: date
    ) -> CoachReview | None:
        result = await self.session.execute(
            select(CoachReview)
            .execution_options(populate_existing=True)
            .where(
                CoachReview.user_id == user_id,
                CoachReview.week_start == week_start,
            )
        )
        return result.scalar_one_or_none()

    async def save_coach_review(
        self,
        *,
        user_id: int,
        week_start: date,
        facts: dict[str, Any],
        review_text: str,
        refresh_used: bool | None,
    ) -> CoachReview:
        review = await self.get_coach_review(user_id, week_start)
        if review is None:
            review = CoachReview(
                user_id=user_id,
                week_start=week_start,
                facts=facts,
                review_text=review_text,
                refresh_used=bool(refresh_used),
            )
            self.session.add(review)
        else:
            review.facts = facts
            review.review_text = review_text
            if refresh_used is not None:
                review.refresh_used = refresh_used
        await self.session.commit()
        await self.session.refresh(review)
        return review

    async def claim_coach_push(
        self,
        *,
        user_id: int,
        week_start: date,
        now: datetime | None = None,
    ) -> bool:
        sent_at = now or datetime.now(timezone.utc)
        result = await self.session.execute(
            update(CoachReview)
            .where(
                CoachReview.user_id == user_id,
                CoachReview.week_start == week_start,
                CoachReview.push_sent_at.is_(None),
            )
            .values(push_sent_at=sent_at)
            .returning(CoachReview.id)
        )
        claimed = result.scalar_one_or_none() is not None
        await self.session.commit()
        return claimed

    async def release_coach_push(
        self, *, user_id: int, week_start: date, claimed_at: datetime
    ) -> None:
        """Allow retry after a failed send without releasing another attempt's claim."""
        await self.session.execute(
            update(CoachReview)
            .where(
                CoachReview.user_id == user_id,
                CoachReview.week_start == week_start,
                CoachReview.push_sent_at == claimed_at,
            )
            .values(push_sent_at=None)
        )
        await self.session.commit()

    async def list_coach_push_candidates(self, *, now: datetime) -> list[User]:
        result = await self.session.execute(
            select(User).where(
                User.notifications_enabled.is_(True),
                User.subscription_until.is_not(None),
                User.subscription_until > now,
            )
        )
        return list(result.scalars().all())

    async def list_marketing_campaigns(self) -> list[MarketingCampaign]:
        result = await self.session.execute(
            select(MarketingCampaign).order_by(MarketingCampaign.updated_at.desc())
        )
        return list(result.scalars().all())

    async def upsert_marketing_campaign(
        self,
        *,
        source: str,
        label: str | None,
        spend_usd: float,
        reach: int,
        notes: str | None,
    ) -> MarketingCampaign:
        result = await self.session.execute(
            select(MarketingCampaign).where(MarketingCampaign.source == source)
        )
        campaign = result.scalar_one_or_none()
        if campaign is None:
            campaign = MarketingCampaign(source=source)
            self.session.add(campaign)
        campaign.label = label
        campaign.spend_usd = spend_usd
        campaign.reach = reach
        campaign.notes = notes
        await self.session.commit()
        await self.session.refresh(campaign)
        return campaign

    async def has_survey_response(self, user_id: int) -> bool:
        result = await self.session.execute(
            select(SurveyResponse.id).where(SurveyResponse.user_id == user_id)
        )
        return result.scalar_one_or_none() is not None

    async def save_survey_response(
        self,
        user_id: int,
        *,
        app_rating: int,
        photo_rating: int | None,
        feedback_text: str | None,
    ) -> SurveyResponse:
        response = SurveyResponse(
            user_id=user_id,
            app_rating=app_rating,
            photo_rating=photo_rating,
            feedback_text=feedback_text,
        )
        self.session.add(response)
        await self.session.commit()
        await self.session.refresh(response)
        return response

    async def get_survey_stats(self) -> dict[str, Any]:
        total = await self.session.scalar(
            select(func.count()).select_from(SurveyResponse)
        )
        total = int(total or 0)
        avg_app = await self.session.scalar(select(func.avg(SurveyResponse.app_rating)))
        avg_photo = await self.session.scalar(
            select(func.avg(SurveyResponse.photo_rating)).where(
                SurveyResponse.photo_rating.is_not(None)
            )
        )
        app_distribution: dict[int, int] = {rating: 0 for rating in range(1, 6)}
        photo_distribution: dict[int, int] = {rating: 0 for rating in range(1, 6)}
        if total:
            app_rows = await self.session.execute(
                select(SurveyResponse.app_rating, func.count()).group_by(
                    SurveyResponse.app_rating
                )
            )
            for rating, count in app_rows.all():
                app_distribution[int(rating)] = int(count)
            photo_rows = await self.session.execute(
                select(SurveyResponse.photo_rating, func.count())
                .where(SurveyResponse.photo_rating.is_not(None))
                .group_by(SurveyResponse.photo_rating)
            )
            for rating, count in photo_rows.all():
                photo_distribution[int(rating)] = int(count)
        photo_skipped = await self.session.scalar(
            select(func.count())
            .select_from(SurveyResponse)
            .where(SurveyResponse.photo_rating.is_(None))
        )
        return {
            "total_responses": total,
            "avg_app_rating": float(avg_app) if avg_app is not None else None,
            "avg_photo_rating": float(avg_photo) if avg_photo is not None else None,
            "app_distribution": app_distribution,
            "photo_distribution": photo_distribution,
            "photo_skipped": int(photo_skipped or 0),
        }

    async def list_survey_responses(self) -> list[SurveyResponse]:
        result = await self.session.execute(
            select(SurveyResponse).order_by(SurveyResponse.created_at.desc())
        )
        return list(result.scalars().all())

    async def list_survey_feedback(self, *, limit: int = 50) -> list[SurveyResponse]:
        result = await self.session.execute(
            select(SurveyResponse)
            .where(
                SurveyResponse.feedback_text.is_not(None),
                SurveyResponse.feedback_text != "",
            )
            .order_by(SurveyResponse.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())
