from datetime import date, datetime, timezone

from src.bot.handlers.statistics import _format_month_caption, _format_weight_caption, _parse_date
from src.bot.services.charts import DailyCaloriesPoint, WeightPoint, render_weight_chart_png


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


def test_weight_caption_shows_delta() -> None:
    points = [
        WeightPoint(recorded_at=datetime(2026, 1, 1, tzinfo=timezone.utc), weight_kg=80),
        WeightPoint(recorded_at=datetime(2026, 2, 1, tzinfo=timezone.utc), weight_kg=78.5),
    ]

    caption = _format_weight_caption(points, current_weight=78.5)

    assert "Текущий вес: 78.5 кг" in caption
    assert "Изменение: -1.5 кг" in caption
    assert "80 → 78.5 кг" in caption


def test_render_weight_chart_png() -> None:
    points = [
        WeightPoint(recorded_at=datetime(2026, 1, 1, tzinfo=timezone.utc), weight_kg=80),
        WeightPoint(recorded_at=datetime(2026, 2, 1, tzinfo=timezone.utc), weight_kg=79),
    ]

    png = render_weight_chart_png(points)

    assert png.startswith(b"\x89PNG\r\n\x1a\n")
