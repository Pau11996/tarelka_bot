"""Google identities and single-use sign-in challenges."""

import sqlalchemy as sa
from alembic import op

revision = "027_google_login"
down_revision = "026_workout_course"
branch_labels = depends_on = None


def upgrade():
    op.add_column("users", sa.Column("google_subject", sa.String(255), nullable=True))
    op.create_index("ix_users_google_subject", "users", ["google_subject"], unique=True)
    op.drop_constraint("ck_users_login_identity", "users", type_="check")
    op.create_check_constraint("ck_users_login_identity", "users",
        "(telegram_id IS NOT NULL AND email IS NULL AND password_hash IS NULL AND google_subject IS NULL) OR "
        "(telegram_id IS NULL AND email IS NOT NULL AND (password_hash IS NOT NULL OR google_subject IS NOT NULL))")
    op.create_table("google_login_challenges",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("nonce_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_google_login_challenges_expires_at", "google_login_challenges", ["expires_at"])


def downgrade():
    if op.get_bind().execute(sa.text("SELECT 1 FROM users WHERE google_subject IS NOT NULL AND password_hash IS NULL LIMIT 1")).first():
        raise RuntimeError("Google-only accounts exist; add another login method before downgrading")
    op.drop_table("google_login_challenges")
    op.drop_constraint("ck_users_login_identity", "users", type_="check")
    op.create_check_constraint("ck_users_login_identity", "users",
        "(telegram_id IS NOT NULL AND email IS NULL AND password_hash IS NULL) OR "
        "(telegram_id IS NULL AND email IS NOT NULL AND password_hash IS NOT NULL)")
    op.drop_index("ix_users_google_subject", table_name="users")
    op.drop_column("users", "google_subject")
