from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import (
    AIAnalysis,
    AnalysisType,
    DailyRequestUsage,
    DayEntry,
    EntryType,
    FavoriteMeal,
    Profile,
    User,
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

    async def get_user_by_telegram_id(self, telegram_id: int) -> User | None:
        result = await self.session.execute(select(User).where(User.telegram_id == telegram_id))
        return result.scalar_one_or_none()

    async def get_profile(self, user_id: int) -> Profile | None:
        result = await self.session.execute(select(Profile).where(Profile.user_id == user_id))
        return result.scalar_one_or_none()

    async def upsert_profile(self, user_id: int, **kwargs: Any) -> Profile:
        profile = await self.get_profile(user_id)
        if profile is None:
            profile = Profile(user_id=user_id, **kwargs)
            self.session.add(profile)
        else:
            for key, value in kwargs.items():
                setattr(profile, key, value)
        await self.session.commit()
        await self.session.refresh(profile)
        return profile

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
