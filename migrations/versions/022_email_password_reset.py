"""One-use email recovery codes and session revocation on password reset."""
from alembic import op
import sqlalchemy as sa

revision = "022_email_password_reset"
down_revision = "021_achievement_messages"
branch_labels = depends_on = None


def upgrade():
    op.add_column("users", sa.Column("auth_version", sa.Integer(), server_default="0", nullable=False))
    op.create_table("password_reset_codes",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False))


def downgrade():
    op.drop_table("password_reset_codes")
    op.drop_column("users", "auth_version")
