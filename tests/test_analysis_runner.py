import json

import pytest

from src.ai_analyzer.analysis_runner import BaseAnalysisRunner, single_call_enabled
from src.shared.schemas import AnalysisResult


MEAL_CALC_RESPONSE = """
{
  "type": "meal",
  "title": "Омлет",
  "items": [
    {"name": "яйца", "quantity": "2 шт", "calories": 140, "protein_g": 12, "fat_g": 10, "carbs_g": 1}
  ],
  "total_calories": 140,
  "protein_g": 12,
  "fat_g": 10,
  "carbs_g": 1,
  "micronutrients": {},
  "confidence": 0.8,
  "assumptions": [],
  "needs_clarification": false,
  "clarification_question": null,
  "duration_minutes": null,
  "portion_assumed": false,
  "unknown_reason": null
}
"""

MEAL_CALC_ASSUMED_PORTION = """
{
  "type": "meal",
  "title": "Борщ",
  "items": [
    {"name": "борщ", "quantity": "300 г", "calories": 120, "protein_g": 6, "fat_g": 4, "carbs_g": 14}
  ],
  "total_calories": 120,
  "protein_g": 6,
  "fat_g": 4,
  "carbs_g": 14,
  "micronutrients": {"fiber_g": 2, "sugar_g": 3},
  "confidence": 0.7,
  "assumptions": ["стандартная порция борща ~300 г"],
  "needs_clarification": false,
  "clarification_question": null,
  "duration_minutes": null,
  "portion_assumed": true,
  "unknown_reason": null
}
"""


ACTIVITY_CALC_RESPONSE = """
{
  "type": "activity",
  "title": "Бег",
  "items": [],
  "total_calories": 280,
  "protein_g": 0,
  "fat_g": 0,
  "carbs_g": 0,
  "micronutrients": {},
  "confidence": 0.8,
  "assumptions": ["MET 9.8, вес 72 кг, 30 мин"],
  "needs_clarification": false,
  "clarification_question": null,
  "duration_minutes": 30,
  "portion_assumed": false,
  "unknown_reason": null
}
"""


class FakeRunner(BaseAnalysisRunner):
    def __init__(self, responses: dict[str, str] | None = None) -> None:
        self.calls: list[tuple[str, str | None, str | None]] = []
        self.responses = responses or {}

    async def run_prompt(
        self,
        prompt: str,
        image_path: str | None = None,
        *,
        stage: str | None = None,
    ) -> str:
        self.calls.append((prompt, image_path, stage))
        if stage and stage in self.responses:
            return self.responses[stage]
        return MEAL_CALC_RESPONSE


