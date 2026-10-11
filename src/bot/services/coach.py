"""Weekly nutrition review: the bot computes facts, the model only explains them."""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from html import escape
from zoneinfo import ZoneInfo

from aiogram import Bot
from aiogram.exceptions import TelegramForbiddenError

from src.bot.config import settings
from src.bot.services.diary_nudges import local_now_for_timezone
from src.bot.services.nutrition import calculate_daily_nutrient_targets
from src.bot.services.request_limit import has_active_subscription
from src.db.models import CoachReview, DayEntry, EntryType, Goal, Profile, User
from src.db.repository import UserRepository
from src.db.session import async_session_factory
from src.shared.schemas import CoachWeekReview

logger = logging.getLogger(__name__)

WEEK_DAYS = 7
GAP_HOURS = 6.0
INCOMPLETE_BEFORE_HOUR = 20
MIN_LOGGED_DAYS = 2
SUNDAY_PUSH_HOUR = 19

NOT_ENOUGH_TEXT = (
    "Для разбора недели нужно хотя бы 2 дня с записями еды.\n\n"
    "Отправьте фото, голосовое или текст — и я соберу разбор."
)
COACH_FAILED_TEXT = "Не получилось собрать разбор. Попробуйте ещё раз через минуту."
REFRESH_SPENT_TEXT = "На этой неделе разбор уже обновляли."

MONTHS_GENITIVE = (
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
)

GOAL_LABELS = {
    Goal.LOSE: "похудение",
    Goal.MAINTAIN: "поддержание",
    Goal.GAIN: "набор массы",
}

ComposeReview = Callable[[dict], Awaitable[str]]


@dataclass
class MealGap:
    start: datetime
    end: datetime
    hours: float


@dataclass
class DayDigest:
    day: date
    incomplete: bool
    calories: float
    protein_g: float
    fat_g: float
    carbs_g: float
    activity_calories: float
    meals: list[tuple[datetime | None, str, float, float]] = field(default_factory=list)
    gaps: list[MealGap] = field(default_factory=list)

    @property
    def meal_count(self) -> int:
        return len(self.meals)

    @property
    def counts_as_empty(self) -> bool:
        return self.meal_count == 0 and not self.incomplete

    @property
    def counts_as_single(self) -> bool:
        return self.meal_count == 1 and not self.incomplete


@dataclass
class WeekDigest:
    start: date
    end: date
    week_start: date
    goal: str | None
    goal_label: str
    calorie_target: float
    protein_target: float
    fat_target: float
    carbs_target: float
    days: list[DayDigest]

    @property
    def logged_days(self) -> int:
        return sum(1 for day in self.days if day.meal_count > 0)

    @property
    def average_calories(self) -> float:
        logged = [day.calories for day in self.days if day.meal_count > 0]
        if not logged:
            return 0.0
        return sum(logged) / len(logged)

    @property
    def average_protein_g(self) -> float:
        logged = [day.protein_g for day in self.days if day.meal_count > 0]
        if not logged:
            return 0.0
        return sum(logged) / len(logged)


def week_review_allowed(user: User, *, now: datetime | None = None) -> bool:
    return has_active_subscription(user, now=now)


def calendar_week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def rolling_week(day: date) -> tuple[date, date]:
    return day - timedelta(days=WEEK_DAYS - 1), day


def decide_week_action(
    *,
    subscribed: bool,
    logged_days: int,
    has_cache: bool,
    refresh: bool,
    refresh_used: bool,
) -> str:
    if not subscribed:
        return "paywall"
    if has_cache and not refresh:
        return "cache"
    if refresh and refresh_used:
        return "refresh_spent"
    if logged_days < MIN_LOGGED_DAYS:
        return "need_data"
    if refresh:
        return "refresh"
    return "generate"


def sunday_push_window(local_now: datetime) -> bool:
    return local_now.weekday() == 6 and local_now.hour >= SUNDAY_PUSH_HOUR


def should_send_sunday_review(
    *,
    notifications_enabled: bool,
    subscription_active: bool,
    local_now: datetime,
    logged_days: int,
    already_pushed: bool,
) -> bool:
    if not notifications_enabled or not subscription_active or already_pushed:
        return False
    if logged_days < MIN_LOGGED_DAYS:
        return False
    return sunday_push_window(local_now)


def _entry_day(entry: DayEntry) -> date:
    value = entry.entry_date
    if isinstance(value, datetime):
        return value.date()
    return value


def _local_moment(moment: datetime | None, tz: ZoneInfo) -> datetime | None:
    if moment is None:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(tz)


def _hours_phrase(hours: float) -> str:
    whole = int(round(hours))
    if abs(hours - whole) >= 0.05:
        shown = f"{hours:.1f}".replace(".", ",")
        return f"{shown} ч"
    if whole % 10 == 1 and whole % 100 != 11:
        unit = "час"
    elif whole % 10 in {2, 3, 4} and whole % 100 not in {12, 13, 14}:
        unit = "часа"
    else:
        unit = "часов"
    return f"{whole} {unit}"


def format_day_label(day: date) -> str:
    return f"{day.day} {MONTHS_GENITIVE[day.month - 1]}"


