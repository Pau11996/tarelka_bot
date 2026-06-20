"""Add daily request usage tracking and per-user limit override."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003_daily_request_limit"
down_revision: Union[str, None] = "002_favorite_meals"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("daily_request_limit", sa.Integer(), nullable=True))
    op.create_table(
        "daily_request_usage",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("usage_date", sa.Date(), nullable=False),
        sa.Column("request_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("user_id", "usage_date", name="uq_daily_request_usage_user_date"),
    )
    op.create_index("ix_daily_request_usage_user_id", "daily_request_usage", ["user_id"])
    op.create_index("ix_daily_request_usage_usage_date", "daily_request_usage", ["usage_date"])


def downgrade() -> None:
    op.drop_index("ix_daily_request_usage_usage_date", table_name="daily_request_usage")
    op.drop_index("ix_daily_request_usage_user_id", table_name="daily_request_usage")
    op.drop_table("daily_request_usage")
    op.drop_column("users", "daily_request_limit")
