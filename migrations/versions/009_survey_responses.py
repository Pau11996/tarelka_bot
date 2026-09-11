"""Add one-time survey responses table."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "009_survey_responses"
down_revision: Union[str, None] = "008_growth_foundation"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "survey_responses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("app_rating", sa.Integer(), nullable=False),
        sa.Column("photo_rating", sa.Integer(), nullable=True),
        sa.Column("feedback_text", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index("ix_survey_responses_user_id", "survey_responses", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_survey_responses_user_id", table_name="survey_responses")
    op.drop_table("survey_responses")
