"""Compact Telegram copy; the app keeps its own achievements presentation."""
MONTHS = ("января", "февраля", "марта", "апреля", "мая", "июня",
          "июля", "августа", "сентября", "октября", "ноября", "декабря")


def number(value):
    return f"{value + 0:g}".replace(".", ",") if value is not None else "—"


def measurement_date(value):
    from datetime import date

    day = date.fromisoformat(value)
    return f"{day.day} {MONTHS[day.month - 1]}"


def goal_progress_text(goal):
    change = round(goal["change_kg"], 1) if goal["change_kg"] is not None else None
    lines = []
    if change is not None:
        sign = "−" if change < 0 else "+" if change > 0 else ""
        lines.append(f"Со старта: {sign}{number(abs(change))} кг")
    if goal["remaining_kg"] is not None:
        label = "Отклонение от цели" if goal["direction"] == "maintain" else "До цели"
        lines.append(f'{label}: {number(round(goal["remaining_kg"], 1))} кг')
    return "\n".join(lines)


def weight_saved_text(weight, goal):
    text = f"⚖️ Записал <b>{number(weight)} кг</b>."
    if goal:
        text += "\n" + goal_progress_text(goal)
    return text
