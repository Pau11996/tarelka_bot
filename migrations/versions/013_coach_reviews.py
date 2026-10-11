"""Store the weekly nutrition review so it is not regenerated or pushed twice."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "013_coach_reviews"
down_revision: Union[str, None] = "012_mobile_login"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "coach_reviews",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("facts", postgresql.JSONB(), nullable=False),
        sa.Column("review_text", sa.Text(), nullable=False),
        sa.Column("refresh_used", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("push_sent_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "week_start", name="uq_coach_reviews_user_week"),
    )
    op.create_index("ix_coach_reviews_user_id", "coach_reviews", ["user_id"])
    op.create_index("ix_coach_reviews_week_start", "coach_reviews", ["week_start"])


def downgrade() -> None:
    op.drop_index("ix_coach_reviews_week_start", table_name="coach_reviews")
    op.drop_index("ix_coach_reviews_user_id", table_name="coach_reviews")
    op.drop_table("coach_reviews")
