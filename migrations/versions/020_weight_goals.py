"""Shared weight goals, measurements, achievements and weekly reminders."""
from alembic import op
import sqlalchemy as sa

revision = "020_weight_goals"
down_revision = "019_health_connect"
branch_labels = depends_on = None


def upgrade():
    with op.batch_alter_table("weight_history") as batch:
        batch.add_column(sa.Column("operation_key", sa.String(160), nullable=True))
        batch.create_unique_constraint("uq_weight_operation", ["user_id", "operation_key"])
    op.create_table("weight_goals",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("active_slot", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("direction", sa.String(16), nullable=False),
        sa.Column("start_weight_kg", sa.Float(), nullable=False),
        sa.Column("target_weight_kg", sa.Float(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("user_id", "active_slot", name="uq_active_weight_goal"))
    op.create_index("ix_weight_goals_user_id", "weight_goals", ["user_id"])
    op.create_table("weigh_in_reminders",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("local_time", sa.String(5), nullable=False),
        sa.CheckConstraint("weekday >= 0 AND weekday <= 6", name="ck_weigh_weekday"))
    op.create_table("weight_reminder_events",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("week_start", sa.Date(), primary_key=True),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_table("achievement_awards",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("key", sa.String(40), primary_key=True),
        sa.Column("awarded_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))


def downgrade():
    op.drop_table("achievement_awards")
    op.drop_table("weight_reminder_events")
    op.drop_table("weigh_in_reminders")
    op.drop_table("weight_goals")
    with op.batch_alter_table("weight_history") as batch:
        batch.drop_constraint("uq_weight_operation", type_="unique")
        batch.drop_column("operation_key")
