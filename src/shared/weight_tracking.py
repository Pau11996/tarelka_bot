"""Shared weight-goal rules for HTTP clients, Telegram and the reminder worker."""
from __future__ import annotations

import math
import re
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from src.db.models import (
    AchievementAward, AchievementMessage, DayEntry, Goal, HealthRecord, NotificationPreference,
    Profile, PushDevice, User, WeighInReminder, WeightGoal, WeightHistory,
)

DIRECTION_LABELS = {"lose": "Снизить вес", "maintain": "Поддерживать вес", "gain": "Набрать вес"}
BADGES = [
    ("first_weigh_in", "Первое взвешивание", "Первое измерение после начального веса", 1, "measurements"),
    ("weight_4_weeks", "4 недели с весом", "Измерение каждую неделю 4 недели подряд", 4, "weeks"),
    ("weight_12_weeks", "12 недель с весом", "Измерение каждую неделю 12 недель подряд", 12, "weeks"),
    ("diary_7_days", "7 дней дневника", "Записи в дневнике 7 дней подряд", 7, "diary"),
    ("diary_30_days", "30 дней дневника", "Записи в дневнике 30 дней подряд", 30, "diary"),
    ("weight_goal_completed", "Цель достигнута", "Подтверждённое завершение цели", 1, "completed"),
]


class WeightTrackingError(ValueError):
    pass


class WeightGoalConflict(WeightTrackingError):
    pass


class ReminderUnavailable(WeightTrackingError):
    pass


