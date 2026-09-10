"""Allow incomplete default profiles with only calorie target."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "010_optional_profile_fields"
down_revision: Union[str, None] = "009_survey_responses"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NULLABLE_COLUMNS = (
    "weight_kg",
    "height_cm",
    "age",
    "sex",
    "goal",
    "activity_level",
)


def upgrade() -> None:
    for column_name in _NULLABLE_COLUMNS:
        op.alter_column("profiles", column_name, existing_nullable=False, nullable=True)


def downgrade() -> None:
    for column_name in _NULLABLE_COLUMNS:
        op.alter_column("profiles", column_name, existing_nullable=True, nullable=False)
