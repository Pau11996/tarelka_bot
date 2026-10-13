from src.bot.handlers.food import (
    STATUS_ACTIVITY,
    STATUS_BARCODE,
    STATUS_CALCULATE,
    STATUS_PHOTO_DETAIL,
    STATUS_WATER,
    progress_status_text,
)


def test_progress_status_uses_activity_message() -> None:
    text = progress_status_text("classified", {"type": "activity"})
    assert text == STATUS_ACTIVITY
    assert "Анализирую активность" in text
    assert "Считаю калории" not in text


def test_progress_status_keeps_activity_on_calculate() -> None:
    text = progress_status_text("calculate", {"type": "activity"})
    assert text == STATUS_ACTIVITY


def test_progress_status_uses_calories_for_meal_calculate() -> None:
    text = progress_status_text("calculate", {"type": "meal"})
    assert text == STATUS_CALCULATE
    assert "Считаю калории" in text


def test_progress_status_ignores_meal_until_later_stage() -> None:
    assert progress_status_text("classified", {"type": "meal"}) is None
    assert progress_status_text("classified", {"type": "unknown"}) is None


def test_progress_status_uses_water_message() -> None:
    assert progress_status_text("classified", {"type": "water"}) == STATUS_WATER
    assert progress_status_text("calculate", {"type": "water"}) == STATUS_WATER
    assert progress_status_text("photo_detail", {"type": "water"}) == STATUS_WATER
    assert "Считаю воду" in STATUS_WATER


def test_progress_status_uses_barcode_message() -> None:
    assert progress_status_text("classified", {"type": "barcode"}) == STATUS_BARCODE
    assert "штрихкод" in STATUS_BARCODE


def test_progress_status_photo_detail() -> None:
    assert progress_status_text("photo_detail", {"type": "meal"}) == STATUS_PHOTO_DETAIL


def test_progress_status_prefixes_voice_transcript() -> None:
    text = progress_status_text(
        "classified",
        {"type": "activity"},
        transcript="пробежка 30 минут",
    )
    assert text == f"Распознал: пробежка 30 минут\n\n{STATUS_ACTIVITY}"
