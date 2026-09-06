from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pytest

from src.bot.handlers.survey import _parse_rating
from src.bot.keyboards.menus import (
    survey_feedback_keyboard,
    survey_rating_keyboard,
    survey_start_keyboard,
)
from src.bot.services.survey_texts import (
    SURVEY_ALREADY_DONE,
    SURVEY_INVITATION,
    SURVEY_Q1_APP,
    SURVEY_Q2_PHOTO,
    SURVEY_Q3_FEEDBACK,
    SURVEY_THANKS,
)
from src.db.models import SurveyResponse


def test_survey_texts_cover_three_questions() -> None:
    assert "ТАРЕЛКУ" in SURVEY_Q1_APP
    assert "1 до 5" in SURVEY_Q1_APP
    assert "фото" in SURVEY_Q2_PHOTO.lower()
    assert "функционала" in SURVEY_Q3_FEEDBACK
    assert "минуту" in SURVEY_INVITATION
    assert SURVEY_THANKS
    assert SURVEY_ALREADY_DONE


def test_survey_start_keyboard() -> None:
    keyboard = survey_start_keyboard()
    assert keyboard.inline_keyboard[0][0].callback_data == "survey:start"
    assert "опрос" in keyboard.inline_keyboard[0][0].text.lower()


def test_survey_rating_keyboard_without_skip() -> None:
    keyboard = survey_rating_keyboard("survey:app")
    callbacks = [button.callback_data for button in keyboard.inline_keyboard[0]]
    assert callbacks == [
        "survey:app:1",
        "survey:app:2",
        "survey:app:3",
        "survey:app:4",
        "survey:app:5",
    ]
    assert len(keyboard.inline_keyboard) == 1


def test_survey_rating_keyboard_with_skip() -> None:
    keyboard = survey_rating_keyboard("survey:photo", allow_skip=True)
    assert keyboard.inline_keyboard[1][0].callback_data == "survey:photo:skip"


def test_survey_feedback_keyboard() -> None:
    keyboard = survey_feedback_keyboard()
    assert keyboard.inline_keyboard[0][0].callback_data == "survey:feedback:skip"


@pytest.mark.parametrize(
    ("data", "prefix", "expected"),
    [
        ("survey:app:5", "survey:app", 5),
        ("survey:app:1", "survey:app", 1),
        ("survey:app:0", "survey:app", None),
        ("survey:app:6", "survey:app", None),
        ("survey:app:skip", "survey:app", None),
        ("survey:photo:3", "survey:photo", 3),
        ("survey:photo:skip", "survey:photo", None),
        ("survey:app:x", "survey:app", None),
        ("other:1", "survey:app", None),
    ],
)
def test_parse_rating(data: str, prefix: str, expected: int | None) -> None:
    assert _parse_rating(data, prefix) == expected


@pytest.mark.asyncio
async def test_finish_survey_saves_response() -> None:
    from src.bot.handlers import survey as survey_module

    class FakeState:
        def __init__(self) -> None:
            self.data = {"app_rating": 4, "photo_rating": None}
            self.cleared = False

        async def get_data(self) -> dict[str, Any]:
            return self.data

        async def clear(self) -> None:
            self.cleared = True

    class FakeUser:
        def __init__(self) -> None:
            self.id = 42

    class FakeRepo:
        def __init__(self) -> None:
            self.saved: dict[str, Any] | None = None
            self.has_response = False

        async def get_or_create_user(self, telegram_id: int, timezone: str) -> FakeUser:
            assert telegram_id == 777
            return FakeUser()

        async def has_survey_response(self, user_id: int) -> bool:
            return self.has_response

        async def save_survey_response(
            self,
            user_id: int,
            *,
            app_rating: int,
            photo_rating: int | None,
            feedback_text: str | None,
        ) -> SurveyResponse:
            self.saved = {
                "user_id": user_id,
                "app_rating": app_rating,
                "photo_rating": photo_rating,
                "feedback_text": feedback_text,
            }
            return SurveyResponse(
                id=1,
                user_id=user_id,
                app_rating=app_rating,
                photo_rating=photo_rating,
                feedback_text=feedback_text,
                created_at=datetime.now(timezone.utc),
            )

    class FakeMessage:
        def __init__(self) -> None:
            self.answers: list[str] = []
            self.bot = object()
            self.chat = type("Chat", (), {"id": 1})()
            self.message_id = 10

        async def answer(self, text: str, **kwargs: Any) -> FakeMessage:
            self.answers.append(text)
            return self

    class FakeCleanup:
        def schedule(self, *args: Any, **kwargs: Any) -> None:
            return None

        def remember_menu_message(self, *args: Any, **kwargs: Any) -> None:
            return None

    repo = FakeRepo()
    state = FakeState()
    message = FakeMessage()
    monkeypatch_repo = pytest.MonkeyPatch()
    monkeypatch_repo.setattr(survey_module, "UserRepository", lambda session: repo)
    try:
        await survey_module._finish_survey(
            message=message,  # type: ignore[arg-type]
            state=state,  # type: ignore[arg-type]
            session=object(),
            cleanup=FakeCleanup(),  # type: ignore[arg-type]
            telegram_id=777,
            feedback_text="  не хватает истории  ",
            track_user=False,
        )
    finally:
        monkeypatch_repo.undo()

    assert state.cleared is True
    assert repo.saved == {
        "user_id": 42,
        "app_rating": 4,
        "photo_rating": None,
        "feedback_text": "не хватает истории",
    }
    assert message.answers == [SURVEY_THANKS]


@pytest.mark.asyncio
async def test_finish_survey_blocks_repeat() -> None:
    from src.bot.handlers import survey as survey_module

    class FakeState:
        async def get_data(self) -> dict[str, Any]:
            return {"app_rating": 5, "photo_rating": 5}

        async def clear(self) -> None:
            return None

    class FakeRepo:
        async def get_or_create_user(self, telegram_id: int, timezone: str) -> Any:
            return type("U", (), {"id": 1})()

        async def has_survey_response(self, user_id: int) -> bool:
            return True

        async def save_survey_response(self, *args: Any, **kwargs: Any) -> None:
            raise AssertionError("must not save twice")

    class FakeMessage:
        def __init__(self) -> None:
            self.answers: list[str] = []
            self.bot = object()
            self.chat = type("Chat", (), {"id": 1})()
            self.message_id = 10

        async def answer(self, text: str, **kwargs: Any) -> FakeMessage:
            self.answers.append(text)
            return self

    class FakeCleanup:
        def schedule(self, *args: Any, **kwargs: Any) -> None:
            return None

    monkeypatch_repo = pytest.MonkeyPatch()
    monkeypatch_repo.setattr(survey_module, "UserRepository", lambda session: FakeRepo())
    message = FakeMessage()
    try:
        await survey_module._finish_survey(
            message=message,  # type: ignore[arg-type]
            state=FakeState(),  # type: ignore[arg-type]
            session=object(),
            cleanup=FakeCleanup(),  # type: ignore[arg-type]
            telegram_id=1,
            feedback_text=None,
            track_user=False,
        )
    finally:
        monkeypatch_repo.undo()

    assert message.answers == [SURVEY_ALREADY_DONE]
