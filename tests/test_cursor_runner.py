import pytest

from src.ai_analyzer.cursor_runner import CursorRunner, RETRYABLE_MARKERS


@pytest.mark.parametrize(
    "message",
    [
        "Cursor CLI failed: Failed to reach the Cursor API",
        "Cursor CLI failed: Connection lost. Retry attempted.",
    ],
)
def test_is_retryable(message: str) -> None:
    assert CursorRunner._is_retryable(RuntimeError(message)) is True


def test_is_not_retryable_for_invalid_key() -> None:
    assert CursorRunner._is_retryable(RuntimeError("Cursor CLI failed: invalid api key")) is False


def test_retryable_markers_cover_cursor_api_error() -> None:
    error = RuntimeError("Cursor CLI failed: ✗ Failed to reach the Cursor API.")
    assert any(marker in str(error) for marker in RETRYABLE_MARKERS)
