"""Shared favorite order, retaining the existing newest-first list."""
from alembic import op
import sqlalchemy as sa

revision = "023_favorite_order"
down_revision = "022_email_password_reset"
branch_labels = depends_on = None


def upgrade():
    op.add_column("favorite_meals", sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False))
    op.execute("""
        WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (
                PARTITION BY user_id ORDER BY created_at DESC, id DESC
            ) - 1 AS position
            FROM favorite_meals
        )
        UPDATE favorite_meals SET sort_order = (
            SELECT position FROM ranked WHERE ranked.id = favorite_meals.id
        )
    """)
    op.create_index("ix_favorite_meals_user_order", "favorite_meals", ["user_id", "sort_order"])


def downgrade():
    op.drop_index("ix_favorite_meals_user_order", table_name="favorite_meals")
    op.drop_column("favorite_meals", "sort_order")
