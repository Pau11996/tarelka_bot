from __future__ import annotations

from html import escape

from src.db.models import DayEntry, EntryType, FavoriteMeal, Profile
from src.bot.services.nutrition import DailyBalance, calculate_daily_nutrient_targets
from src.shared.schemas import AnalysisResult, TRACKED_MICRONUTRIENTS


SEX_LABELS = {
    "male": "мужской",
    "female": "женский",
}

GOAL_LABELS = {
    "lose": "похудение",
    "maintain": "поддержание",
    "gain": "набор массы",
}

ACTIVITY_LABELS = {
    "sedentary": "минимальная",
    "light": "легкая",
    "moderate": "умеренная",
    "active": "высокая",
    "very_active": "очень высокая",
}


def profile_context(profile: Profile) -> dict:
    return {
        "weight_kg": profile.weight_kg,
        "height_cm": profile.height_cm,
        "age": profile.age,
        "sex": profile.sex.value,
        "goal": profile.goal.value,
        "activity_level": profile.activity_level.value,
        "daily_calorie_target": profile.daily_calorie_target,
    }


def format_profile_card(profile: Profile) -> str:
    return (
        "👤 Профиль\n"
        f"Вес: {profile.weight_kg:g} кг\n"
        f"Рост: {profile.height_cm:g} см\n"
        f"Возраст: {profile.age}\n"
        f"Пол: {SEX_LABELS.get(profile.sex.value, profile.sex.value)}\n"
        f"Цель: {GOAL_LABELS.get(profile.goal.value, profile.goal.value)}\n"
        f"Активность: {ACTIVITY_LABELS.get(profile.activity_level.value, profile.activity_level.value)}\n"
        f"Дневная норма: {profile.daily_calorie_target:.0f} ккал"
    )


def _format_nutrient_ratio(consumed: float, target: float) -> str:
    return f"{consumed:g} / {target:g}"


def _format_macro_ratio(consumed: float, target: float) -> str:
    return f"{consumed:.1f} / {target:.1f} г"


def format_daily_balance(
    balance: DailyBalance,
    *,
    include_micronutrients: bool = True,
    profile: Profile | None = None,
) -> str:
    text = (
        f"📊 Дневной баланс\n"
        f"Норма: {balance.target:.0f} ккал\n"
        f"Съедено: {balance.consumed:.0f} ккал\n"
        f"Активность: +{balance.activity_bonus:.0f} ккал\n"
        f"\n<b>ОСТАЛОСЬ: {balance.remaining:.0f} ккал</b>\n\n"
        f"БЖУ за день:\n"
    )
    if profile is not None:
        targets = calculate_daily_nutrient_targets(profile)
        text += (
            f"Б: {_format_macro_ratio(balance.protein_g, targets.protein_g)} | "
            f"Ж: {_format_macro_ratio(balance.fat_g, targets.fat_g)} | "
            f"У: {_format_macro_ratio(balance.carbs_g, targets.carbs_g)}"
        )
        if include_micronutrients:
            nutrient_lines = [
                f"{label}: {_format_nutrient_ratio(balance.micronutrients.get(key, 0), targets.micronutrients[key])}"
                for key, label in TRACKED_MICRONUTRIENTS.items()
            ]
            text += "\n\nПолезные вещества за день:\n" + "\n".join(nutrient_lines)
        return text

    text += (
        f"Б: {balance.protein_g:.1f} г | Ж: {balance.fat_g:.1f} г | У: {balance.carbs_g:.1f} г"
    )

    if include_micronutrients:
        nutrient_lines = [
            f"{label}: {balance.micronutrients[key]:g}"
            for key, label in TRACKED_MICRONUTRIENTS.items()
            if balance.micronutrients.get(key, 0) > 0
        ]
        if nutrient_lines:
            text += "\n\nПолезные вещества за день:\n" + "\n".join(nutrient_lines)
    return text


def format_analysis_result(result: AnalysisResult, balance: DailyBalance | None = None) -> str:
    title = escape(result.title or "Анализ")
    lines = [f"🍽 {title}", f"Калории: {result.total_calories:.0f} ккал"]
    lines.append(
        f"БЖУ: Б {result.protein_g:.1f} г | Ж {result.fat_g:.1f} г | У {result.carbs_g:.1f} г"
    )

    if result.items:
        lines.append("\nСостав:")
        for item in result.items:
            name = escape(item.name)
            qty = f" ({escape(item.quantity)})" if item.quantity else ""
            lines.append(
                f"• {name}{qty}: {item.calories:.0f} ккал, "
                f"Б {item.protein_g:.1f} г | Ж {item.fat_g:.1f} г | У {item.carbs_g:.1f} г"
            )

    if balance:
        lines.append(f"\n{format_daily_balance(balance, include_micronutrients=False)}")

    return "\n".join(lines)


def format_activity_result(result: AnalysisResult, balance: DailyBalance | None = None) -> str:
    lines = [
        f"🏃 {escape(result.title or 'Активность')}",
        f"Сожжено: {result.total_calories:.0f} ккал",
    ]
    if result.duration_minutes:
        lines.append(f"Длительность: {result.duration_minutes} мин")
    if balance:
        lines.append(f"\n{format_daily_balance(balance, include_micronutrients=False)}")
    return "\n".join(lines)


def format_entry_list(entries: list[DayEntry]) -> str:
    if not entries:
        return "За сегодня записей пока нет."

    lines = ["📝 Записи за сегодня:"]
    for entry in entries:
        prefix = "🍽" if entry.entry_type == EntryType.MEAL else "🏃"
        sign = "-" if entry.entry_type == EntryType.MEAL else "+"
        lines.append(f"{prefix} {escape(entry.title)}: {sign}{entry.calories:.0f} ккал")
    return "\n".join(lines)


def format_favorite_meal(favorite: FavoriteMeal) -> str:
    lines = [
        f"🍽 {escape(favorite.title)}",
        f"Калории: {favorite.calories:.0f} ккал",
        f"БЖУ: Б {favorite.protein_g:.1f} г | Ж {favorite.fat_g:.1f} г | У {favorite.carbs_g:.1f} г",
    ]
    if favorite.items:
        lines.append("\nСостав:")
        for item in favorite.items:
            name = escape(str(item.get("name", "компонент")))
            qty = item.get("quantity")
            qty_text = f" ({escape(str(qty))})" if qty else ""
            lines.append(
                f"• {name}{qty_text}: {float(item.get('calories', 0)):.0f} ккал, "
                f"Б {float(item.get('protein_g', 0)):.1f} г | "
                f"Ж {float(item.get('fat_g', 0)):.1f} г | "
                f"У {float(item.get('carbs_g', 0)):.1f} г"
            )
    return "\n".join(lines)


def format_favorites_list(favorites: list[FavoriteMeal]) -> str:
    if not favorites:
        return "⭐ Избранное пусто.\n\nДобавьте блюдо в избранное с карточки приема пищи."

    lines = ["⭐ Избранное", ""]
    for index, favorite in enumerate(favorites, start=1):
        lines.append(f"{index}. {escape(favorite.title)} — {favorite.calories:.0f} ккал")
    lines.append("\nНажмите ➕, чтобы добавить блюдо в сегодняшний дневник.")
    return "\n".join(lines)
