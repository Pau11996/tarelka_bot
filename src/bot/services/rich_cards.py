from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from html import escape

from src.bot.services.charts import DailyCaloriesPoint, WeightPoint
from src.bot.services.formatting import format_calorie_bar, format_meal_title
from src.bot.services.nutrition import DailyBalance, calculate_daily_nutrient_targets
from src.db.models import DayEntry, EntryType, Profile
from src.shared.schemas import TRACKED_MICRONUTRIENTS

BREAKFAST_SLOTS = frozenset({"breakfast", "second_breakfast"})
LUNCH_SLOTS = frozenset({"lunch", "lanch"})
DINNER_SLOTS = frozenset({"dinner", "late_dinner"})


@dataclass(frozen=True)
class MonthAdvanced:
    logged_days: int
    days_in_period: int
    days_over_target: int
    avg_protein_g: float
    avg_fat_g: float
    avg_carbs_g: float
    protein_target: float
    fat_target: float
    carbs_target: float
    breakfast_days: int
    lunch_days: int
    dinner_days: int
    water_days: int
    avg_water_ml: float
    workouts: int
    activity_minutes: int
    activity_kcal: float
    show_micros: bool
    avg_fiber_g: float
    avg_sugar_g: float
    fiber_target: float
    sugar_target: float


def build_month_advanced(
    entries: list[DayEntry],
    *,
    profile: Profile,
    target: float,
    days_in_period: int,
) -> MonthAdvanced:
    calories_by_day: dict[date, float] = defaultdict(float)
    protein_by_day: dict[date, float] = defaultdict(float)
    fat_by_day: dict[date, float] = defaultdict(float)
    carbs_by_day: dict[date, float] = defaultdict(float)
    fiber_by_day: dict[date, float] = defaultdict(float)
    sugar_by_day: dict[date, float] = defaultdict(float)
    slots_by_day: dict[date, set[str]] = defaultdict(set)
    water_by_day: dict[date, float] = defaultdict(float)
    workouts = 0
    activity_minutes = 0
    activity_kcal = 0.0

    for entry in entries:
        day = _entry_day(entry)
        if entry.entry_type == EntryType.MEAL:
            calories_by_day[day] += entry.calories
            protein_by_day[day] += entry.protein_g
            fat_by_day[day] += entry.fat_g
            carbs_by_day[day] += entry.carbs_g
            if entry.meal_slot:
                slots_by_day[day].add(entry.meal_slot)
            micros = entry.micronutrients or {}
            fiber_by_day[day] += float(micros.get("fiber_g", 0) or 0)
            sugar_by_day[day] += float(micros.get("sugar_g", 0) or 0)
        elif entry.entry_type == EntryType.WATER:
            water_by_day[day] += float(entry.volume_ml or 0)
        elif entry.entry_type == EntryType.ACTIVITY:
            workouts += 1
            activity_minutes += entry.duration_minutes or 0
            activity_kcal += entry.calories

    logged_days = [day for day, calories in calories_by_day.items() if calories > 0]
    logged_count = len(logged_days)
    days_over = sum(1 for day in logged_days if calories_by_day[day] > target)

    def _avg(values_by_day: dict[date, float]) -> float:
        if not logged_count:
            return 0.0
        return sum(values_by_day[day] for day in logged_days) / logged_count

    water_days = [day for day, volume in water_by_day.items() if volume > 0]
    targets = calculate_daily_nutrient_targets(profile)
    total_fiber = sum(fiber_by_day.values())
    total_sugar = sum(sugar_by_day.values())
    return MonthAdvanced(
        logged_days=logged_count,
        days_in_period=days_in_period,
        days_over_target=days_over,
        avg_protein_g=_avg(protein_by_day),
        avg_fat_g=_avg(fat_by_day),
        avg_carbs_g=_avg(carbs_by_day),
        protein_target=targets.protein_g,
        fat_target=targets.fat_g,
        carbs_target=targets.carbs_g,
        breakfast_days=sum(1 for day in slots_by_day if slots_by_day[day] & BREAKFAST_SLOTS),
        lunch_days=sum(1 for day in slots_by_day if slots_by_day[day] & LUNCH_SLOTS),
        dinner_days=sum(1 for day in slots_by_day if slots_by_day[day] & DINNER_SLOTS),
        water_days=len(water_days),
        avg_water_ml=(sum(water_by_day[day] for day in water_days) / len(water_days) if water_days else 0.0),
        workouts=workouts,
        activity_minutes=activity_minutes,
        activity_kcal=activity_kcal,
        show_micros=total_fiber > 0 or total_sugar > 0,
        avg_fiber_g=_avg(fiber_by_day),
        avg_sugar_g=_avg(sugar_by_day),
        fiber_target=targets.micronutrients["fiber_g"],
        sugar_target=targets.micronutrients["sugar_g"],
    )


