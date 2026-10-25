"""Persistent mobile conversations, jobs and notification delivery."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "017_mobile_experience"
down_revision = "016_referral_subscription_month"
branch_labels = depends_on = None
J = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade():
    op.create_table(
        "mobile_operations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("request_key", sa.String(100), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("payload", J, nullable=False),
        sa.Column("result", J),
        sa.Column("error", sa.Text),
        sa.Column(
            "entry_id", sa.Integer, sa.ForeignKey("day_entries.id", ondelete="SET NULL")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("user_id", "request_key"),
    )
    for col in ("user_id", "status", "entry_id"):
        op.create_index("ix_mobile_operations_" + col, "mobile_operations", [col])
    op.create_table(
        "mobile_media",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "operation_id",
            sa.String(36),
            sa.ForeignKey("mobile_operations.id", ondelete="CASCADE"),
        ),
        sa.Column("mime", sa.String(100), nullable=False),
        sa.Column("size", sa.Integer, nullable=False),
        sa.Column("transcript", sa.Text),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    for col in ("user_id", "operation_id"):
        op.create_index("ix_mobile_media_" + col, "mobile_media", [col])
    op.create_table(
        "notification_preferences",
        sa.Column(
            "user_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("channel", sa.String(16), nullable=False),
    )
    op.create_table(
        "push_devices",
        sa.Column("token", sa.String(255), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("enabled", sa.Boolean, nullable=False),
        sa.Column("platform", sa.String(12), nullable=False),
    )
    op.create_index("ix_push_devices_user_id", "push_devices", ["user_id"])
    op.create_table(
        "push_deliveries",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_key", sa.String(150), nullable=False),
        sa.Column("token", sa.String(255), nullable=False),
        sa.Column("payload", J, nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("ticket", sa.String(100)),
        sa.Column("attempts", sa.Integer, nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("user_id", "event_key", "token"),
    )
    for col in ("user_id", "status"):
        op.create_index("ix_push_deliveries_" + col, "push_deliveries", [col])


def downgrade():
    for name in (
        "push_deliveries",
        "push_devices",
        "notification_preferences",
        "mobile_media",
        "mobile_operations",
    ):
        op.drop_table(name)
