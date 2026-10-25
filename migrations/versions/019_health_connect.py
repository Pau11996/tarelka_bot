"""Read-only Health Connect imports, separate from manual diary entries."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

revision = "019_health_connect"
down_revision = "018_email_accounts"
branch_labels = depends_on = None


def upgrade():
    op.create_table("health_connections",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("installation_id", sa.String(36), nullable=False),
        sa.Column("generation", sa.String(36), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("permissions", JSON, nullable=False),
        sa.Column("workout_origin", sa.String(255)),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("connected_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_sync_at", sa.DateTime(timezone=True)))
    op.create_table("health_daily_summaries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("values", JSON, nullable=False),
        sa.Column("origins", JSON, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "local_date"))
    op.create_index("ix_health_daily_summaries_user_id", "health_daily_summaries", ["user_id"])
    op.create_table("health_records",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("generation", sa.String(36), nullable=False),
        sa.Column("record_type", sa.String(32), nullable=False),
        sa.Column("external_id", sa.String(200), nullable=False),
        sa.Column("origin", sa.String(255), nullable=False),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True)),
        sa.Column("values", JSON, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "generation", "record_type", "external_id"))
    op.create_index("ix_health_records_user_id", "health_records", ["user_id"])
    op.create_index("ix_health_records_start_at", "health_records", ["start_at"])
    op.create_table("health_sync_receipts",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("batch_id", sa.String(36), primary_key=True),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("result", JSON, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))


def downgrade():
    op.drop_table("health_sync_receipts")
    op.drop_table("health_records")
    op.drop_table("health_daily_summaries")
    op.drop_table("health_connections")