def format_month_rich(
    points: list[DailyCaloriesPoint],
    target: float,
    *,
    advanced: MonthAdvanced | None = None,
) -> str:
    values = [point.calories for point in points]
    non_empty = [value for value in values if value > 0]
    total = sum(values)
    average = total / len(non_empty) if non_empty else 0
    max_point = max(points, key=lambda point: point.calories) if points else None
    rows = [
        _row("Всего съедено", f"{total:.0f} ккал"),
        _row("Среднее в непустой день", f"{average:.0f} ккал"),
        _row("Дневная норма", f"{target:.0f} ккал"),
    ]
    if max_point is not None and max_point.calories > 0:
        rows.append(
            _row("Максимум", f"{max_point.calories:.0f} ккал ({max_point.day.strftime('%d.%m.%Y')})")
        )
    parts = [
        "<h2>Калории за последние 30 дней</h2>",
        _table(rows),
    ]
    if advanced is not None:
        parts.append(_month_advanced_html(advanced))
    return "".join(parts)


def format_weight_rich(points: list[WeightPoint], current_weight: float | None) -> str:
    rows: list[str] = []
    if current_weight is not None:
        rows.append(_row("Текущий вес", f"{current_weight:g} кг"))
    if len(points) >= 2:
        first = points[0]
        last = points[-1]
        delta = last.weight_kg - first.weight_kg
        sign = "+" if delta > 0 else ""
        rows.append(_row("Изменение", f"{sign}{delta:g} кг ({first.weight_kg:g} → {last.weight_kg:g})"))
        rows.append(
            _row(
                "Период",
                f"{first.recorded_at.strftime('%d.%m.%Y')} — {last.recorded_at.strftime('%d.%m.%Y')}",
            )
        )
    elif len(points) == 1:
        rows.append(_row("Запись", points[0].recorded_at.strftime("%d.%m.%Y")))
    if not rows:
        rows.append(_row("Записи", "пока нет"))
    return "<h2>Динамика веса</h2>" + _table(rows)


def format_day_rich(
    selected_date: date,
    balance: DailyBalance,
    entries: list[DayEntry],
    *,
    subscriber: bool = False,
    profile: Profile | None = None,
) -> str:
    bar = escape(
        format_calorie_bar(balance.consumed, balance.target, activity_bonus=balance.activity_bonus)
    ).replace("\n", "<br>")
    parts = [
        f"<h2>Статистика за {selected_date.strftime('%d.%m.%Y')}</h2>",
        f"<aside><b>ОСТАЛОСЬ: {balance.remaining:.0f} ккал</b></aside>",
        (
            "<p>"
            f"Норма: {balance.target:.0f} ккал · "
            f"Съедено: {balance.consumed:.0f} ккал · "
            f"Активность: +{balance.activity_bonus:.0f} ккал"
            "</p>"
        ),
        f"<p>{bar}</p>",
        _table(
            [
                _row("Белки", f"{balance.protein_g:.1f} г"),
                _row("Жиры", f"{balance.fat_g:.1f} г"),
                _row("Углеводы", f"{balance.carbs_g:.1f} г"),
            ],
            caption="БЖУ за день",
        ),
        f"<p>Вода: {balance.water_ml:.0f} мл</p>",
    ]
    nutrient_rows = [
        _row(label, f"{balance.micronutrients[key]:g}")
        for key, label in TRACKED_MICRONUTRIENTS.items()
        if balance.micronutrients.get(key, 0) > 0
    ]
    if nutrient_rows:
        parts.append("<h3>Полезные вещества</h3>" + _table(nutrient_rows))
    parts.append(_entries_html(entries))
    if subscriber and profile is not None:
        parts.append(_day_targets_html(balance, profile))
    return "".join(parts)


