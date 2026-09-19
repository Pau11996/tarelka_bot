"""Store diary nudge sends so restarts cannot double-send."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "011_diary_nudges"
down_revision: Union[str, None] = "010_optional_profile_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "diary_nudges",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("last_entry_date", sa.Date(), nullable=False),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column(
            "sent_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "user_id",
            "kind",
            "last_entry_date",
            name="uq_diary_nudges_user_kind_last_entry",
        ),
    )
    op.create_index("ix_diary_nudges_user_id", "diary_nudges", ["user_id"])
    op.create_index("ix_diary_nudges_local_date", "diary_nudges", ["local_date"])


def downgrade() -> None:
    op.drop_index("ix_diary_nudges_local_date", table_name="diary_nudges")
    op.drop_index("ix_diary_nudges_user_id", table_name="diary_nudges")
    op.drop_table("diary_nudges")
