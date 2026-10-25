"""Mobile chart facts. Missing records are never interpreted as zero intake."""

from collections import Counter
from datetime import timedelta

from src.bot.services.nutrition import calculate_daily_nutrient_targets
from src.db.models import EntryType

NUTRIENTS = ("fiber_g", "sugar_g")


def chart_facts(entries, profile, start, end, premium):
    days = {}
    for offset in range((end - start).days + 1):
        day = (start + timedelta(days=offset)).isoformat()
        days[day] = dict(
            date=day,
            logged=False,
            entry_count=0,
            calories=None,
            protein_g=None,
            fat_g=None,
            carbs_g=None,
            water_ml=None,
            activity_minutes=None,
            activity_kcal=None,
            fiber_g=None,
            sugar_g=None,
        )
    slots = Counter()
    workouts = 0
    meals = 0
    nutrient_meals = Counter()
    for e in entries:
        row = days[e.entry_date.isoformat()]
        if e.entry_type in (EntryType.MEAL, EntryType.WATER, EntryType.ACTIVITY):
            row["entry_count"] += 1
        if e.entry_type == EntryType.MEAL:
            meals += 1
            row["logged"] = True
            for key in ("calories", "protein_g", "fat_g", "carbs_g"):
                row[key] = (row[key] or 0) + float(getattr(e, key) or 0)
            slots[e.meal_slot or "unmarked"] += 1
            for key in NUTRIENTS:
                value = (e.micronutrients or {}).get(key)
                if value is not None:
                    row[key] = (row[key] or 0) + float(value)
                    nutrient_meals[key] += 1
        elif e.entry_type == EntryType.WATER:
            row["water_ml"] = (row["water_ml"] or 0) + float(e.volume_ml or 0)
        elif e.entry_type == EntryType.ACTIVITY:
            workouts += 1
            row["activity_minutes"] = (row["activity_minutes"] or 0) + (
                e.duration_minutes or 0
            )
            row["activity_kcal"] = (row["activity_kcal"] or 0) + e.calories
    rows = list(days.values())
    logged = sum(r["logged"] for r in rows)
    totals = {
        key: sum(r[key] or 0 for r in rows)
        for key in (
            "calories",
            "protein_g",
            "fat_g",
            "carbs_g",
            "water_ml",
            "activity_minutes",
            "activity_kcal",
        )
    }
    targets = calculate_daily_nutrient_targets(profile)
    nutrients = {}
    for key in NUTRIENTS:
        recorded = [r[key] for r in rows if r[key] is not None]
        total = sum(recorded) if recorded else None
        nutrients[key] = dict(
            total=total,
            average=total / len(recorded) if recorded else None,
            recorded_days=len(recorded),
            meals_with_data=nutrient_meals[key],
            total_meals=meals,
        )
    base = dict(
        days=[{k: r[k] for k in ("date", "logged", "entry_count", "calories", *NUTRIENTS)} for r in rows],
        nutrients=nutrients,
        logged_days=logged,
        total_calories=totals["calories"],
        average_calories=totals["calories"] / logged if logged else None,
        advanced_available=premium,
    )
    if premium:
        base.update(
            days=rows,
            totals=totals,
            meal_slots=dict(slots),
            workouts=workouts,
            targets=dict(
                protein_g=targets.protein_g,
                fat_g=targets.fat_g,
                carbs_g=targets.carbs_g,
            ),
            water_days=sum(r["water_ml"] is not None for r in rows),
        )
    return base
