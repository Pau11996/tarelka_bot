"""Allow independent email accounts alongside Telegram accounts."""

import sqlalchemy as sa
from alembic import op

revision = "018_email_accounts"
down_revision = "017_mobile_experience"
branch_labels = depends_on = None


def upgrade():
    op.alter_column("users", "telegram_id", existing_type=sa.BigInteger(), nullable=True)
    op.add_column("users", sa.Column("email", sa.String(254), nullable=True))
    op.add_column("users", sa.Column("password_hash", sa.String(255), nullable=True))
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_check_constraint(
        "ck_users_login_identity",
        "users",
        "(telegram_id IS NOT NULL AND email IS NULL AND password_hash IS NULL) OR "
        "(telegram_id IS NULL AND email IS NOT NULL AND password_hash IS NOT NULL)",
    )
    op.create_table(
        "auth_rate_limits",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("resets_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_auth_rate_limits_resets_at", "auth_rate_limits", ["resets_at"])


def downgrade():
    # Refuse a rollback that would discard accounts without Telegram identities.
    if op.get_bind().execute(sa.text("SELECT 1 FROM users WHERE telegram_id IS NULL LIMIT 1")).first():
        raise RuntimeError("Email accounts exist; migrate them before downgrading")
    op.drop_table("auth_rate_limits")
    op.drop_constraint("ck_users_login_identity", "users", type_="check")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_column("users", "password_hash")
    op.drop_column("users", "email")
    op.alter_column("users", "telegram_id", existing_type=sa.BigInteger(), nullable=False)