def format_period_label(start: date, end: date) -> str:
    if start.month == end.month and start.year == end.year:
        return f"{start.day}–{end.day} {MONTHS_GENITIVE[end.month - 1]}"
    return (
        f"{format_day_label(start)} – {format_day_label(end)}"
    )


def _skip_text(day: DayDigest) -> list[str]:
    label = format_day_label(day.day)
    lines: list[str] = []
    if day.counts_as_empty:
        lines.append(
            f"{label} дневник пустой — приём пищи пропущен, так лучше не делать"
        )
    if day.counts_as_single:
        lines.append(
            f"{label} только один приём пищи — остальные пропущены, так лучше не делать"
        )
    for gap in day.gaps:
        lines.append(
            f"{label} между {gap.start.strftime('%H:%M')} и {gap.end.strftime('%H:%M')} "
            f"пауза {_hours_phrase(gap.hours)} — приём пропущен, так лучше не делать"
        )
    return lines


def build_week_digest(
    *,
    entries: list[DayEntry],
    profile: Profile,
    local_now: datetime,
    timezone_name: str,
) -> WeekDigest:
    tz = ZoneInfo(timezone_name)
    end = local_now.date()
    start, _ = rolling_week(end)
    targets = calculate_daily_nutrient_targets(profile)
    meals_by_day: dict[date, list[DayEntry]] = defaultdict(list)
    activity_by_day: dict[date, float] = defaultdict(float)
    for entry in entries:
        day = _entry_day(entry)
        if day < start or day > end:
            continue
        if entry.entry_type == EntryType.MEAL:
            meals_by_day[day].append(entry)
        elif entry.entry_type == EntryType.ACTIVITY:
            activity_by_day[day] += entry.calories

    days: list[DayDigest] = []
    for offset in range(WEEK_DAYS):
        day = start + timedelta(days=offset)
        meals = sorted(
            meals_by_day[day],
            key=lambda entry: entry.created_at or datetime.min.replace(tzinfo=timezone.utc),
        )
        moments = [_local_moment(entry.created_at, tz) for entry in meals]
        gaps: list[MealGap] = []
        for earlier, later in zip(moments, moments[1:]):
            if earlier is None or later is None:
                continue
            hours = (later - earlier).total_seconds() / 3600
            if hours > GAP_HOURS:
                gaps.append(MealGap(start=earlier, end=later, hours=round(hours, 1)))
        digest_day = DayDigest(
            day=day,
            incomplete=day == end and local_now.hour < INCOMPLETE_BEFORE_HOUR,
            calories=sum(entry.calories for entry in meals),
            protein_g=sum(entry.protein_g for entry in meals),
            fat_g=sum(entry.fat_g for entry in meals),
            carbs_g=sum(entry.carbs_g for entry in meals),
            activity_calories=activity_by_day[day],
            meals=[
                (moment, entry.title, entry.calories, entry.protein_g)
                for moment, entry in zip(moments, meals)
            ],
            gaps=gaps,
        )
        days.append(digest_day)

    goal = profile.goal
    return WeekDigest(
        start=start,
        end=end,
        week_start=calendar_week_start(end),
        goal=goal.value if goal is not None else None,
        goal_label=GOAL_LABELS.get(goal, "не указана, считай как поддержание"),
        calorie_target=profile.daily_calorie_target,
        protein_target=targets.protein_g,
        fat_target=targets.fat_g,
        carbs_target=targets.carbs_g,
        days=days,
    )


def digest_facts(digest: WeekDigest) -> dict:
    skips: list[dict[str, str]] = []
    days_payload = []
    for day in digest.days:
        day_skips = _skip_text(day)
        for text in day_skips:
            skips.append({"date": day.day.isoformat(), "text": text})
        days_payload.append(
            {
                "date": day.day.isoformat(),
                "label": format_day_label(day.day),
                "incomplete": day.incomplete,
                "meal_count": day.meal_count,
                "calories": round(day.calories),
                "protein_g": round(day.protein_g, 1),
                "fat_g": round(day.fat_g, 1),
                "carbs_g": round(day.carbs_g, 1),
                "activity_calories": round(day.activity_calories),
                "titles": [title for _, title, _, _ in day.meals],
                "meal_times": [
                    moment.strftime("%H:%M") if moment is not None else None
                    for moment, _, _, _ in day.meals
                ],
            }
        )
    return {
        "period": {
            "start": digest.start.isoformat(),
            "end": digest.end.isoformat(),
            "label": format_period_label(digest.start, digest.end),
        },
        "goal": digest.goal,
        "goal_label": digest.goal_label,
        "targets": {
            "calories": round(digest.calorie_target),
            "protein_g": round(digest.protein_target, 1),
            "fat_g": round(digest.fat_target, 1),
            "carbs_g": round(digest.carbs_target, 1),
        },
        "logged_days": digest.logged_days,
        "days_in_period": WEEK_DAYS,
        "average_calories": round(digest.average_calories),
        "average_protein_g": round(digest.average_protein_g, 1),
        "days": days_payload,
        "skips": skips,
    }


