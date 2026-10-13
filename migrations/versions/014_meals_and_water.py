"""Store a meal occasion and drinking-water volume on diary entries."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "014_meals_and_water"
down_revision: Union[str, None] = "013_coach_reviews"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE entry_type_enum ADD VALUE IF NOT EXISTS 'water'")
    op.add_column("day_entries", sa.Column("meal_slot", sa.String(length=32), nullable=True))
    op.add_column("day_entries", sa.Column("volume_ml", sa.Float(), nullable=True))
    op.add_column("favorite_meals", sa.Column("volume_ml", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("favorite_meals", "volume_ml")
    op.drop_column("day_entries", "volume_ml")
    op.drop_column("day_entries", "meal_slot")
