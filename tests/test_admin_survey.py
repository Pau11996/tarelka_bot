from __future__ import annotations

from typing import Any

import pytest

from src.ai_analyzer.broadcast import (
    BroadcastState,
    run_broadcast,
    survey_invitation_reply_markup,
)
from src.bot.services.survey_texts import SURVEY_INVITATION


def test_survey_invitation_reply_markup() -> None:
    markup = survey_invitation_reply_markup()
    assert markup == {
        "inline_keyboard": [
            [{"text": "Пройти опрос", "callback_data": "survey:start"}]
        ]
    }


@pytest.mark.asyncio
async def test_run_broadcast_with_reply_markup() -> None:
    state = BroadcastState()
    state.begin("me", 2)
    calls: list[tuple[int, str, dict[str, object] | None]] = []

    async def fake_send_with_markup(
        client: Any,
        token: str,
        chat_id: int,
        text: str,
        reply_markup: dict[str, object],
        *,
        retries_left: int = 3,
    ) -> str:
        calls.append((chat_id, text, reply_markup))
        return "sent"

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(
        "src.ai_analyzer.broadcast.send_telegram_message_with_markup",
        fake_send_with_markup,
    )
    try:
        snapshot = await run_broadcast(
            [11, 22],
            SURVEY_INVITATION,
            token="token",
            state=state,
            reply_markup=survey_invitation_reply_markup(),
            delay_seconds=0,
        )
    finally:
        monkeypatch.undo()

    assert snapshot.status == "done"
    assert snapshot.sent == 2
    assert calls == [
        (11, SURVEY_INVITATION, survey_invitation_reply_markup()),
        (22, SURVEY_INVITATION, survey_invitation_reply_markup()),
    ]


def test_survey_results_response_model_shapes() -> None:
    from src.ai_analyzer.admin import SurveyFeedbackItem, SurveyLaunchRequest, SurveyResultsResponse
    from src.ai_analyzer.broadcast import BroadcastAudience
    from datetime import datetime, timezone

    request = SurveyLaunchRequest(audience=BroadcastAudience.ME)
    assert request.audience is BroadcastAudience.ME

    results = SurveyResultsResponse(
        total_responses=2,
        avg_app_rating=4.5,
        avg_photo_rating=3.0,
        app_distribution={"1": 0, "2": 0, "3": 0, "4": 1, "5": 1},
        photo_distribution={"1": 0, "2": 0, "3": 2, "4": 0, "5": 0},
        photo_skipped=0,
        recent_feedback=[
            SurveyFeedbackItem(
                user_id=1,
                app_rating=5,
                photo_rating=3,
                feedback_text="хочу экспорт",
                created_at=datetime(2026, 9, 6, tzinfo=timezone.utc),
            )
        ],
    )
    assert results.total_responses == 2
    assert results.recent_feedback[0].feedback_text == "хочу экспорт"
