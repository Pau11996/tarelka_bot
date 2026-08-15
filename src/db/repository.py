from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import (
    AIAnalysis,
    AnalysisType,
    DailyRequestUsage,
    DayEntry,
    EntryType,
    FavoriteMeal,
    Payment,
    Profile,
    User,
    WeightHistory,
)


class UserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_or_create_user(self, telegram_id: int, timezone: str) -> User:
        result = await self.session.execute(select(User).where(User.telegram_id == telegram_id))
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

    async def get_user_by_telegram_id(self, telegram_id: int) -> User | None:
        result = await self.session.execute(select(User).where(User.telegram_id == telegram_id))
        return result.scalar_one_or_none()

    async def get_profile(self, user_id: int) -> Profile | None:
        result = await self.session.execute(select(Profile).where(Profile.user_id == user_id))
        return result.scalar_one_or_none()

    async def upsert_profile(self, user_id: int, **kwargs: Any) -> Profile:
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
            self.session.add(WeightHistory(user_id=user_id, weight_kg=new_weight))
        await self.session.commit()
        await self.session.refresh(profile)
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
        result = await self.session.execute(query.order_by(WeightHistory.recorded_at.asc()))
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
        result = await self.session.execute(select(AIAnalysis).where(AIAnalysis.id == analysis_id))
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

    async def get_entries_for_date(self, user_id: int, entry_date: date) -> list[DayEntry]:
        result = await self.session.execute(
            select(DayEntry)
            .where(DayEntry.user_id == user_id, DayEntry.entry_date == entry_date)
            .order_by(DayEntry.created_at.asc())
        )
        return list(result.scalars().all())

    async def get_entries_for_period(self, user_id: int, start_date: date, end_date: date) -> list[DayEntry]:
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

    async def get_recent_meal_entries(self, user_id: int, limit: int = 5) -> list[DayEntry]:
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
    ) -> DayEntry:
        entry.title = title
        entry.calories = calories
        entry.protein_g = protein_g
        entry.fat_g = fat_g
        entry.carbs_g = carbs_g
        entry.micronutrients = micronutrients
        entry.items = items
        entry.duration_minutes = duration_minutes
        entry.ai_analysis_id = ai_analysis_id
        await self.session.commit()
        await self.session.refresh(entry)
        return entry

    async def delete_entry(self, entry: DayEntry) -> None:
        await self.session.delete(entry)
        await self.session.commit()

    async def get_favorites(self, user_id: int) -> list[FavoriteMeal]:
        result = await self.session.execute(
            select(FavoriteMeal)
            .where(FavoriteMeal.user_id == user_id)
            .order_by(FavoriteMeal.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_favorite(self, favorite_id: int, user_id: int) -> FavoriteMeal | None:
        result = await self.session.execute(
            select(FavoriteMeal).where(FavoriteMeal.id == favorite_id, FavoriteMeal.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def get_favorite_by_source_entry(self, user_id: int, entry_id: int) -> FavoriteMeal | None:
        result = await self.session.execute(
            select(FavoriteMeal).where(
                FavoriteMeal.user_id == user_id,
                FavoriteMeal.source_entry_id == entry_id,
            )
        )
        return result.scalar_one_or_none()

    async def create_favorite_from_entry(self, entry: DayEntry) -> FavoriteMeal:
        favorite = FavoriteMeal(
            user_id=entry.user_id,
            source_entry_id=entry.id,
            entry_type=entry.entry_type,
            title=entry.title,
            calories=entry.calories,
            protein_g=entry.protein_g,
            fat_g=entry.fat_g,
            carbs_g=entry.carbs_g,
            micronutrients=entry.micronutrients,
            items=entry.items,
            duration_minutes=entry.duration_minutes,
        )
        self.session.add(favorite)
        await self.session.commit()
        await self.session.refresh(favorite)
        return favorite

    async def delete_favorite(self, favorite: FavoriteMeal) -> None:
        await self.session.delete(favorite)
        await self.session.commit()

    async def try_consume_daily_request(self, user_id: int, usage_date: date, limit: int) -> bool:
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
                )
            )
            await self.session.commit()
            return True

        if usage.request_count >= limit:
            await self.session.commit()
            return False

        usage.request_count += 1
        await self.session.commit()
        return True

    async def activate_subscription(
        self,
        user: User,
        *,
        duration_days: int,
        charge_id: str,
        stars_amount: int,
        now: datetime | None = None,
    ) -> User:
        current = now or datetime.now(timezone.utc)
        base = user.subscription_until if user.subscription_until and user.subscription_until > current else current
        new_until = base + timedelta(days=duration_days)
        user.subscription_until = new_until
        user.subscription_last_notified_until = None
        self.session.add(
            Payment(
                user_id=user.id,
                telegram_payment_charge_id=charge_id,
                stars_amount=stars_amount,
                subscription_until=new_until,
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
