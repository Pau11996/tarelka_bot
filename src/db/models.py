from __future__ import annotations

from datetime import date, datetime
from enum import Enum as PyEnum
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


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


class AnalysisType(str, PyEnum):
    FOOD_PHOTO = "food_photo"
    FOOD_TEXT = "food_text"
    ACTIVITY_TEXT = "activity_text"
    ACTIVITY_PHOTO = "activity_photo"
    CORRECTION = "correction"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    timezone: Mapped[str] = mapped_column(String(64), default="Europe/Moscow")
    daily_request_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    subscription_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    subscription_last_notified_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    acquisition_source: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
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
    bonus_requests: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    profile: Mapped[Profile | None] = relationship(back_populates="user", uselist=False)
    entries: Mapped[list[DayEntry]] = relationship(back_populates="user")
    favorites: Mapped[list[FavoriteMeal]] = relationship(back_populates="user")
    daily_request_usage: Mapped[list[DailyRequestUsage]] = relationship(back_populates="user")
    daily_activity: Mapped[list[DailyUserActivity]] = relationship(back_populates="user")
    weight_history: Mapped[list[WeightHistory]] = relationship(back_populates="user")
    payments: Mapped[list[Payment]] = relationship(back_populates="user")
    referrer: Mapped[User | None] = relationship(
        remote_side=[id],
        foreign_keys=[referred_by_user_id],
    )
    survey_response: Mapped[SurveyResponse | None] = relationship(
        back_populates="user", uselist=False
    )
    diary_nudges: Mapped[list[DiaryNudge]] = relationship(back_populates="user")


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    height_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sex: Mapped[Sex | None] = mapped_column(_pg_enum(Sex, "sex_enum"), nullable=True)
    goal: Mapped[Goal | None] = mapped_column(_pg_enum(Goal, "goal_enum"), nullable=True)
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

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    weight_kg: Mapped[float] = mapped_column(Float)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    user: Mapped[User] = relationship(back_populates="weight_history")


class DayEntry(Base):
    __tablename__ = "day_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    entry_date: Mapped[datetime] = mapped_column(Date, index=True)
    entry_type: Mapped[EntryType] = mapped_column(_pg_enum(EntryType, "entry_type_enum"))
    title: Mapped[str] = mapped_column(String(255))
    calories: Mapped[float] = mapped_column(Float)
    protein_g: Mapped[float] = mapped_column(Float, default=0.0)
    fat_g: Mapped[float] = mapped_column(Float, default=0.0)
    carbs_g: Mapped[float] = mapped_column(Float, default=0.0)
    micronutrients: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    items: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ai_analysis_id: Mapped[int | None] = mapped_column(ForeignKey("ai_analyses.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="entries")
    ai_analysis: Mapped[AIAnalysis | None] = relationship(back_populates="entry")


class AIAnalysis(Base):
    __tablename__ = "ai_analyses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    analysis_type: Mapped[AnalysisType] = mapped_column(_pg_enum(AnalysisType, "analysis_type_enum"))
    input_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    previous_analysis_id: Mapped[int | None] = mapped_column(
        ForeignKey("ai_analyses.id"), nullable=True
    )
    raw_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    parsed_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    entry: Mapped[DayEntry | None] = relationship(back_populates="ai_analysis")
    previous_analysis: Mapped[AIAnalysis | None] = relationship(remote_side=[id])


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    telegram_payment_charge_id: Mapped[str] = mapped_column(String(255), unique=True)
    stars_amount: Mapped[int] = mapped_column(Integer)
    subscription_until: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(back_populates="payments")


class DailyRequestUsage(Base):
    __tablename__ = "daily_request_usage"
    __table_args__ = (UniqueConstraint("user_id", "usage_date", name="uq_daily_request_usage_user_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    usage_date: Mapped[datetime] = mapped_column(Date, index=True)
    request_count: Mapped[int] = mapped_column(Integer, default=0)
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
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    last_entry_date: Mapped[date] = mapped_column(Date)
    local_date: Mapped[date] = mapped_column(Date, index=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(back_populates="diary_nudges")


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

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
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
    protein_g: Mapped[float] = mapped_column(Float, default=0.0)
    fat_g: Mapped[float] = mapped_column(Float, default=0.0)
    carbs_g: Mapped[float] = mapped_column(Float, default=0.0)
    micronutrients: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    items: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(back_populates="favorites")


class SurveyResponse(Base):
    __tablename__ = "survey_responses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True
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
