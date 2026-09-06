import json

import pytest

from src.ai_analyzer.analysis_runner import BaseAnalysisRunner, single_call_enabled
from src.ai_analyzer.food_lookup import calculate_from_table, find_food, normalize_name


class ScriptedRunner(BaseAnalysisRunner):
    def __init__(self, responses: list[str]) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[str, str | None, str | None]] = []

    async def run_prompt(
        self,
        prompt: str,
        image_path: str | None = None,
        *,
        model: str | None = None,
    ) -> str:
        self.calls.append((prompt, image_path, model))
        if not self.responses:
            raise AssertionError(f"Unexpected extra LLM call: {prompt[:80]}")
        return self.responses.pop(0)


class FakeRunner(BaseAnalysisRunner):
    def __init__(self) -> None:
        self.calls: list[tuple[str, str | None]] = []

    async def run_prompt(
        self,
        prompt: str,
        image_path: str | None = None,
        *,
        model: str | None = None,
    ) -> str:
        self.calls.append((prompt, image_path))
        return """
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
  "duration_minutes": null
}
"""


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
    prompt, image_path = runner.calls[0]
    assert "visual recognition, nutrition, and fitness calculation engine" in prompt
    assert "User description: омлет из двух яиц" in prompt
    assert image_path == "/tmp/omelet.jpg"


