"""28-day workout course progress and duration preference."""
from alembic import op
import sqlalchemy as sa

revision = "026_workout_course"
down_revision = "025_email_verification"
branch_labels = depends_on = None


def upgrade():
    op.add_column("workout_preferences", sa.Column("activity_level", sa.String(16), nullable=False, server_default="medium"))
    op.create_table("workout_course_days",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("course_id", sa.String(64), primary_key=True),
        sa.Column("day", sa.Integer(), primary_key=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column("session_id", sa.String(36), nullable=True),
    )


def downgrade():
    op.drop_table("workout_course_days")
    op.drop_column("workout_preferences", "activity_level")
