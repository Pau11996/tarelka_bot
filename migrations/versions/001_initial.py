"""Initial schema."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

sex_enum = postgresql.ENUM("male", "female", name="sex_enum", create_type=False)
goal_enum = postgresql.ENUM("lose", "maintain", "gain", name="goal_enum", create_type=False)
activity_level_enum = postgresql.ENUM(
    "sedentary", "light", "moderate", "active", "very_active", name="activity_level_enum", create_type=False
)
entry_type_enum = postgresql.ENUM("meal", "activity", name="entry_type_enum", create_type=False)
analysis_type_enum = postgresql.ENUM(
    "food_photo",
    "food_text",
    "activity_text",
    "activity_photo",
    "correction",
    name="analysis_type_enum",
    create_type=False,
)


def upgrade() -> None:
    sex_enum.create(op.get_bind(), checkfirst=True)
    goal_enum.create(op.get_bind(), checkfirst=True)
    activity_level_enum.create(op.get_bind(), checkfirst=True)
    entry_type_enum.create(op.get_bind(), checkfirst=True)
    analysis_type_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("telegram_id", sa.BigInteger(), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False, server_default="Europe/Moscow"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_users_telegram_id", "users", ["telegram_id"], unique=True)

    op.create_table(
        "profiles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("weight_kg", sa.Float(), nullable=False),
        sa.Column("height_cm", sa.Float(), nullable=False),
        sa.Column("age", sa.Integer(), nullable=False),
        sa.Column("sex", sex_enum, nullable=False),
        sa.Column("goal", goal_enum, nullable=False),
        sa.Column("activity_level", activity_level_enum, nullable=False),
        sa.Column("daily_calorie_target", sa.Float(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("user_id"),
    )

    op.create_table(
        "ai_analyses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("analysis_type", analysis_type_enum, nullable=False),
        sa.Column("input_text", sa.Text(), nullable=True),
        sa.Column("image_path", sa.String(length=512), nullable=True),
        sa.Column("previous_analysis_id", sa.Integer(), sa.ForeignKey("ai_analyses.id"), nullable=True),
        sa.Column("raw_response", sa.Text(), nullable=True),
        sa.Column("parsed_json", postgresql.JSONB(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_ai_analyses_user_id", "ai_analyses", ["user_id"])

    op.create_table(
        "day_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entry_date", sa.Date(), nullable=False),
        sa.Column("entry_type", entry_type_enum, nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("calories", sa.Float(), nullable=False),
        sa.Column("protein_g", sa.Float(), nullable=False, server_default="0"),
        sa.Column("fat_g", sa.Float(), nullable=False, server_default="0"),
        sa.Column("carbs_g", sa.Float(), nullable=False, server_default="0"),
        sa.Column("micronutrients", postgresql.JSONB(), nullable=True),
        sa.Column("items", postgresql.JSONB(), nullable=True),
        sa.Column("duration_minutes", sa.Integer(), nullable=True),
        sa.Column("ai_analysis_id", sa.Integer(), sa.ForeignKey("ai_analyses.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_day_entries_user_id", "day_entries", ["user_id"])
    op.create_index("ix_day_entries_entry_date", "day_entries", ["entry_date"])


def downgrade() -> None:
    op.drop_table("day_entries")
    op.drop_table("ai_analyses")
    op.drop_table("profiles")
    op.drop_index("ix_users_telegram_id", table_name="users")
    op.drop_table("users")

    analysis_type_enum.drop(op.get_bind(), checkfirst=True)
    entry_type_enum.drop(op.get_bind(), checkfirst=True)
    activity_level_enum.drop(op.get_bind(), checkfirst=True)
    goal_enum.drop(op.get_bind(), checkfirst=True)
    sex_enum.drop(op.get_bind(), checkfirst=True)