def aware(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def user_zone(user):
    try:
        return ZoneInfo(user.timezone or "UTC")
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def valid_weight(value):
    try:
        number = float(str(value).strip().replace(",", "."))
    except (ValueError, TypeError):
        raise WeightTrackingError("Введите вес числом в кг, например: 72,5.")
    if not math.isfinite(number) or number <= 0 or number > 1000:
        raise WeightTrackingError("Введите положительный вес не больше 1000 кг.")
    return number


def direction_for(current, target):
    return "lose" if target < current else "gain" if target > current else "maintain"


async def insert_once(session, model, values, keys):
    insert = sqlite_insert if session.get_bind().dialect.name == "sqlite" else pg_insert
    result = await session.execute(insert(model).values(**values).on_conflict_do_nothing(index_elements=keys))
    return result.rowcount == 1


async def lock_user(session, user_id):
    await session.execute(select(User.id).where(User.id == user_id).with_for_update())


async def active_goal(session, user_id):
    return await session.scalar(select(WeightGoal).where(WeightGoal.user_id == user_id, WeightGoal.active_slot == 1))


async def guard_profile_direction(session, user_id, direction):
    if direction is None:
        return
    goal = await active_goal(session, user_id)
    value = direction.value if isinstance(direction, Goal) else direction
    if goal and value != goal.direction:
        raise WeightGoalConflict("Направление связано с целью по весу. Сначала измените цель.")


async def weight_records(session, user, *, now=None):
    current = now or datetime.now(timezone.utc)
    zone = user_zone(user)
    manual = (await session.scalars(select(WeightHistory).where(WeightHistory.user_id == user.id, WeightHistory.recorded_at <= current))).all()
    rows = [dict(id=f"manual:{row.id}", weight_kg=row.weight_kg, recorded_at=aware(row.recorded_at).isoformat(),
                 local_date=aware(row.recorded_at).astimezone(zone).date().isoformat(), source="manual", origin=None)
            for row in manual if math.isfinite(row.weight_kg) and row.weight_kg > 0]
    # Stored measurements remain history even while new Health Connect imports are disabled.
    imports = (await session.scalars(select(HealthRecord).where(HealthRecord.user_id == user.id, HealthRecord.record_type == "Weight", HealthRecord.start_at <= current))).all()
    for row in imports:
        value = row.values.get("weight_kg")
        if isinstance(value, (int, float)) and math.isfinite(value) and value > 0:
            rows.append(dict(id=f"health:{row.id}", weight_kg=value, recorded_at=aware(row.start_at).isoformat(),
                             local_date=aware(row.start_at).astimezone(zone).date().isoformat(), source="health_connect", origin=row.origin))
    return sorted(rows, key=lambda row: (row["recorded_at"], row["source"] == "manual",
                  int(row["id"].split(":", 1)[1]) if row["source"] == "manual" else 0, row["id"]))


async def current_weight(session, user, *, now=None):
    rows = await weight_records(session, user, now=now)
    if rows:
        return rows[-1]["weight_kg"]
    profile = await session.scalar(select(Profile).where(Profile.user_id == user.id))
    return profile.weight_kg if profile else None


def goal_out(goal, weight):
    span = goal.target_weight_kg - goal.start_weight_kg
    progress = None if span == 0 or weight is None else max(0, min(1, (weight - goal.start_weight_kg) / span))
    reached = weight is not None and (
        weight <= goal.target_weight_kg if goal.direction == "lose" else
        weight >= goal.target_weight_kg if goal.direction == "gain" else
        round(weight, 1) == round(goal.target_weight_kg, 1)
    )
    return dict(id=goal.id, status=goal.status, direction=goal.direction, direction_label=DIRECTION_LABELS[goal.direction],
                start_weight_kg=goal.start_weight_kg, target_weight_kg=goal.target_weight_kg,
                current_weight_kg=weight, progress=progress, reached=reached,
                change_kg=None if weight is None else weight - goal.start_weight_kg,
                remaining_kg=None if weight is None else max(0, goal.target_weight_kg - weight) if goal.direction == "gain" else max(0, weight - goal.target_weight_kg) if goal.direction == "lose" else abs(weight - goal.target_weight_kg),
                started_at=aware(goal.started_at).isoformat(), finished_at=aware(goal.finished_at).isoformat() if goal.finished_at else None)


async def set_weight_goal(session, user, target, *, expected_goal_id=None, expected_weight=None, start_weight=None, commit=True):
    target = valid_weight(target)
    await lock_user(session, user.id)
    previous = await active_goal(session, user.id)
    if previous and previous.target_weight_kg == target:
        return previous
    if (previous.id if previous else None) != expected_goal_id:
        raise WeightGoalConflict("Цель уже изменилась. Откройте её заново перед сохранением.")
    weight = valid_weight(start_weight) if start_weight is not None else await current_weight(session, user)
    if weight is None:
        raise WeightTrackingError("Сначала запишите текущий вес.")
    weight = valid_weight(weight)
    if expected_weight is not None and abs(weight - expected_weight) > 0.000001:
        raise WeightGoalConflict("Текущий вес изменился. Обновите сводку перед подтверждением.")
    now = datetime.now(timezone.utc)
    if previous:
        previous.active_slot, previous.status, previous.finished_at = None, "replaced", now
        await session.flush()
    goal = WeightGoal(id=str(uuid4()), user_id=user.id, active_slot=1, status="active", direction=direction_for(weight, target),
                      start_weight_kg=weight, target_weight_kg=target, started_at=now)
    session.add(goal)
    profile = await session.scalar(select(Profile).where(Profile.user_id == user.id))
    if profile is None:
        profile = Profile(user_id=user.id, daily_calorie_target=2000)
        session.add(profile)
    profile.goal = Goal(goal.direction)
    await session.flush()
    if commit:
        await session.commit()
    return goal


async def close_weight_goal(session, user, goal_id, *, complete):
    await lock_user(session, user.id)
    goal = await session.get(WeightGoal, goal_id)
    if not goal or goal.user_id != user.id:
        raise WeightGoalConflict("Цель не найдена.")
    destination = "completed" if complete else "cancelled"
    if goal.status == destination:
        return goal
    if goal.status != "active":
        raise WeightGoalConflict("Эта цель уже закрыта. Откройте актуальную цель.")
    if complete and not goal_out(goal, await current_weight(session, user))["reached"]:
        raise WeightGoalConflict("Последнее измерение ещё не достигло цели.")
    goal.active_slot, goal.status, goal.finished_at = None, destination, datetime.now(timezone.utc)
    await session.flush()
    await sync_awards(session, user)
    await session.commit()
    return goal


async def record_weight(session, user, value, *, operation_key, now=None):
    value = valid_weight(value)
    if not operation_key or len(operation_key) > 160:
        raise WeightTrackingError("Не удалось определить запись. Откройте форму заново.")
    await lock_user(session, user.id)
    key_query = select(WeightHistory).where(WeightHistory.user_id == user.id, WeightHistory.operation_key == operation_key)
    existing = await session.scalar(key_query)
    if existing:
        if existing.weight_kg != value:
            raise WeightGoalConflict("Это измерение уже сохранено с другим значением.")
        return existing
    moment = now or datetime.now(timezone.utc)
    inserted = await insert_once(session, WeightHistory, dict(user_id=user.id, weight_kg=value, recorded_at=moment, operation_key=operation_key), ["user_id", "operation_key"])
    row = await session.scalar(key_query)
    if not inserted:
        if row.weight_kg != value:
            raise WeightGoalConflict("Это измерение уже сохранено с другим значением.")
        return row
    profile = await session.scalar(select(Profile).where(Profile.user_id == user.id))
    if profile is None:
        profile = Profile(user_id=user.id, daily_calorie_target=2000)
        session.add(profile)
    profile.weight_kg = value
    await session.flush()
    await sync_goal_message(session, user, measurement_ids={f"manual:{row.id}"})
    await sync_awards(session, user, now=moment)
    await session.commit()
    return row


def longest_run(days, step=1):
    best = run = 0
    previous = None
    for day in sorted(set(days)):
        run = run + 1 if previous is not None and (day - previous).days == step else 1
        best = max(best, run)
        previous = day
    return best


def current_run(days, through, step=1):
    recorded = set(days)
    cursor = through if through in recorded else through - timedelta(days=step)
    count = 0
    while cursor in recorded:
        count += 1
        cursor -= timedelta(days=step)
    return count


async def sync_awards(session, user, *, rows=None, now=None):
    rows = await weight_records(session, user, now=now) if rows is None else rows
    zone = user_zone(user)
    weight_days = [datetime.fromisoformat(row["recorded_at"]).astimezone(zone).date() for row in rows]
    weeks = [day - timedelta(days=day.weekday()) for day in weight_days]
    today = (now or datetime.now(timezone.utc)).astimezone(zone).date()
    diary_days = set((await session.scalars(select(DayEntry.entry_date).where(DayEntry.user_id == user.id, DayEntry.entry_date <= today))).all())
    completed = await session.scalar(select(func.count()).select_from(WeightGoal).where(WeightGoal.user_id == user.id, WeightGoal.status == "completed"))
    # The earliest measurement establishes the baseline, including for accounts
    # that start tracking in chat or Health Connect without filling the profile.
    counts = dict(measurements=max(0, len(rows) - 1), weeks=longest_run(weeks, 7), diary=longest_run(diary_days), completed=completed)
    progress = dict(counts, weeks=current_run(weeks, today-timedelta(days=today.weekday()), 7), diary=current_run(diary_days, today))
    for key, _, _, target, counter in BADGES:
        if counts[counter] >= target:
            await insert_once(session, AchievementAward, dict(user_id=user.id, key=key, awarded_at=now or datetime.now(timezone.utc)), ["user_id", "key"])
    earned = {row.key: row for row in (await session.scalars(select(AchievementAward).where(AchievementAward.user_id == user.id))).all()}
    return [dict(key=key, title=title, description=description, target=target,
                 progress=target if key in earned else min(target, progress[counter]), earned=key in earned,
                 awarded_at=aware(earned[key].awarded_at).isoformat() if key in earned else None)
            for key, title, description, target, counter in BADGES]


async def sync_goal_message(session, user, *, measurement_ids):
    """Complete a reached goal and persist its notice with the new measurement."""
    await lock_user(session, user.id)
    goal = await active_goal(session, user.id)
    if not goal or goal.direction == "maintain":
        return
    rows = await weight_records(session, user)
    if not rows:
        return
    latest = rows[-1]
    # Historical imports, deletions and replays cannot close a goal. Only a new
    # current measurement made after the goal started may complete it.
    if latest["id"] not in measurement_ids or datetime.fromisoformat(latest["recorded_at"]) < aware(goal.started_at):
        return
    if not goal_out(goal, latest["weight_kg"])["reached"]:
        return
    target = f"{goal.target_weight_kg:g}".replace(".", ",")
    weight = f'{latest["weight_kg"]:g}'.replace(".", ",")
    now = datetime.now(timezone.utc)
    goal.active_slot, goal.status, goal.finished_at = None, "completed", now
    await session.flush()
    await insert_once(session, AchievementMessage, dict(
        id=str(uuid4()), user_id=user.id, event_key=f"goal_reached:{goal.id}",
        title="Цель по весу достигнута!",
        message=f"Поздравляем! Ваш целевой вес — {target} кг, последнее измерение — {weight} кг. "
                "Цель сохранена в истории. Можно задать новую или продолжить записывать вес.",
        created_at=now, telegram_status="pending",
    ), ["user_id", "event_key"])


def achievement_message_out(message):
    return dict(id=message.id, title=message.title, message=message.message,
                created_at=aware(message.created_at).isoformat())


async def goal_chat_messages(session, user):
    messages = (await session.scalars(
        select(AchievementMessage).where(AchievementMessage.user_id == user.id)
        .order_by(AchievementMessage.created_at.desc(), AchievementMessage.id.desc()).limit(100)
    )).all()
    return [achievement_message_out(message) for message in reversed(messages)]


async def notification_channel(session, user):
    pref = await session.get(NotificationPreference, user.id)
    channel = pref.channel if pref else ("telegram" if user.telegram_id is not None else "app")
    if not user.notifications_enabled or channel == "off":
        return channel, False, "Уведомления выключены. Выберите канал в настройках уведомлений."
    if channel == "telegram":
        return channel, user.telegram_id is not None, None if user.telegram_id is not None else "Telegram не подключён к этому аккаунту."
    device = await session.scalar(select(PushDevice.token).where(PushDevice.user_id == user.id, PushDevice.enabled.is_(True)).limit(1))
    return channel, bool(device), None if device else "Разрешите уведомления в сборке приложения на телефоне."


async def reminder_out(session, user):
    pref = await session.get(WeighInReminder, user.id)
    channel, ready, reason = await notification_channel(session, user)
    return dict(enabled=pref.enabled if pref else False, weekday=pref.weekday if pref else 0,
                local_time=pref.local_time if pref else "09:00", timezone=user_zone(user).key,
                channel=channel, delivery_ready=ready, effective_enabled=bool(pref and pref.enabled and ready), unavailable_reason=reason)


async def set_reminder(session, user, *, enabled, weekday, local_time):
    if weekday not in range(7) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", local_time):
        raise WeightTrackingError("Выберите день недели и время в формате ЧЧ:ММ.")
    await lock_user(session, user.id)
    pref = await session.get(WeighInReminder, user.id)
    _, ready, reason = await notification_channel(session, user)
    if enabled and not ready and not (pref and pref.enabled):
        raise ReminderUnavailable(reason)
    if not pref:
        pref = WeighInReminder(user_id=user.id)
        session.add(pref)
    pref.enabled, pref.weekday, pref.local_time = enabled, weekday, local_time
    await session.commit()
    return await reminder_out(session, user)


async def achievements_payload(session, user):
    rows = await weight_records(session, user)
    weight = rows[-1]["weight_kg"] if rows else await current_weight(session, user)
    active = await active_goal(session, user.id)
    previous = (await session.scalars(select(WeightGoal).where(WeightGoal.user_id == user.id, WeightGoal.active_slot.is_(None)).order_by(WeightGoal.started_at.desc()).limit(20))).all()
    awards = await sync_awards(session, user, rows=rows)
    reminder = await reminder_out(session, user)
    await session.commit()
    return dict(goal=goal_out(active, weight) if active else None, goal_history=[goal_out(goal, None) for goal in previous],
                current_weight_kg=weight, latest_measurement=rows[-1] if rows else None,
                weight_history=rows, achievements=awards, reminder=reminder)
