"""Remember which calendar month already paid a referral subscription."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "016_referral_subscription_month"
down_revision: Union[str, None] = "015_split_request_limits"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("referral_subscription_month", sa.String(length=7), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "referral_subscription_month")
