from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.bot.services.nutrition import calculate_daily_balance, local_today
from src.db.models import AnalysisType, DayEntry, EntryType, FavoriteMeal, User
from src.db.repository import UserRepository
from src.shared.schemas import AnalysisResult


class EntryService:
    def __init__(self, session: AsyncSession) -> None:
        self.repo = UserRepository(session)

    async def get_balance(self, user: User) -> tuple[float, object]:
        profile = await self.repo.get_profile(user.id)
        if profile is None:
            raise ValueError("Profile not found")
        today = local_today(user.timezone)
        entries = await self.repo.get_entries_for_date(user.id, today)
        balance = calculate_daily_balance(profile.daily_calorie_target, entries)
        return profile.daily_calorie_target, balance

    async def save_meal_from_analysis(
        self,
        *,
        user: User,
        analysis_type: AnalysisType,
        input_text: str | None,
        image_path: str | None,
        raw_response: str,
        result: AnalysisResult,
        previous_analysis_id: int | None = None,
    ) -> tuple[DayEntry, object]:
        profile = await self.repo.get_profile(user.id)
        if profile is None:
            raise ValueError("Profile not found")

        analysis = await self.repo.create_analysis(
            user_id=user.id,
            analysis_type=analysis_type,
            input_text=input_text,
            image_path=image_path,
            previous_analysis_id=previous_analysis_id,
            raw_response=raw_response,
            parsed_json=result.model_dump(),
            confidence=result.confidence,
        )

        entry = await self.repo.create_entry(
            user_id=user.id,
            entry_date=local_today(user.timezone),
            entry_type=EntryType.MEAL,
            title=result.title or "Прием пищи",
            calories=result.total_calories,
            protein_g=result.protein_g,
            fat_g=result.fat_g,
            carbs_g=result.carbs_g,
            micronutrients=result.micronutrients,
            items=[item.model_dump() for item in result.items],
            ai_analysis_id=analysis.id,
        )

        entries = await self.repo.get_entries_for_date(user.id, entry.entry_date)
        balance = calculate_daily_balance(profile.daily_calorie_target, entries)
        return entry, balance

    async def save_activity_from_analysis(
        self,
        *,
        user: User,
        analysis_type: AnalysisType,
        input_text: str | None,
        image_path: str | None,
        raw_response: str,
        result: AnalysisResult,
    ) -> tuple[DayEntry, object]:
        profile = await self.repo.get_profile(user.id)
        if profile is None:
            raise ValueError("Profile not found")

        analysis = await self.repo.create_analysis(
            user_id=user.id,
            analysis_type=analysis_type,
            input_text=input_text,
            image_path=image_path,
            previous_analysis_id=None,
            raw_response=raw_response,
            parsed_json=result.model_dump(),
            confidence=result.confidence,
        )

        entry = await self.repo.create_entry(
            user_id=user.id,
            entry_date=local_today(user.timezone),
            entry_type=EntryType.ACTIVITY,
            title=result.title or "Активность",
            calories=result.total_calories,
            duration_minutes=result.duration_minutes,
            ai_analysis_id=analysis.id,
        )

        entries = await self.repo.get_entries_for_date(user.id, entry.entry_date)
        balance = calculate_daily_balance(profile.daily_calorie_target, entries)
        return entry, balance

    async def update_meal_from_correction(
        self,
        *,
        user: User,
        entry: DayEntry,
        correction_text: str,
        raw_response: str,
        result: AnalysisResult,
        image_path: str | None = None,
    ) -> object:
        profile = await self.repo.get_profile(user.id)
        if profile is None:
            raise ValueError("Profile not found")

        previous_analysis_id = entry.ai_analysis_id
        analysis = await self.repo.create_analysis(
            user_id=user.id,
            analysis_type=AnalysisType.CORRECTION,
            input_text=correction_text,
            image_path=image_path,
            previous_analysis_id=previous_analysis_id,
            raw_response=raw_response,
            parsed_json=result.model_dump(),
            confidence=result.confidence,
        )

        await self.repo.update_entry(
            entry,
            title=result.title or entry.title,
            calories=result.total_calories,
            protein_g=result.protein_g,
            fat_g=result.fat_g,
            carbs_g=result.carbs_g,
            micronutrients=result.micronutrients,
            items=[item.model_dump() for item in result.items],
            duration_minutes=entry.duration_minutes,
            ai_analysis_id=analysis.id,
        )

        entries = await self.repo.get_entries_for_date(user.id, entry.entry_date)
        return calculate_daily_balance(profile.daily_calorie_target, entries)

    async def update_activity_from_correction(
        self,
        *,
        user: User,
        entry: DayEntry,
        correction_text: str,
        raw_response: str,
        result: AnalysisResult,
        image_path: str | None = None,
    ) -> object:
        profile = await self.repo.get_profile(user.id)
        if profile is None:
            raise ValueError("Profile not found")

        previous_analysis_id = entry.ai_analysis_id
        analysis = await self.repo.create_analysis(
            user_id=user.id,
            analysis_type=AnalysisType.CORRECTION,
            input_text=correction_text,
            image_path=image_path,
            previous_analysis_id=previous_analysis_id,
            raw_response=raw_response,
            parsed_json=result.model_dump(),
            confidence=result.confidence,
        )

        await self.repo.update_entry(
            entry,
            title=result.title or entry.title,
            calories=result.total_calories,
            protein_g=0.0,
            fat_g=0.0,
            carbs_g=0.0,
            micronutrients=None,
            items=None,
            duration_minutes=result.duration_minutes,
            ai_analysis_id=analysis.id,
        )

        entries = await self.repo.get_entries_for_date(user.id, entry.entry_date)
        return calculate_daily_balance(profile.daily_calorie_target, entries)

    async def save_meal_from_favorite(
        self,
        *,
        user: User,
        favorite: FavoriteMeal,
    ) -> tuple[DayEntry, object]:
        profile = await self.repo.get_profile(user.id)
        if profile is None:
            raise ValueError("Profile not found")

        entry = await self.repo.create_entry(
            user_id=user.id,
            entry_date=local_today(user.timezone),
            entry_type=EntryType.MEAL,
            title=favorite.title,
            calories=favorite.calories,
            protein_g=favorite.protein_g,
            fat_g=favorite.fat_g,
            carbs_g=favorite.carbs_g,
            micronutrients=favorite.micronutrients,
            items=favorite.items,
        )

        entries = await self.repo.get_entries_for_date(user.id, entry.entry_date)
        balance = calculate_daily_balance(profile.daily_calorie_target, entries)
        return entry, balance

    async def save_activity_from_favorite(
        self,
        *,
        user: User,
        favorite: FavoriteMeal,
    ) -> tuple[DayEntry, object]:
        profile = await self.repo.get_profile(user.id)
        if profile is None:
            raise ValueError("Profile not found")

        entry = await self.repo.create_entry(
            user_id=user.id,
            entry_date=local_today(user.timezone),
            entry_type=EntryType.ACTIVITY,
            title=favorite.title,
            calories=favorite.calories,
            duration_minutes=favorite.duration_minutes,
        )

        entries = await self.repo.get_entries_for_date(user.id, entry.entry_date)
        balance = calculate_daily_balance(profile.daily_calorie_target, entries)
        return entry, balance

    async def save_activity_from_favorite(
        self,
        *,
        user: User,
        favorite: FavoriteMeal,
    ) -> tuple[DayEntry, object]:
        profile = await self.repo.get_profile(user.id)
        if profile is None:
            raise ValueError("Profile not found")

        entry = await self.repo.create_entry(
            user_id=user.id,
            entry_date=local_today(user.timezone),
            entry_type=EntryType.ACTIVITY,
            title=favorite.title,
            calories=favorite.calories,
            duration_minutes=favorite.duration_minutes,
        )

        entries = await self.repo.get_entries_for_date(user.id, entry.entry_date)
        balance = calculate_daily_balance(profile.daily_calorie_target, entries)
        return entry, balance
