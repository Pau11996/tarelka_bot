"""Add subscription fields and payments table."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "006_subscription"
down_revision: Union[str, None] = "005_weight_history"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("subscription_until", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("subscription_last_notified_until", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "payments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("telegram_payment_charge_id", sa.String(length=255), nullable=False),
        sa.Column("stars_amount", sa.Integer(), nullable=False),
        sa.Column("subscription_until", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("telegram_payment_charge_id", name="uq_payments_telegram_payment_charge_id"),
    )
    op.create_index("ix_payments_user_id", "payments", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_payments_user_id", table_name="payments")
    op.drop_table("payments")
    op.drop_column("users", "subscription_last_notified_until")
    op.drop_column("users", "subscription_until")
