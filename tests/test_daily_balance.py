from datetime import date

from src.bot.services.nutrition import calculate_daily_balance
from src.db.models import DayEntry, EntryType


def test_new_day_starts_from_entries_only():
    yesterday_entry = DayEntry(
        id=1,
        user_id=1,
        entry_date=date(2026, 6, 15),
        entry_type=EntryType.MEAL,
        title="Dinner",
        calories=900,
        protein_g=40,
        fat_g=30,
        carbs_g=80,
    )
    today_entry = DayEntry(
        id=2,
        user_id=1,
        entry_date=date(2026, 6, 16),
        entry_type=EntryType.MEAL,
        title="Breakfast",
        calories=400,
        protein_g=20,
        fat_g=10,
        carbs_g=35,
    )

    today_balance = calculate_daily_balance(2000, [today_entry])
    assert today_balance.consumed == 400
    assert today_balance.remaining == 1600

    mixed_balance = calculate_daily_balance(2000, [yesterday_entry, today_entry])
    assert mixed_balance.consumed == 1300
