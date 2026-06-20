"""Add favorite meals table."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "002_favorite_meals"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "favorite_meals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "source_entry_id",
            sa.Integer(),
            sa.ForeignKey("day_entries.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("calories", sa.Float(), nullable=False),
        sa.Column("protein_g", sa.Float(), nullable=False, server_default="0"),
        sa.Column("fat_g", sa.Float(), nullable=False, server_default="0"),
        sa.Column("carbs_g", sa.Float(), nullable=False, server_default="0"),
        sa.Column("micronutrients", postgresql.JSONB(), nullable=True),
        sa.Column("items", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_favorite_meals_user_id", "favorite_meals", ["user_id"])
    op.create_index("ix_favorite_meals_source_entry_id", "favorite_meals", ["source_entry_id"])
    op.create_index(
        "uq_favorite_meals_user_source_entry",
        "favorite_meals",
        ["user_id", "source_entry_id"],
        unique=True,
        postgresql_where=sa.text("source_entry_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_favorite_meals_user_source_entry", table_name="favorite_meals")
    op.drop_index("ix_favorite_meals_source_entry_id", table_name="favorite_meals")
    op.drop_index("ix_favorite_meals_user_id", table_name="favorite_meals")
    op.drop_table("favorite_meals")
