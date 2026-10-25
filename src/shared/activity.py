"""Activity is derived from saved meals, without tracking menu interactions."""
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import DayEntry, EntryType


async def count_meal_active_users(
    session: AsyncSession, *, start_at: datetime, end_at: datetime
) -> int:
    # Count when the meal was saved, including entries backdated in the diary.
    count = await session.scalar(
        select(func.count(func.distinct(DayEntry.user_id))).where(
            DayEntry.entry_type == EntryType.MEAL,
            DayEntry.created_at >= start_at,
            DayEntry.created_at <= end_at,
        )
    )
    return int(count or 0)