@pytest.mark.asyncio
async def test_analyze_auto_unknown_uses_one_call(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AI_SINGLE_CALL", "false")
    runner = ScriptedRunner(
        [
            json.dumps(
                {
                    "type": "unknown",
                    "confidence": 0.9,
                    "assumptions": ["это приветствие"],
                }
            )
        ]
    )

    result = await runner.analyze_auto(text="привет", image_path=None)

    assert result.type == "unknown"
    assert result.total_calories == 0
    assert result.title == "Неизвестный ввод"
    assert len(runner.calls) == 1
    assert "classifier" in runner.calls[0][0].lower() or "Classify" in runner.calls[0][0]


@pytest.mark.asyncio
async def test_analyze_auto_meal_table_hit_uses_two_calls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AI_SINGLE_CALL", "false")
    runner = ScriptedRunner(
        [
            json.dumps({"type": "meal", "confidence": 0.95, "assumptions": []}),
            json.dumps(
                {
                    "type": "meal",
                    "title": "Яйца с рисом",
                    "components": [
                        {"name": "яйцо куриное", "estimated_weight_g": 100},
                        {"name": "рис вареный", "estimated_weight_g": 150},
                    ],
                    "confidence": 0.9,
                    "assumptions": [],
                }
            ),
        ]
    )

    result = await runner.analyze_auto(text="яйца с рисом", image_path=None)

    assert result.type == "meal"
    assert len(runner.calls) == 2
    assert result.total_calories > 0
    assert any("таблиц" in a.lower() for a in result.assumptions)
    assert len(result.items) == 2


@pytest.mark.asyncio
async def test_analyze_auto_meal_table_miss_uses_three_calls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AI_SINGLE_CALL", "false")
    runner = ScriptedRunner(
        [
            json.dumps({"type": "meal", "confidence": 0.95, "assumptions": []}),
            json.dumps(
                {
                    "type": "meal",
                    "title": "Экзотическое блюдо",
                    "components": [
                        {"name": "яйцо куриное", "estimated_weight_g": 100},
                        {"name": "драконий фрукт xyz", "estimated_weight_g": 80},
                    ],
                    "confidence": 0.8,
                    "assumptions": [],
                }
            ),
            json.dumps(
                {
                    "type": "meal",
                    "title": "Экзотическое блюдо",
                    "items": [
                        {
                            "name": "яйцо куриное",
                            "quantity": "100 г",
                            "calories": 157,
                            "protein_g": 12.7,
                            "fat_g": 11.5,
                            "carbs_g": 0.7,
                        },
                        {
                            "name": "драконий фрукт xyz",
                            "quantity": "80 г",
                            "calories": 50,
                            "protein_g": 1,
                            "fat_g": 0,
                            "carbs_g": 12,
                        },
                    ],
                    "total_calories": 207,
                    "protein_g": 13.7,
                    "fat_g": 11.5,
                    "carbs_g": 12.7,
                    "micronutrients": {"fiber_g": 2, "sugar_g": 8},
                    "confidence": 0.7,
                    "assumptions": ["llm fallback"],
                    "needs_clarification": False,
                    "clarification_question": None,
                    "duration_minutes": None,
                }
            ),
        ]
    )

    result = await runner.analyze_auto(text="яйцо и драконий фрукт", image_path=None)

    assert result.type == "meal"
    assert len(runner.calls) == 3
    assert result.total_calories == 207
    assert "nutrition and fitness calculation engine" in runner.calls[2][0]


@pytest.mark.asyncio
async def test_analyze_auto_activity_uses_two_calls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AI_SINGLE_CALL", "false")
    runner = ScriptedRunner(
        [
            json.dumps({"type": "activity", "confidence": 0.9, "assumptions": []}),
            json.dumps(
                {
                    "type": "activity",
                    "title": "Бег",
                    "items": [],
                    "total_calories": 320,
                    "protein_g": 0,
                    "fat_g": 0,
                    "carbs_g": 0,
                    "micronutrients": {"fiber_g": 0, "sugar_g": 0},
                    "confidence": 0.85,
                    "assumptions": [],
                    "needs_clarification": False,
                    "clarification_question": None,
                    "duration_minutes": 30,
                }
            ),
        ]
    )

    result = await runner.analyze_auto(
        text="бег 30 минут",
        image_path=None,
        profile_context={"weight_kg": 70},
    )

    assert result.type == "activity"
    assert result.total_calories == 320
    assert result.duration_minutes == 30
    assert len(runner.calls) == 2


@pytest.mark.asyncio
async def test_multistep_uses_step_models(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AI_SINGLE_CALL", "false")
    monkeypatch.setenv("CURSOR_MODEL_FIRST", "model-first")
    monkeypatch.setenv("CURSOR_MODEL_SECOND", "model-second")
    monkeypatch.setenv("CURSOR_MODEL_THIRD", "model-third")

    runner = ScriptedRunner(
        [
            json.dumps({"type": "meal", "confidence": 0.9, "assumptions": []}),
            json.dumps(
                {
                    "type": "meal",
                    "title": "Неизвестный продукт",
                    "components": [
                        {"name": "полностью неизвестный продукт qwerty", "estimated_weight_g": 50}
                    ],
                    "confidence": 0.8,
                    "assumptions": [],
                }
            ),
            json.dumps(
                {
                    "type": "meal",
                    "title": "Неизвестный продукт",
                    "items": [],
                    "total_calories": 10,
                    "protein_g": 0,
                    "fat_g": 0,
                    "carbs_g": 2,
                    "micronutrients": {"fiber_g": 0, "sugar_g": 0},
                    "confidence": 0.5,
                    "assumptions": [],
                    "needs_clarification": False,
                    "clarification_question": None,
                    "duration_minutes": None,
                }
            ),
        ]
    )

    await runner.analyze_auto(text="что-то странное", image_path=None)

    models = [call[2] for call in runner.calls]
    assert models == ["model-first", "model-second", "model-third"]


def test_normalize_name_handles_yo_and_case() -> None:
    assert normalize_name(" ЁжкА ") == "ежка"


def test_find_food_exact_and_alias() -> None:
    egg = find_food("яйцо")
    assert egg is not None
    assert egg.name == "яйцо куриное"

    rice = find_food("рис")
    assert rice is not None
    assert "рис" in rice.name


def test_find_food_unknown_returns_none() -> None:
    assert find_food("полностью неизвестный продукт qwerty") is None


def test_calculate_from_table_success() -> None:
    result = calculate_from_table(
        {
            "title": "Завтрак",
            "confidence": 0.9,
            "assumptions": [],
            "components": [
                {"name": "банан", "estimated_weight_g": 100},
                {"name": "йогурт", "estimated_weight_g": 150},
            ],
        }
    )
    assert result is not None
    assert result.type == "meal"
    assert result.total_calories > 0
    assert result.micronutrients["sugar_g"] > 0
    assert len(result.items) == 2


def test_calculate_from_table_fails_if_any_missing() -> None:
    result = calculate_from_table(
        {
            "title": "Смесь",
            "components": [
                {"name": "банан", "estimated_weight_g": 100},
                {"name": "полностью неизвестный продукт qwerty", "estimated_weight_g": 50},
            ],
        }
    )
    assert result is None