def _skip_lines(review: CoachWeekReview, facts: dict) -> list[str]:
    expected = [str(item["text"]) for item in facts.get("skips") or []]
    provided = [line.strip() for line in review.skipped if line and line.strip()]
    if expected and len(provided) != len(expected):
        return expected
    return provided


def _bullet_section(title: str, items: list[str]) -> str:
    cleaned = [item.strip() for item in items if item and item.strip()]
    if not cleaned:
        return ""
    lines = "\n".join(f"• {escape(item)}" for item in cleaned)
    return f"\n\n<b>{title}</b>\n{lines}"


def format_week_message(review: CoachWeekReview, facts: dict) -> str:
    period = facts["period"]["label"]
    logged = int(facts["logged_days"])
    total = int(facts["days_in_period"])
    average = float(facts["average_calories"])
    target = float(facts["targets"]["calories"])
    text = (
        f"<b>Разбор недели {escape(str(period))}</b>\n"
        f"Записано {logged} из {total} дней. "
        f"Среднее {average:.0f} ккал при норме {target:.0f}."
        f"\n\n{escape(review.summary.strip())}"
    )
    text += _bullet_section("Что получилось", review.wins)
    text += _bullet_section("Что улучшить", review.improve)
    text += _bullet_section("Пропуски", _skip_lines(review, facts))
    text += _bullet_section("На следующую неделю", review.next_steps)
    if len(text) > 4000:
        text = text[:3990].rstrip() + "…"
    return text


async def write_review_text(facts: dict) -> str:
    from src.bot.services.ai_client import AIAnalyzerClient

    review = await AIAnalyzerClient().coach_week(facts)
    return format_week_message(review, facts)


def _review_matches_period(review: CoachReview | None, end: date) -> bool:
    if review is None:
        return False
    period = (review.facts or {}).get("period") or {}
    return period.get("end") == end.isoformat()


async def load_week_digest(
    repo: UserRepository,
    user: User,
    *,
    now: datetime,
) -> tuple[datetime, WeekDigest]:
    local_now = local_now_for_timezone(user.timezone, now)
    profile = await repo.ensure_default_profile(user.id)
    start, end = rolling_week(local_now.date())
    entries = await repo.get_entries_for_period(user.id, start, end)
    digest = build_week_digest(
        entries=entries,
        profile=profile,
        local_now=local_now,
        timezone_name=user.timezone,
    )
    return local_now, digest


async def process_sunday_coach_pushes(
    bot: Bot,
    repo: UserRepository,
    users: list[User],
    *,
    now: datetime,
    compose: ComposeReview | None = None,
) -> int:
    writer = compose or write_review_text
    sent = 0
    for user in users:
        local_now = local_now_for_timezone(user.timezone, now)
        if not sunday_push_window(local_now):
            continue
        week_start = calendar_week_start(local_now.date())
        existing = await repo.get_coach_review(user.id, week_start)
        if existing is not None and existing.push_sent_at is not None:
            continue
        if not should_send_sunday_review(
            notifications_enabled=user.notifications_enabled,
            subscription_active=has_active_subscription(user, now=now),
            local_now=local_now,
            logged_days=MIN_LOGGED_DAYS,
            already_pushed=False,
        ):
            continue
        try:
            _, digest = await load_week_digest(repo, user, now=now)
        except Exception:
            logger.exception("Failed to load week digest for user_id=%s", user.id)
            continue
        if not should_send_sunday_review(
            notifications_enabled=user.notifications_enabled,
            subscription_active=has_active_subscription(user, now=now),
            local_now=local_now,
            logged_days=digest.logged_days,
            already_pushed=False,
        ):
            continue
        facts = digest_facts(digest)
        text: str | None = None
        if _review_matches_period(existing, digest.end) and existing is not None:
            text = existing.review_text
        else:
            try:
                text = await writer(facts)
            except Exception:
                logger.exception("Failed to write week review for user_id=%s", user.id)
                continue
            await repo.save_coach_review(
                user_id=user.id,
                week_start=week_start,
                facts=facts,
                review_text=text,
                refresh_used=None,
            )
        claimed = await repo.claim_coach_push(
            user_id=user.id,
            week_start=week_start,
            now=now,
        )
        if not claimed or text is None:
            continue
        try:
            await bot.send_message(user.telegram_id, text)
            sent += 1
        except TelegramForbiddenError:
            await repo.set_notifications_enabled(user, False)
        except Exception:
            logger.exception("Failed to send week review to user_id=%s", user.id)
        await asyncio.sleep(0.05)
    return sent


async def run_coach_reviews_iteration(
    bot: Bot,
    *,
    now: datetime | None = None,
) -> int:
    current = now or datetime.now(timezone.utc)
    async with async_session_factory() as session:
        repo = UserRepository(session)
        users = await repo.list_coach_push_candidates(now=current)
        return await process_sunday_coach_pushes(bot, repo, users, now=current)


async def run_coach_reviews_loop(bot: Bot) -> None:
    interval = max(60, settings.coach_reviews_interval_seconds)
    while True:
        try:
            await run_coach_reviews_iteration(bot)
        except Exception:
            logger.exception("Week review loop iteration failed")
        await asyncio.sleep(interval)
