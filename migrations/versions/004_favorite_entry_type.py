"""Add entry type and duration to favorite meals."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "004_favorite_entry_type"
down_revision: Union[str, None] = "003_daily_request_limit"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

entry_type_enum = postgresql.ENUM("meal", "activity", name="entry_type_enum", create_type=False)


def upgrade() -> None:
    op.add_column(
        "favorite_meals",
        sa.Column(
            "entry_type",
            entry_type_enum,
            nullable=False,
            server_default="meal",
        ),
    )
    op.add_column("favorite_meals", sa.Column("duration_minutes", sa.Integer(), nullable=True))
    op.alter_column("favorite_meals", "entry_type", server_default=None)


def downgrade() -> None:
    op.drop_column("favorite_meals", "duration_minutes")
    op.drop_column("favorite_meals", "entry_type")
