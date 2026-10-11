from __future__ import annotations

import json
import re
from typing import Any

from src.shared.schemas import AnalysisResult, CoachWeekReview


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


def _review_lines(value: Any, *, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    lines: list[str] = []
    for item in value:
        text = str(item).strip()
        if not text:
            continue
        lines.append(text[:400])
        if len(lines) >= limit:
            break
    return lines


def parse_coach_review(raw_response: str) -> CoachWeekReview:
    data = extract_json_payload(raw_response)
    summary = str(data.get("summary") or "").strip()
    if not summary:
        raise ValueError("Week review is missing a summary")
    return CoachWeekReview(
        summary=summary[:800],
        wins=_review_lines(data.get("wins"), limit=3),
        improve=_review_lines(data.get("improve"), limit=3),
        skipped=_review_lines(data.get("skipped"), limit=12),
        next_steps=_review_lines(data.get("next_steps"), limit=3),
    )


def parse_analysis_response(raw_response: str) -> AnalysisResult:
    data = extract_json_payload(raw_response)
    return AnalysisResult.from_dict(data)
