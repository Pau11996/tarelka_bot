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
    def __init__(
        self,
        responses: dict[str, str] | None = None,
        fallback: str = MEAL_CALC_RESPONSE,
    ) -> None:
        self.calls: list[tuple[str, str | None, str | None]] = []
        self.responses = responses or {}
        self.fallback = fallback

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
        return self.fallback


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
    assert len(runner.calls) == 2
    classify_prompt, classify_image, classify_stage = runner.calls[0]
    assert classify_stage == "classify"
    assert "barcode" in classify_prompt
    assert classify_image == "/tmp/omelet.jpg"
    prompt, image_path, stage = runner.calls[1]
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


WATER_CALC_RESPONSE = """
{
  "type": "water",
  "title": "Стакан воды",
  "items": [],
  "total_calories": 12,
  "protein_g": 1,
  "fat_g": 0,
  "carbs_g": 0,
  "micronutrients": {},
  "meal_slot": "breakfast",
  "volume_ml": 500,
  "confidence": 0.9,
  "assumptions": [],
  "needs_clarification": false,
  "clarification_question": null,
  "duration_minutes": null,
  "portion_assumed": false,
  "unknown_reason": null
}
"""


def test_analysis_result_water_drops_calories_and_slot() -> None:
    result = AnalysisResult.from_dict(
        {
            "type": "water",
            "title": "Вода",
            "total_calories": 40,
            "meal_slot": "breakfast",
            "protein_g": 3,
            "items": [{"name": "вода", "calories": 0}],
        }
    )
    assert result.type == "water"
    assert result.total_calories == 0
    assert result.protein_g == 0
    assert result.items == []
    assert result.meal_slot is None
    assert result.volume_ml == 250
    assert result.portion_assumed is True


def test_analysis_result_meal_slot_from_russian_name() -> None:
    named = AnalysisResult.from_dict({"type": "meal", "title": "Овсянка", "meal_slot": "завтрак"})
    assert named.meal_slot == "breakfast"
    assert named.volume_ml is None

    missing = AnalysisResult.from_dict({"type": "meal", "title": "Овсянка"})
    assert missing.meal_slot is None

    unknown_slot = AnalysisResult.from_dict({"type": "meal", "title": "Овсянка", "meal_slot": "brunch"})
    assert unknown_slot.meal_slot is None


def test_analysis_result_activity_drops_meal_slot() -> None:
    result = AnalysisResult.from_dict(
        {"type": "activity", "title": "Бег", "meal_slot": "breakfast", "volume_ml": 250}
    )
    assert result.meal_slot is None
    assert result.volume_ml is None


@pytest.mark.asyncio
async def test_staged_meal_slot_survives_calc_without_slot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AI_SINGLE_CALL", "false")
    runner = FakeRunner(
        responses={
            "classify": json.dumps(
                {
                    "type": "meal",
                    "title": "Овсянка",
                    "meal_slot": "breakfast",
                    "unknown_reason": None,
                    "confidence": 0.9,
                }
            ),
            "calc": MEAL_CALC_RESPONSE,
        }
    )

    result = await runner.analyze_auto(text="завтрак овсянка", image_path=None)

    assert result.type == "meal"
    assert result.meal_slot == "breakfast"
    assert result.title == "Омлет"


@pytest.mark.asyncio
async def test_staged_meal_without_slot_stays_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AI_SINGLE_CALL", "false")
    runner = FakeRunner(
        responses={
            "classify": json.dumps(
                {"type": "meal", "title": "Омлет", "meal_slot": None, "confidence": 0.9}
            ),
            "calc": MEAL_CALC_RESPONSE,
        }
    )

    result = await runner.analyze_auto(text="омлет", image_path=None)

    assert result.type == "meal"
    assert result.meal_slot is None


@pytest.mark.asyncio
async def test_staged_water_text_uses_volume_prompt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AI_SINGLE_CALL", "false")
    runner = FakeRunner(
        responses={
            "classify": json.dumps(
                {"type": "water", "title": "Вода", "meal_slot": None, "confidence": 0.95}
            ),
            "calc": WATER_CALC_RESPONSE,
        }
    )

    result = await runner.analyze_auto(text="бутылка воды 0.5", image_path=None)

    assert result.type == "water"
    assert result.volume_ml == 500
    assert result.total_calories == 0
    assert result.meal_slot is None
    assert result.portion_assumed is False
    assert [stage for _, _, stage in runner.calls] == ["classify", "calc"]
    assert "drinking-water log" in runner.calls[1][0]


