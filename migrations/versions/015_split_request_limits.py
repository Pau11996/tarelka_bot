"""Split free daily limits into photo, text, and voice counters."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "015_split_request_limits"
down_revision: Union[str, None] = "014_meals_and_water"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "legacy_photo_quota",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.execute("UPDATE users SET legacy_photo_quota = true")
    op.add_column(
        "daily_request_usage",
        sa.Column("photo_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "daily_request_usage",
        sa.Column("text_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "daily_request_usage",
        sa.Column("voice_count", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("daily_request_usage", "voice_count")
    op.drop_column("daily_request_usage", "text_count")
    op.drop_column("daily_request_usage", "photo_count")
    op.drop_column("users", "legacy_photo_quota")