def _month_advanced_html(advanced: MonthAdvanced) -> str:
    rows = [
        _row(
            "Дней с едой",
            f"{advanced.logged_days} из {advanced.days_in_period}, выше нормы: {advanced.days_over_target}",
        ),
        _row("Белки в день с едой", f"{advanced.avg_protein_g:.1f} / {advanced.protein_target:.1f} г"),
        _row("Жиры в день с едой", f"{advanced.avg_fat_g:.1f} / {advanced.fat_target:.1f} г"),
        _row("Углеводы в день с едой", f"{advanced.avg_carbs_g:.1f} / {advanced.carbs_target:.1f} г"),
        _row("Завтрак", _days_label(advanced.breakfast_days, advanced.days_in_period)),
        _row("Обед", _days_label(advanced.lunch_days, advanced.days_in_period)),
        _row("Ужин", _days_label(advanced.dinner_days, advanced.days_in_period)),
    ]
    if advanced.water_days:
        rows.append(_row("Вода в дни с записью", f"{advanced.avg_water_ml:.0f} мл"))
    rows.append(
        _row(
            "Активность",
            f"тренировок {advanced.workouts}, {advanced.activity_minutes} мин, {advanced.activity_kcal:.0f} ккал",
        )
    )
    if advanced.show_micros:
        rows.append(_row("Клетчатка в день с едой", f"{advanced.avg_fiber_g:.1f} / {advanced.fiber_target:g} г"))
        rows.append(_row("Сахар в день с едой", f"{advanced.avg_sugar_g:.1f} / {advanced.sugar_target:g} г"))
    return "<h3>Подробнее</h3>" + _table(rows)


def _day_targets_html(balance: DailyBalance, profile: Profile) -> str:
    targets = calculate_daily_nutrient_targets(profile)
    rows = [
        _row("Белки", f"{balance.protein_g:.1f} / {targets.protein_g:.1f} г"),
        _row("Жиры", f"{balance.fat_g:.1f} / {targets.fat_g:.1f} г"),
        _row("Углеводы", f"{balance.carbs_g:.1f} / {targets.carbs_g:.1f} г"),
    ]
    if balance.micronutrients.get("fiber_g", 0) > 0 or balance.micronutrients.get("sugar_g", 0) > 0:
        rows.append(
            _row("Клетчатка", f"{balance.micronutrients.get('fiber_g', 0):g} / {targets.micronutrients['fiber_g']:g} г")
        )
        rows.append(
            _row("Сахар", f"{balance.micronutrients.get('sugar_g', 0):g} / {targets.micronutrients['sugar_g']:g} г")
        )
    return "<h3>К целям</h3>" + _table(rows)


def _entries_html(entries: list[DayEntry]) -> str:
    if not entries:
        return "<p>За сегодня записей пока нет.</p>"
    items: list[str] = []
    for entry in entries:
        if entry.entry_type == EntryType.WATER:
            items.append(f"<li>💧 {escape(entry.title)}: {(entry.volume_ml or 0):.0f} мл</li>")
            continue
        if entry.entry_type == EntryType.MEAL:
            title = escape(format_meal_title(entry.title, entry.meal_slot))
            items.append(f"<li>🍽 {title}: -{entry.calories:.0f} ккал</li>")
            continue
        items.append(f"<li>🏃 {escape(entry.title)}: +{entry.calories:.0f} ккал</li>")
    return "<h3>Записи за сегодня</h3><ul>" + "".join(items) + "</ul>"


def _entry_day(entry: DayEntry) -> date:
    value = entry.entry_date
    if isinstance(value, datetime):
        return value.date()
    return value


def _days_label(count: int, total: int) -> str:
    return f"{count} из {total} дней"


def _row(label: str, value: str) -> str:
    return f"<tr><td>{escape(label)}</td><td align=\"right\">{escape(value)}</td></tr>"


def _table(rows: list[str], *, caption: str | None = None) -> str:
    caption_html = f"<caption>{escape(caption)}</caption>" if caption else ""
    return "<table bordered compact>" + caption_html + "".join(rows) + "</table>"
