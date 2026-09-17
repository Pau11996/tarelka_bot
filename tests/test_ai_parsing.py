import pytest

from src.ai_analyzer.parsing import extract_json_payload, parse_analysis_response


def test_extract_json_payload_plain():
    data = extract_json_payload('{"type": "meal", "total_calories": 100}')
    assert data["type"] == "meal"
    assert data["total_calories"] == 100


def test_extract_json_payload_fenced():
    raw = """Here is result:
```json
{"type": "meal", "total_calories": 250, "items": []}
```
"""
    data = extract_json_payload(raw)
    assert data["total_calories"] == 250


def test_extract_json_payload_nested_fenced():
    raw = """```json
{
  "type": "meal",
  "components": [
    {"name": "рис", "estimated_weight_g": 150},
    {"name": "курица", "estimated_weight_g": 120}
  ]
}
```"""
    data = extract_json_payload(raw)
    assert data["components"][1]["name"] == "курица"


def test_parse_analysis_response_items():
    raw = """
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
  "micronutrients": {"fiber_g": 0},
  "confidence": 0.8,
  "assumptions": ["средний размер яиц"],
  "needs_clarification": false
}
"""
    result = parse_analysis_response(raw)
    assert result.title == "Омлет"
    assert len(result.items) == 1
    assert result.items[0].name == "яйца"
    assert result.confidence == 0.8


def test_parse_analysis_response_unknown_type():
    raw = """
{
  "type": "unknown",
  "title": "",
  "total_calories": 0,
  "unknown_reason": "Неизвестный ввод",
  "portion_assumed": false
}
"""
    result = parse_analysis_response(raw)
    assert result.type == "unknown"
    assert result.unknown_reason == "Неизвестный ввод"
    assert result.total_calories == 0


def test_extract_json_payload_invalid():
    with pytest.raises(ValueError):
        extract_json_payload("no json here")
