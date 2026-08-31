"""Add growth analytics, campaigns, referrals, and notification preferences."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "008_growth_foundation"
down_revision: Union[str, None] = "007_acquisition_source"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "last_active_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.add_column(
        "users",
        sa.Column("reengagement_last_sent_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column(
            "notifications_enabled",
            sa.Boolean(),
            server_default=sa.true(),
            nullable=False,
        ),
    )
    op.add_column(
        "users",
        sa.Column("referral_code", sa.String(length=12), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column(
            "referred_by_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "users",
        sa.Column("referral_reward_granted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column(
            "bonus_requests",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
    )
    op.create_index("ix_users_last_active_at", "users", ["last_active_at"])
    op.create_index("ix_users_referral_code", "users", ["referral_code"], unique=True)
    op.create_index("ix_users_referred_by_user_id", "users", ["referred_by_user_id"])

    op.create_table(
        "daily_user_activity",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("activity_date", sa.Date(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "user_id",
            "activity_date",
            name="uq_daily_user_activity_user_date",
        ),
    )
    op.create_index(
        "ix_daily_user_activity_user_id",
        "daily_user_activity",
        ["user_id"],
    )
    op.create_index(
        "ix_daily_user_activity_activity_date",
        "daily_user_activity",
        ["activity_date"],
    )

    op.create_table(
        "marketing_campaigns",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=True),
        sa.Column("spend_usd", sa.Float(), server_default="0", nullable=False),
        sa.Column("reach", sa.Integer(), server_default="0", nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("source"),
    )
    op.create_index(
        "ix_marketing_campaigns_source",
        "marketing_campaigns",
        ["source"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_marketing_campaigns_source", table_name="marketing_campaigns")
    op.drop_table("marketing_campaigns")
    op.drop_index(
        "ix_daily_user_activity_activity_date",
        table_name="daily_user_activity",
    )
    op.drop_index("ix_daily_user_activity_user_id", table_name="daily_user_activity")
    op.drop_table("daily_user_activity")
    op.drop_index("ix_users_referred_by_user_id", table_name="users")
    op.drop_index("ix_users_referral_code", table_name="users")
    op.drop_index("ix_users_last_active_at", table_name="users")
    op.drop_column("users", "bonus_requests")
    op.drop_column("users", "referral_reward_granted_at")
    op.drop_column("users", "referred_by_user_id")
    op.drop_column("users", "referral_code")
    op.drop_column("users", "notifications_enabled")
    op.drop_column("users", "reengagement_last_sent_at")
    op.drop_column("users", "last_active_at")