@pytest.mark.asyncio
async def test_staged_water_photo_is_not_unknown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AI_SINGLE_CALL", "false")
    runner = FakeRunner(
        responses={
            "classify": json.dumps(
                {"type": "water", "title": "Стакан воды", "confidence": 0.9}
            ),
            "photo": json.dumps(
                {
                    "type": "water",
                    "title": "Стакан воды",
                    "components": [],
                    "volume_ml": 250,
                    "confidence": 0.8,
                    "assumptions": [],
                    "unknown_reason": None,
                }
            ),
            "calc": WATER_CALC_RESPONSE,
        }
    )

    result = await runner.analyze_auto(text=None, image_path="/tmp/water.jpg")

    assert result.type == "water"
    assert result.volume_ml == 500
    assert [stage for _, _, stage in runner.calls] == ["classify", "photo", "calc"]
    assert "volume_ml" in runner.calls[2][0]


def _barcode_runner(monkeypatch: pytest.MonkeyPatch, product, barcode: str) -> FakeRunner:
    monkeypatch.setenv("AI_SINGLE_CALL", "true")
    monkeypatch.setattr("src.ai_analyzer.analysis_runner.lookup_product", lambda code: product)
    return FakeRunner(
        responses={
            "classify": json.dumps(
                {
                    "type": "barcode",
                    "barcode": barcode,
                    "meal_slot": "breakfast",
                    "confidence": 0.95,
                }
            )
        }
    )


@pytest.mark.asyncio
async def test_decoded_barcode_skips_the_model(monkeypatch: pytest.MonkeyPatch) -> None:
    from src.ai_analyzer.products import LABEL_ASSUMPTION, CatalogProduct

    product = CatalogProduct(
        title="Творог 5%",
        brand="Савушкин",
        weight_g=180,
        volume="200 г",
        energy_cost="белки-10,0 г; жиры-5,0 г; углеводы-3,0 г; 150 ккал",
        image_url="https://cdn.example/4600536004105.jpg",
    )
    monkeypatch.setattr(
        "src.ai_analyzer.analysis_runner.decode_product_barcode",
        lambda path: "4600536004105",
    )
    monkeypatch.setattr("src.ai_analyzer.analysis_runner.lookup_product", lambda code: product)
    runner = FakeRunner()

    result = await runner.analyze_auto(text="на завтрак", image_path="/tmp/code.jpg")

    assert result.type == "meal"
    assert result.title == "Савушкин Творог 5%"
    assert result.meal_slot == "breakfast"
    assert result.total_calories == 300
    assert result.confidence == 1.0
    assert result.assumptions == [LABEL_ASSUMPTION]
    assert result.product_image_url == "https://cdn.example/4600536004105.jpg"
    assert runner.calls == []


@pytest.mark.asyncio
async def test_barcode_with_label_does_not_calculate_from_photo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.ai_analyzer.products import LABEL_ASSUMPTION, CatalogProduct

    product = CatalogProduct(
        title="Творог 5%",
        brand="Савушкин",
        weight_g=180,
        volume="200 г",
        energy_cost="белки-10,0 г; жиры-5,0 г; углеводы-3,0 г; 150 ккал",
    )
    runner = _barcode_runner(monkeypatch, product, "4600536004105")

    result = await runner.analyze_auto(text="завтрак", image_path="/tmp/code.jpg")

    assert result.type == "meal"
    assert result.title == "Савушкин Творог 5%"
    assert result.meal_slot == "breakfast"
    assert result.total_calories == 300
    assert result.protein_g == 20
    assert result.fat_g == 10
    assert result.carbs_g == 6
    assert result.portion_assumed is False
    assert result.assumptions == [LABEL_ASSUMPTION]
    assert [stage for _, _, stage in runner.calls] == ["classify"]


@pytest.mark.asyncio
async def test_barcode_zero_calorie_food_stays_a_meal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.ai_analyzer.products import CatalogProduct

    product = CatalogProduct(
        title="Жевательная резинка",
        brand="",
        weight_g=14,
        volume="",
        energy_cost="белки 0 г; жиры 0 г; углеводы 0 г; 0 ккал",
    )
    runner = _barcode_runner(monkeypatch, product, "4600536004105")

    result = await runner.analyze_auto(text=None, image_path="/tmp/code.jpg")

    assert result.type == "meal"
    assert result.total_calories == 0
    assert result.meal_slot == "breakfast"


