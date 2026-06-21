from datetime import date

from src.bot.handlers.statistics import _format_month_caption, _parse_date
from src.bot.services.charts import DailyCaloriesPoint


def test_parse_date_strips_spaces_and_dots() -> None:
    assert _parse_date("  18.06.2026  ") == date(2026, 6, 18)
    assert _parse_date(".18.06.2026.") == date(2026, 6, 18)
    assert _parse_date(" .. 18.06.2026 .. ") == date(2026, 6, 18)


def test_month_average_uses_only_non_empty_days() -> None:
    points = [
        DailyCaloriesPoint(day=date(2026, 6, 1), calories=0),
        DailyCaloriesPoint(day=date(2026, 6, 2), calories=1000),
        DailyCaloriesPoint(day=date(2026, 6, 3), calories=2000),
    ]

    caption = _format_month_caption(points, target=1800)

    assert "Всего съедено: 3000 ккал" in caption
    assert "Среднее в непустой день: 1500 ккал" in caption
