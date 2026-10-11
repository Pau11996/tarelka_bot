"""Store one-time codes that link the mobile app to a Telegram user."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "012_mobile_login"
down_revision: Union[str, None] = "011_diary_nudges"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "mobile_login_challenges",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_mobile_login_challenges_user_id",
        "mobile_login_challenges",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_mobile_login_challenges_user_id", table_name="mobile_login_challenges")
    op.drop_table("mobile_login_challenges")