def test_single_call_enabled_defaults_to_true(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AI_SINGLE_CALL", raising=False)
    assert single_call_enabled() is True


@pytest.mark.parametrize("value", ["true", "True", "1", "yes", "on"])
def test_single_call_enabled_truthy(value: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AI_SINGLE_CALL", value)
    assert single_call_enabled() is True


@pytest.mark.parametrize("value", ["false", "", "0", "no", "off"])
def test_single_call_enabled_falsy(value: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AI_SINGLE_CALL", value)
    assert single_call_enabled() is False


@pytest.mark.asyncio
async def test_analyze_food_single_call_uses_one_prompt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AI_SINGLE_CALL", "true")
    runner = FakeRunner()

    result = await runner.analyze_food(
        text="омлет из двух яиц",
        image_path="/tmp/omelet.jpg",
        profile_context={"weight_kg": 70},
    )

    assert result.type == "meal"
    assert result.title == "Омлет"
    assert len(runner.calls) == 1
    prompt, image_path, stage = runner.calls[0]
    assert "visual recognition, nutrition, and fitness calculation engine" in prompt
    assert "User description: омлет из двух яиц" in prompt
    assert image_path == "/tmp/omelet.jpg"
    assert stage is None


@pytest.mark.asyncio
async def test_staged_text_uses_classify_and_calc(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AI_SINGLE_CALL", "false")
    runner = FakeRunner(
        responses={
            "classify": json.dumps(
                {"type": "meal", "title": "Омлет", "unknown_reason": None, "confidence": 0.9}
            ),
            "calc": MEAL_CALC_RESPONSE,
        }
    )

    result = await runner.analyze_auto(text="омлет из двух яиц", image_path=None)

    assert result.type == "meal"
    assert result.title == "Омлет"
    assert [stage for _, _, stage in runner.calls] == ["classify", "calc"]
    assert all(image_path is None for _, image_path, _ in runner.calls)


@pytest.mark.asyncio
async def test_staged_photo_uses_three_stages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AI_SINGLE_CALL", "false")
    runner = FakeRunner(
        responses={
            "classify": json.dumps(
                {"type": "meal", "title": "Омлет", "unknown_reason": None, "confidence": 0.9}
            ),
            "photo": json.dumps(
                {
                    "type": "meal",
                    "title": "Омлет",
                    "components": [{"name": "яйца", "estimated_weight_g": 120}],
                    "confidence": 0.85,
                    "assumptions": [],
                    "unknown_reason": None,
                }
            ),
            "calc": MEAL_CALC_RESPONSE,
        }
    )

    result = await runner.analyze_auto(text=None, image_path="/tmp/food.jpg")

    assert result.type == "meal"
    assert [stage for _, _, stage in runner.calls] == ["classify", "photo", "calc"]
    assert runner.calls[0][1] == "/tmp/food.jpg"
    assert runner.calls[1][1] == "/tmp/food.jpg"
    assert runner.calls[2][1] is None


@pytest.mark.asyncio
async def test_staged_unknown_stops_after_classify(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AI_SINGLE_CALL", "false")
    runner = FakeRunner(
        responses={
            "classify": json.dumps(
                {
                    "type": "unknown",
                    "title": "",
                    "unknown_reason": "Это приветствие, а не еда",
                    "confidence": 0.95,
                }
            )
        }
    )

    result = await runner.analyze_auto(text="привет", image_path=None)

    assert result.type == "unknown"
    assert result.total_calories == 0
    assert result.unknown_reason == "Это приветствие, а не еда"
    assert [stage for _, _, stage in runner.calls] == ["classify"]


@pytest.mark.asyncio
async def test_staged_photo_activity_becomes_unknown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AI_SINGLE_CALL", "false")
    runner = FakeRunner(
        responses={
            "classify": json.dumps(
                {
                    "type": "activity",
                    "title": "Бег",
                    "unknown_reason": None,
                    "confidence": 0.8,
                }
            )
        }
    )

    result = await runner.analyze_auto(text=None, image_path="/tmp/run.jpg")

    assert result.type == "unknown"
    assert result.total_calories == 0
    assert result.unknown_reason == "На фото нет еды"
    assert [stage for _, _, stage in runner.calls] == ["classify"]


@pytest.mark.asyncio
async def test_staged_photo_activity_emits_classified_unknown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AI_SINGLE_CALL", "false")
    runner = FakeRunner(
        responses={
            "classify": json.dumps(
                {
                    "type": "activity",
                    "title": "Бег",
                    "unknown_reason": None,
                    "confidence": 0.8,
                }
            )
        }
    )
    events: list[tuple[str, dict]] = []

    async def on_progress(event: str, payload: dict) -> None:
        events.append((event, payload))

    result = await runner.analyze_auto(
        text=None,
        image_path="/tmp/run.jpg",
        on_progress=on_progress,
    )

    assert result.type == "unknown"
    assert events == [("classified", {"type": "unknown"})]


@pytest.mark.asyncio
async def test_staged_text_without_grams_sets_portion_assumed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AI_SINGLE_CALL", "false")
    runner = FakeRunner(
        responses={
            "classify": json.dumps(
                {"type": "meal", "title": "Борщ", "unknown_reason": None, "confidence": 0.8}
            ),
            "calc": MEAL_CALC_ASSUMED_PORTION,
        }
    )

    result = await runner.analyze_auto(text="съел борщ", image_path=None)

    assert result.type == "meal"
    assert result.portion_assumed is True
    assert [stage for _, _, stage in runner.calls] == ["classify", "calc"]
    calc_prompt = runner.calls[1][0]
    assert "nutrition calculation engine for food and drinks" in calc_prompt
    assert "User body metrics for calorie burn estimate" not in calc_prompt


@pytest.mark.asyncio
async def test_staged_activity_uses_body_metrics_prompt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AI_SINGLE_CALL", "false")
    runner = FakeRunner(
        responses={
            "classify": json.dumps(
                {
                    "type": "activity",
                    "title": "Бег",
                    "unknown_reason": None,
                    "confidence": 0.9,
                    "duration_minutes": 30,
                }
            ),
            "calc": ACTIVITY_CALC_RESPONSE,
        }
    )

    result = await runner.analyze_auto(
        text="пробежка 30 минут",
        image_path=None,
        profile_context={"weight_kg": 72, "height_cm": 178, "age": 31, "sex": "male"},
    )

    assert result.type == "activity"
    assert result.total_calories == 280
    assert [stage for _, _, stage in runner.calls] == ["classify", "calc"]
    classify_prompt = runner.calls[0][0]
    calc_prompt = runner.calls[1][0]
    assert "weight_kg" not in classify_prompt
    assert "fitness calculation engine" in calc_prompt
    assert "- weight_kg: 72" in calc_prompt
    assert "- height_cm: 178" in calc_prompt
    assert "nutrition calculation engine for food and drinks" not in calc_prompt


@pytest.mark.asyncio
async def test_staged_photo_detail_unknown_skips_calc(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AI_SINGLE_CALL", "false")
    runner = FakeRunner(
        responses={
            "classify": json.dumps(
                {"type": "meal", "title": "Тарелка", "unknown_reason": None, "confidence": 0.6}
            ),
            "photo": json.dumps(
                {
                    "type": "unknown",
                    "title": "",
                    "components": [],
                    "confidence": 0.9,
                    "assumptions": [],
                    "unknown_reason": "На фото нет еды",
                }
            ),
        }
    )

    result = await runner.analyze_auto(text=None, image_path="/tmp/empty.jpg")

    assert result.type == "unknown"
    assert result.unknown_reason == "На фото нет еды"
    assert [stage for _, _, stage in runner.calls] == ["classify", "photo"]


@pytest.mark.asyncio
async def test_staged_activity_emits_progress_events(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AI_SINGLE_CALL", "false")
    runner = FakeRunner(
        responses={
            "classify": json.dumps(
                {
                    "type": "activity",
                    "title": "Бег",
                    "unknown_reason": None,
                    "confidence": 0.9,
                    "duration_minutes": 30,
                }
            ),
            "calc": ACTIVITY_CALC_RESPONSE,
        }
    )
    events: list[tuple[str, dict]] = []

    async def on_progress(event: str, payload: dict) -> None:
        events.append((event, payload))

    result = await runner.analyze_auto(
        text="пробежка 30 минут",
        image_path=None,
        on_progress=on_progress,
    )

    assert result.type == "activity"
    assert events == [
        ("classified", {"type": "activity"}),
        ("calculate", {"type": "activity"}),
    ]


@pytest.mark.asyncio
async def test_staged_photo_emits_photo_detail_progress(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AI_SINGLE_CALL", "false")
    runner = FakeRunner(
        responses={
            "classify": json.dumps(
                {"type": "meal", "title": "Омлет", "unknown_reason": None, "confidence": 0.9}
            ),
            "photo": json.dumps(
                {
                    "type": "meal",
                    "title": "Омлет",
                    "components": [{"name": "яйца", "estimated_weight_g": 120}],
                    "confidence": 0.85,
                    "assumptions": [],
                    "unknown_reason": None,
                }
            ),
            "calc": MEAL_CALC_RESPONSE,
        }
    )
    events: list[tuple[str, dict]] = []

    async def on_progress(event: str, payload: dict) -> None:
        events.append((event, payload))

    result = await runner.analyze_auto(text=None, image_path="/tmp/food.jpg", on_progress=on_progress)

    assert result.type == "meal"
    assert events == [
        ("classified", {"type": "meal"}),
        ("photo_detail", {"type": "meal"}),
        ("calculate", {"type": "meal"}),
    ]


@pytest.mark.asyncio
async def test_staged_unknown_emits_classified_unknown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AI_SINGLE_CALL", "false")
    runner = FakeRunner(
        responses={
            "classify": json.dumps(
                {
                    "type": "unknown",
                    "title": "",
                    "unknown_reason": "Это приветствие, а не еда",
                    "confidence": 0.95,
                }
            )
        }
    )
    events: list[tuple[str, dict]] = []

    async def on_progress(event: str, payload: dict) -> None:
        events.append((event, payload))

    result = await runner.analyze_auto(text="привет", image_path=None, on_progress=on_progress)

    assert result.type == "unknown"
    assert events == [("classified", {"type": "unknown"})]


def test_analysis_result_from_dict_keeps_unknown() -> None:
    result = AnalysisResult.from_dict(
        {
            "type": "unknown",
            "title": "",
            "total_calories": 0,
            "unknown_reason": "Неизвестный ввод",
            "portion_assumed": False,
        }
    )
    assert result.type == "unknown"
    assert result.unknown_reason == "Неизвестный ввод"
    assert result.portion_assumed is False
