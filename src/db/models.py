from __future__ import annotations

from datetime import date, datetime
from enum import Enum as PyEnum
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy import JSON
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def json_column() -> JSON:
    """JSONB on PostgreSQL, plain JSON where the test database is SQLite."""
    return JSON().with_variant(JSONB(), "postgresql")


class Base(DeclarativeBase):
    pass


def _pg_enum(enum_cls: type[PyEnum], name: str) -> SAEnum:
    return SAEnum(
        enum_cls,
        name=name,
        values_callable=lambda members: [member.value for member in members],
    )


class Sex(str, PyEnum):
    MALE = "male"
    FEMALE = "female"


class Goal(str, PyEnum):
    LOSE = "lose"
    MAINTAIN = "maintain"
    GAIN = "gain"


class ActivityLevel(str, PyEnum):
    SEDENTARY = "sedentary"
    LIGHT = "light"
    MODERATE = "moderate"
    ACTIVE = "active"
    VERY_ACTIVE = "very_active"


class EntryType(str, PyEnum):
    MEAL = "meal"
    ACTIVITY = "activity"
    WATER = "water"


DIARY_ENTRY_TYPES = {EntryType.MEAL, EntryType.ACTIVITY, EntryType.WATER}


class AnalysisType(str, PyEnum):
    FOOD_PHOTO = "food_photo"
    FOOD_TEXT = "food_text"
    ACTIVITY_TEXT = "activity_text"
    ACTIVITY_PHOTO = "activity_photo"
    CORRECTION = "correction"


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "(telegram_id IS NOT NULL AND email IS NULL AND password_hash IS NULL) OR "
            "(telegram_id IS NULL AND email IS NOT NULL AND password_hash IS NOT NULL)",
            name="ck_users_login_identity",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    telegram_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(254), nullable=True, unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    auth_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="Europe/Moscow")
    daily_request_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    legacy_photo_quota: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    subscription_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    subscription_last_notified_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    acquisition_source: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    last_active_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    reengagement_last_sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    notifications_enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true"
    )
    referral_code: Mapped[str | None] = mapped_column(
        String(12), nullable=True, unique=True, index=True
    )
    referred_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    referral_reward_granted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    referral_subscription_month: Mapped[str | None] = mapped_column(
        String(7), nullable=True
    )
    bonus_requests: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    profile: Mapped[Profile | None] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    entries: Mapped[list[DayEntry]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    favorites: Mapped[list[FavoriteMeal]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    daily_request_usage: Mapped[list[DailyRequestUsage]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    daily_activity: Mapped[list[DailyUserActivity]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    weight_history: Mapped[list[WeightHistory]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    weight_goals: Mapped[list[WeightGoal]] = relationship(cascade="all, delete-orphan")
    weigh_reminder: Mapped[WeighInReminder | None] = relationship(uselist=False, cascade="all, delete-orphan")
    weight_reminder_events: Mapped[list[WeightReminderEvent]] = relationship(cascade="all, delete-orphan")
    achievements: Mapped[list[AchievementAward]] = relationship(cascade="all, delete-orphan")
    achievement_messages: Mapped[list[AchievementMessage]] = relationship(cascade="all, delete-orphan")
    health_connections: Mapped[list[HealthConnection]] = relationship(cascade="all, delete-orphan")
    health_days: Mapped[list[HealthDailySummary]] = relationship(cascade="all, delete-orphan")
    health_records: Mapped[list[HealthRecord]] = relationship(cascade="all, delete-orphan")
    health_receipts: Mapped[list[HealthSyncReceipt]] = relationship(cascade="all, delete-orphan")
    payments: Mapped[list[Payment]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    analyses: Mapped[list[AIAnalysis]] = relationship(
        cascade="all, delete-orphan",
        foreign_keys="AIAnalysis.user_id",
    )
    mobile_logins: Mapped[list[MobileLoginChallenge]] = relationship(
        cascade="all, delete-orphan"
    )
    referrer: Mapped[User | None] = relationship(
        remote_side=[id],
        foreign_keys=[referred_by_user_id],
    )
    survey_response: Mapped[SurveyResponse | None] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    diary_nudges: Mapped[list[DiaryNudge]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    coach_reviews: Mapped[list[CoachReview]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class AuthRateLimit(Base):
    __tablename__ = "auth_rate_limits"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False)
    resets_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class PasswordResetCode(Base):
    __tablename__ = "password_reset_codes"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    height_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sex: Mapped[Sex | None] = mapped_column(_pg_enum(Sex, "sex_enum"), nullable=True)
    goal: Mapped[Goal | None] = mapped_column(
        _pg_enum(Goal, "goal_enum"), nullable=True
    )
    activity_level: Mapped[ActivityLevel | None] = mapped_column(
        _pg_enum(ActivityLevel, "activity_level_enum"), nullable=True
    )
    daily_calorie_target: Mapped[float] = mapped_column(Float)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="profile")

    def is_complete(self) -> bool:
        return all(
            value is not None
            for value in (
                self.weight_kg,
                self.height_cm,
                self.age,
                self.sex,
                self.goal,
                self.activity_level,
            )
        )


class WeightHistory(Base):
    __tablename__ = "weight_history"
    __table_args__ = (UniqueConstraint("user_id", "operation_key", name="uq_weight_operation"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    weight_kg: Mapped[float] = mapped_column(Float)
    operation_key: Mapped[str | None] = mapped_column(String(160), nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    user: Mapped[User] = relationship(back_populates="weight_history")


class WeightGoal(Base):
    __tablename__ = "weight_goals"
    __table_args__ = (UniqueConstraint("user_id", "active_slot", name="uq_active_weight_goal"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    active_slot: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(16))
    direction: Mapped[str] = mapped_column(String(16))
    start_weight_kg: Mapped[float] = mapped_column(Float)
    target_weight_kg: Mapped[float] = mapped_column(Float)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WeighInReminder(Base):
    __tablename__ = "weigh_in_reminders"
    __table_args__ = (CheckConstraint("weekday >= 0 AND weekday <= 6", name="ck_weigh_weekday"),)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    weekday: Mapped[int] = mapped_column(Integer, default=0)
    local_time: Mapped[str] = mapped_column(String(5), default="09:00")


class WeightReminderEvent(Base):
    __tablename__ = "weight_reminder_events"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    week_start: Mapped[date] = mapped_column(Date, primary_key=True)
    local_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AchievementAward(Base):
    __tablename__ = "achievement_awards"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    awarded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AchievementMessage(Base):
    __tablename__ = "achievement_messages"
    __table_args__ = (UniqueConstraint("user_id", "event_key", name="uq_achievement_message_event"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    event_key: Mapped[str] = mapped_column(String(100))
    title: Mapped[str] = mapped_column(String(120))
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    telegram_status: Mapped[str] = mapped_column(String(16), default="pending", index=True)


class DayEntry(Base):
    __tablename__ = "day_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    entry_date: Mapped[datetime] = mapped_column(Date, index=True)
    entry_type: Mapped[EntryType] = mapped_column(
        _pg_enum(EntryType, "entry_type_enum")
    )
    title: Mapped[str] = mapped_column(String(255))
    calories: Mapped[float] = mapped_column(Float)
    protein_g: Mapped[float] = mapped_column(Float, default=0.0)
    fat_g: Mapped[float] = mapped_column(Float, default=0.0)
    carbs_g: Mapped[float] = mapped_column(Float, default=0.0)
    micronutrients: Mapped[dict[str, Any] | None] = mapped_column(
        json_column(), nullable=True
    )
    items: Mapped[list[dict[str, Any]] | None] = mapped_column(
        json_column(), nullable=True
    )
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    meal_slot: Mapped[str | None] = mapped_column(String(32), nullable=True)
    volume_ml: Mapped[float | None] = mapped_column(Float, nullable=True)
    ai_analysis_id: Mapped[int | None] = mapped_column(
        ForeignKey("ai_analyses.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="entries")
    ai_analysis: Mapped[AIAnalysis | None] = relationship(back_populates="entry")


class AIAnalysis(Base):
    __tablename__ = "ai_analyses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    analysis_type: Mapped[AnalysisType] = mapped_column(
        _pg_enum(AnalysisType, "analysis_type_enum")
    )
    input_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    previous_analysis_id: Mapped[int | None] = mapped_column(
        ForeignKey("ai_analyses.id"), nullable=True
    )
    raw_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    parsed_json: Mapped[dict[str, Any] | None] = mapped_column(
        json_column(), nullable=True
    )
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    entry: Mapped[DayEntry | None] = relationship(back_populates="ai_analysis")
    previous_analysis: Mapped[AIAnalysis | None] = relationship(remote_side=[id])


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    telegram_payment_charge_id: Mapped[str] = mapped_column(String(255), unique=True)
    stars_amount: Mapped[int] = mapped_column(Integer)
    subscription_until: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped[User] = relationship(back_populates="payments")


class DailyRequestUsage(Base):
    __tablename__ = "daily_request_usage"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "usage_date", name="uq_daily_request_usage_user_date"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    usage_date: Mapped[datetime] = mapped_column(Date, index=True)
    request_count: Mapped[int] = mapped_column(Integer, default=0)
    photo_count: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    text_count: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    voice_count: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="daily_request_usage")


class DiaryNudge(Base):
    __tablename__ = "diary_nudges"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "kind",
            "last_entry_date",
            name="uq_diary_nudges_user_kind_last_entry",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(16))
    last_entry_date: Mapped[date] = mapped_column(Date)
    local_date: Mapped[date] = mapped_column(Date, index=True)
    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped[User] = relationship(back_populates="diary_nudges")


class CoachReview(Base):
    __tablename__ = "coach_reviews"
    __table_args__ = (
        UniqueConstraint("user_id", "week_start", name="uq_coach_reviews_user_week"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    week_start: Mapped[date] = mapped_column(Date, index=True)
    facts: Mapped[dict[str, Any]] = mapped_column(json_column())
    review_text: Mapped[str] = mapped_column(Text)
    refresh_used: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    push_sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="coach_reviews")


class DailyUserActivity(Base):
    __tablename__ = "daily_user_activity"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "activity_date",
            name="uq_daily_user_activity_user_date",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    activity_date: Mapped[date] = mapped_column(Date, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped[User] = relationship(back_populates="daily_activity")


class FavoriteMeal(Base):
    __tablename__ = "favorite_meals"
    __table_args__ = (
        Index("uq_favorite_meals_user_source_entry", "user_id", "source_entry_id", unique=True,
              postgresql_where=text("source_entry_id IS NOT NULL"),
              sqlite_where=text("source_entry_id IS NOT NULL")),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    source_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("day_entries.id", ondelete="SET NULL"), nullable=True, index=True
    )
    entry_type: Mapped[EntryType] = mapped_column(
        _pg_enum(EntryType, "entry_type_enum"),
        default=EntryType.MEAL,
    )
    title: Mapped[str] = mapped_column(String(255))
    calories: Mapped[float] = mapped_column(Float)
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    volume_ml: Mapped[float | None] = mapped_column(Float, nullable=True)
    protein_g: Mapped[float] = mapped_column(Float, default=0.0)
    fat_g: Mapped[float] = mapped_column(Float, default=0.0)
    carbs_g: Mapped[float] = mapped_column(Float, default=0.0)
    micronutrients: Mapped[dict[str, Any] | None] = mapped_column(
        json_column(), nullable=True
    )
    items: Mapped[list[dict[str, Any]] | None] = mapped_column(
        json_column(), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped[User] = relationship(back_populates="favorites")


class SurveyResponse(Base):
    __tablename__ = "survey_responses"
    __table_args__ = (UniqueConstraint("user_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    app_rating: Mapped[int] = mapped_column(Integer)
    photo_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    feedback_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped[User] = relationship(back_populates="survey_response")


class MarketingCampaign(Base):
    __tablename__ = "marketing_campaigns"
    __table_args__ = (UniqueConstraint("source"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    spend_usd: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")
    reach: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class MobileLoginChallenge(Base):
    __tablename__ = "mobile_login_challenges"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class MobileOperation(Base):
    __tablename__ = "mobile_operations"
    __table_args__ = (UniqueConstraint("user_id", "request_key"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    request_key: Mapped[str] = mapped_column(String(100))
    kind: Mapped[str] = mapped_column(String(24))
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    payload: Mapped[dict] = mapped_column(json_column(), default=dict)
    result: Mapped[dict | None] = mapped_column(json_column(), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("day_entries.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class MobileMedia(Base):
    __tablename__ = "mobile_media"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    operation_id: Mapped[str | None] = mapped_column(
        ForeignKey("mobile_operations.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    mime: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(Integer)
    transcript: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    channel: Mapped[str] = mapped_column(String(16), default="telegram")


class PushDevice(Base):
    __tablename__ = "push_devices"
    token: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    platform: Mapped[str] = mapped_column(String(12))


class PushDelivery(Base):
    __tablename__ = "push_deliveries"
    __table_args__ = (UniqueConstraint("user_id", "event_key", "token"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    event_key: Mapped[str] = mapped_column(String(150))
    token: Mapped[str] = mapped_column(String(255))
    payload: Mapped[dict] = mapped_column(json_column())
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    ticket: Mapped[str | None] = mapped_column(String(100), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class HealthConnection(Base):
    __tablename__ = "health_connections"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    installation_id: Mapped[str] = mapped_column(String(36))
    generation: Mapped[str] = mapped_column(String(36))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    permissions: Mapped[list] = mapped_column(json_column(), default=list)
    workout_origin: Mapped[str | None] = mapped_column(String(255), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    connected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class HealthDailySummary(Base):
    __tablename__ = "health_daily_summaries"
    __table_args__ = (UniqueConstraint("user_id", "local_date"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    local_date: Mapped[date] = mapped_column(Date)
    timezone: Mapped[str] = mapped_column(String(64))
    values: Mapped[dict] = mapped_column(json_column(), default=dict)
    origins: Mapped[list] = mapped_column(json_column(), default=list)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class HealthRecord(Base):
    __tablename__ = "health_records"
    __table_args__ = (UniqueConstraint("user_id", "generation", "record_type", "external_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    generation: Mapped[str] = mapped_column(String(36))
    record_type: Mapped[str] = mapped_column(String(32))
    external_id: Mapped[str] = mapped_column(String(200))
    origin: Mapped[str] = mapped_column(String(255))
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    values: Mapped[dict] = mapped_column(json_column(), default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class HealthSyncReceipt(Base):
    __tablename__ = "health_sync_receipts"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    digest: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(json_column())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
