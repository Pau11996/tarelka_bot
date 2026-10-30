"""App workout sessions and account preferences."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "024_workouts"
down_revision = "023_favorite_order"
branch_labels = depends_on = None


def upgrade():
    op.create_table("workout_preferences",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("auto_log", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sound", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_table("workout_sessions",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("workout_id", sa.String(64), nullable=False),
        sa.Column("catalogue_version", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("active_seconds", sa.Float(), nullable=False),
        sa.Column("rest_seconds", sa.Float(), nullable=False),
        sa.Column("steps", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=False),
        sa.Column("weight_kg", sa.Float(), nullable=True),
        sa.Column("calories", sa.Float(), nullable=True),
        sa.Column("auto_log", sa.Boolean(), nullable=False),
        sa.Column("diary_added", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("diary_entry_id", sa.Integer(), sa.ForeignKey("day_entries.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_workout_sessions_local_date", "workout_sessions", ["local_date"])


def downgrade():
    op.drop_index("ix_workout_sessions_local_date", table_name="workout_sessions")
    op.drop_table("workout_sessions")
    op.drop_table("workout_preferences")
