"""Pending email registrations; accounts are created only after verification."""
from alembic import op
import sqlalchemy as sa

revision = "025_email_verification"
down_revision = "024_workouts"
branch_labels = depends_on = None


def upgrade():
    op.create_table("email_registrations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_email_registrations_email", "email_registrations", ["email"], unique=True)


def downgrade():
    op.drop_index("ix_email_registrations_email", table_name="email_registrations")
    op.drop_table("email_registrations")
