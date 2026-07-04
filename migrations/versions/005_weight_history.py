"""Add weight history table."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "005_weight_history"
down_revision: Union[str, None] = "004_favorite_entry_type"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "weight_history",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("weight_kg", sa.Float(), nullable=False),
        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_weight_history_user_id", "weight_history", ["user_id"])
    op.create_index("ix_weight_history_recorded_at", "weight_history", ["recorded_at"])

    op.execute(
        sa.text(
            """
            INSERT INTO weight_history (user_id, weight_kg, recorded_at)
            SELECT user_id, weight_kg, updated_at
            FROM profiles
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_weight_history_recorded_at", table_name="weight_history")
    op.drop_index("ix_weight_history_user_id", table_name="weight_history")
    op.drop_table("weight_history")
