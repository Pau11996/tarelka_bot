"""Add users.acquisition_source for marketing start payloads."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "007_acquisition_source"
down_revision: Union[str, None] = "006_subscription"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("acquisition_source", sa.String(length=64), nullable=True),
    )
    op.create_index("ix_users_acquisition_source", "users", ["acquisition_source"])


def downgrade() -> None:
    op.drop_index("ix_users_acquisition_source", table_name="users")
    op.drop_column("users", "acquisition_source")
