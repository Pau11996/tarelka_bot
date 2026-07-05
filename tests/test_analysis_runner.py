import pytest

from src.ai_analyzer.analysis_runner import BaseAnalysisRunner, single_call_enabled


class FakeRunner(BaseAnalysisRunner):
    def __init__(self) -> None:
        self.calls: list[tuple[str, str | None]] = []

    async def run_prompt(self, prompt: str, image_path: str | None = None) -> str:
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
