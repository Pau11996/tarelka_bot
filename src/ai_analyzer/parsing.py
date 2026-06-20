from __future__ import annotations

import json
import re
from typing import Any

from src.shared.schemas import AnalysisResult


def extract_json_payload(text: str) -> dict[str, Any]:
    text = text.strip()
    if not text:
        raise ValueError("Empty AI response")

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    fenced = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if fenced:
        return json.loads(fenced.group(1))

    brace = re.search(r"\{.*\}", text, re.DOTALL)
    if brace:
        return json.loads(brace.group(0))

    raise ValueError("Could not parse JSON from AI response")


def parse_analysis_response(raw_response: str) -> AnalysisResult:
    data = extract_json_payload(raw_response)
    return AnalysisResult.from_dict(data)