@pytest.mark.asyncio
async def test_barcode_mineral_water_goes_to_water_tracker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.ai_analyzer.products import CatalogProduct

    product = CatalogProduct(
        title="Минеральная вода Нарзан газ",
        brand="",
        weight_g=1037,
        volume="1л",
        energy_cost="белки - 0,0 г; жиры - 0,0 г; улеводы - 0,0 г; энергетическая ценность -0,0 ккал",
    )
    runner = _barcode_runner(monkeypatch, product, "4600536004105")

    result = await runner.analyze_auto(text=None, image_path="/tmp/code.jpg")

    assert result.type == "water"
    assert result.volume_ml == 1000
    assert result.portion_assumed is False
    assert result.meal_slot is None
    assert result.total_calories == 0


@pytest.mark.asyncio
async def test_barcode_without_calories_estimates_from_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.ai_analyzer.products import ESTIMATE_ASSUMPTION, CatalogProduct

    product = CatalogProduct(
        title="Творог",
        brand="",
        weight_g=200,
        volume="",
        energy_cost="",
    )
    runner = _barcode_runner(monkeypatch, product, "4600536004105")

    result = await runner.analyze_food(text="завтрак", image_path="/tmp/code.jpg")

    assert result.type == "meal"
    assert result.title == "Омлет"
    assert result.meal_slot == "breakfast"
    assert ESTIMATE_ASSUMPTION in result.assumptions
    assert result.portion_assumed is False
    assert [stage for _, _, stage in runner.calls] == ["classify", "calc"]
    assert runner.calls[1][1] is None
    assert "Творог" in runner.calls[1][0]
    assert "200 г" in runner.calls[1][0]
    assert "Текст КБЖУ в базе пустой" in runner.calls[1][0]
    assert "/tmp/code.jpg" not in runner.calls[1][0]


@pytest.mark.asyncio
async def test_barcode_with_unparsed_label_sends_raw_text_to_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.ai_analyzer.products import CatalogProduct

    raw_label = "белки 7,5г; жиры 31,3г; углеводы 23,2г; энергетическая ценность, ккал 412,6/кДж 1728"
    product = CatalogProduct(
        title="Шоколад",
        brand="",
        weight_g=90,
        volume="90 г",
        energy_cost=raw_label,
    )
    runner = _barcode_runner(monkeypatch, product, "4600536004105")

    result = await runner.analyze_food(text=None, image_path="/tmp/code.jpg")

    assert result.type == "meal"
    prompt = runner.calls[1][0]
    assert raw_label in prompt
    assert "скрипт его не разобрал" in prompt
    assert "90 г" in prompt
    assert runner.calls[1][1] is None


@pytest.mark.asyncio
async def test_barcode_missing_from_catalog_is_unknown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.ai_analyzer.products import PRODUCT_NOT_FOUND

    runner = _barcode_runner(monkeypatch, None, "4600536004105")

    result = await runner.analyze_auto(text=None, image_path="/tmp/code.jpg")

    assert result.type == "unknown"
    assert result.unknown_reason == PRODUCT_NOT_FOUND
    assert [stage for _, _, stage in runner.calls] == ["classify"]


@pytest.mark.asyncio
async def test_barcode_unreadable_checksum_refunds_without_lookup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.ai_analyzer.products import BARCODE_UNREADABLE

    seen: list[str] = []

    def fail_lookup(code: str):
        seen.append(code)
        raise AssertionError("lookup must not run")

    monkeypatch.setenv("AI_SINGLE_CALL", "false")
    monkeypatch.setattr("src.ai_analyzer.analysis_runner.lookup_product", fail_lookup)
    runner = FakeRunner(
        responses={
            "classify": json.dumps(
                {"type": "barcode", "barcode": "4600536004106", "confidence": 0.4}
            )
        }
    )

    result = await runner.analyze_activity(text=None, image_path="/tmp/code.jpg")

    assert result.type == "unknown"
    assert result.unknown_reason == BARCODE_UNREADABLE
    assert seen == []
    assert [stage for _, _, stage in runner.calls] == ["classify"]


@pytest.mark.asyncio
async def test_barcode_database_missing_is_unknown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.ai_analyzer.products import PRODUCT_DB_UNAVAILABLE

    def missing(_code: str):
        raise FileNotFoundError("catalog")

    monkeypatch.setenv("AI_SINGLE_CALL", "true")
    monkeypatch.setattr("src.ai_analyzer.analysis_runner.lookup_product", missing)
    runner = FakeRunner(
        responses={
            "classify": json.dumps(
                {"type": "barcode", "barcode": "4600536004105", "confidence": 0.9}
            )
        }
    )

    result = await runner.analyze_auto(text=None, image_path="/tmp/code.jpg")

    assert result.unknown_reason == PRODUCT_DB_UNAVAILABLE
    assert [stage for _, _, stage in runner.calls] == ["classify"]

