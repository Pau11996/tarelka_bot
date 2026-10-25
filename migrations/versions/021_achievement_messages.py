"""Persistent goal congratulations and corrected first weigh-in eligibility."""
from alembic import op
import sqlalchemy as sa

revision = "021_achievement_messages"
down_revision = "020_weight_goals"
branch_labels = depends_on = None


def upgrade():
    op.create_table("achievement_messages",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_key", sa.String(100), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("telegram_status", sa.String(16), nullable=False),
        sa.UniqueConstraint("user_id", "event_key", name="uq_achievement_message_event"))
    op.create_index("ix_achievement_messages_user_id", "achievement_messages", ["user_id"])
    op.create_index("ix_achievement_messages_telegram_status", "achievement_messages", ["telegram_status"])
    # The old rule awarded the initial profile weight. Retract only these premature
    # awards; the second measurement can earn them under the corrected rule.
    op.execute("""
        DELETE FROM achievement_awards
        WHERE key = 'first_weigh_in' AND
          (SELECT COUNT(*) FROM weight_history w
           WHERE w.user_id = achievement_awards.user_id AND w.weight_kg > 0) +
          (SELECT COUNT(*) FROM health_records h
           WHERE h.user_id = achievement_awards.user_id AND h.record_type = 'Weight') < 2
    """)


def downgrade():
    op.drop_table("achievement_messages")
