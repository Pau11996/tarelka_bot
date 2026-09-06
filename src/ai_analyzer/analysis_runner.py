from __future__ import annotations

import json
import os

from src.ai_analyzer.food_lookup import calculate_from_table
from src.ai_analyzer.parsing import extract_json_payload, parse_analysis_response
from src.ai_analyzer.prompts import (
    CLASSIFICATION_PROMPT,
    COMBINED_ANALYSIS_PROMPT,
    CORRECTION_PROMPT,
    MEAL_IDENTIFICATION_PROMPT,
    NUTRITION_CALCULATION_PROMPT,
)
from src.shared.schemas import AnalysisResult, TRACKED_MICRONUTRIENTS

_TRUTHY = {"true", "1", "yes", "on"}


def single_call_enabled() -> bool:
    return os.environ.get("AI_SINGLE_CALL", "true").strip().lower() in _TRUTHY


def resolve_step_model(step: str, *, openai: bool) -> str | None:
    """Return override model for multi-step mode, or None to use the runner default."""
    prefix = "OPENAI_MODEL" if openai else "CURSOR_MODEL"
    mapping = {
        "first": f"{prefix}_FIRST",
        "second": f"{prefix}_SECOND",
        "third": f"{prefix}_THIRD",
    }
    env_name = mapping.get(step)
    if not env_name:
        return None
    value = os.environ.get(env_name, "").strip()
    return value or None


class BaseAnalysisRunner:
    uses_openai = False

    async def run_prompt(
        self,
        prompt: str,
        image_path: str | None = None,
        *,
        model: str | None = None,
    ) -> str:
        raise NotImplementedError

    def _step_model(self, step: str) -> str | None:
        return resolve_step_model(step, openai=self.uses_openai)

    def _build_context(
        self,
        *,
        text: str | None,
        profile_context: dict | None,
        input_label: str = "User input",
    ) -> str:
        context = ""
        if profile_context:
            context = f"User profile context: {json.dumps(profile_context, ensure_ascii=False)}\n"
        if text:
            context += f"{input_label}: {text}\n"
        return context

    async def _identify(
        self,
        *,
        prompt: str,
        text: str | None,
        image_path: str | None,
        profile_context: dict | None,
        input_label: str = "User input",
        model: str | None = None,
    ) -> dict:
        context = self._build_context(
            text=text,
            profile_context=profile_context,
            input_label=input_label,
        )
        raw = await self.run_prompt(
            f"{prompt}\n{context}",
            image_path=image_path,
            model=model,
        )
        return extract_json_payload(raw)

    async def _calculate(
        self,
        *,
        identification: dict,
        profile_context: dict | None,
        text: str | None = None,
        model: str | None = None,
    ) -> AnalysisResult:
        prompt = (
            f"{NUTRITION_CALCULATION_PROMPT}\n"
            f"Identification JSON:\n{json.dumps(identification, ensure_ascii=False)}\n"
        )
        if text:
            prompt += f"User description:\n{text}\n"
        if profile_context:
            prompt += f"User profile context:\n{json.dumps(profile_context, ensure_ascii=False)}\n"
        raw = await self.run_prompt(prompt, model=model)
        result = parse_analysis_response(raw)
        result.needs_clarification = False
        result.clarification_question = None
        return result

    def _unknown_result(
        self,
        *,
        confidence: float = 0.0,
        assumptions: list | None = None,
    ) -> AnalysisResult:
        return AnalysisResult(
            type="unknown",
            title="Неизвестный ввод",
            items=[],
            total_calories=0.0,
            protein_g=0.0,
            fat_g=0.0,
            carbs_g=0.0,
            micronutrients={key: 0.0 for key in TRACKED_MICRONUTRIENTS},
            confidence=confidence,
            assumptions=list(assumptions or ["Ввод не распознан как еда или активность"]),
            needs_clarification=False,
            clarification_question=None,
            duration_minutes=None,
        )

    async def _resolve_meal_after_identify(
        self,
        *,
        identification: dict,
        profile_context: dict | None,
        text: str | None,
    ) -> AnalysisResult:
        identification["type"] = "meal"
        table_result = calculate_from_table(identification)
        if table_result is not None:
            return table_result
        return await self._calculate(
            identification=identification,
            profile_context=profile_context,
            text=text,
            model=self._step_model("third"),
        )

    async def _calculate_activity(
        self,
        *,
        text: str | None,
        profile_context: dict | None,
        confidence: float = 0.8,
        assumptions: list | None = None,
    ) -> AnalysisResult:
        identification = {
            "type": "activity",
            "title": (text or "Активность")[:80],
            "components": [],
            "activity": {
                "name": text,
                "duration_minutes": None,
                "intensity": None,
            },
            "confidence": confidence,
            "assumptions": list(assumptions or []),
        }
        result = await self._calculate(
            identification=identification,
            profile_context=profile_context,
            text=text,
            model=self._step_model("third"),
        )
        result.type = "activity"
        return result

    async def _analyze_single(
        self,
        *,
        text: str | None,
        image_path: str | None,
        profile_context: dict | None,
        input_label: str = "User input",
        forced_type: str | None = None,
    ) -> AnalysisResult:
        context = self._build_context(
            text=text,
            profile_context=profile_context,
            input_label=input_label,
        )
        raw = await self.run_prompt(
            f"{COMBINED_ANALYSIS_PROMPT}\n{context}",
            image_path=image_path,
        )
        result = parse_analysis_response(raw)
        if forced_type:
            result.type = forced_type
        result.needs_clarification = False
        result.clarification_question = None
        return result

    async def analyze_food(
        self,
        *,
        text: str | None,
        image_path: str | None,
        profile_context: dict | None = None,
    ) -> AnalysisResult:
        if single_call_enabled():
            return await self._analyze_single(
                text=text,
                image_path=image_path,
                profile_context=profile_context,
                input_label="User description",
                forced_type="meal",
            )
        identification = await self._identify(
            prompt=MEAL_IDENTIFICATION_PROMPT,
            text=text,
            image_path=image_path,
            profile_context=profile_context,
            input_label="User description",
            model=self._step_model("second"),
        )
        return await self._resolve_meal_after_identify(
            identification=identification,
            profile_context=profile_context,
            text=text,
        )

    async def analyze_auto(
        self,
        *,
        text: str | None,
        image_path: str | None,
        profile_context: dict | None = None,
    ) -> AnalysisResult:
        if single_call_enabled():
            return await self._analyze_single(
                text=text,
                image_path=image_path,
                profile_context=profile_context,
            )

        classification = await self._identify(
            prompt=CLASSIFICATION_PROMPT,
            text=text,
            image_path=image_path,
            profile_context=profile_context,
            model=self._step_model("first"),
        )
        classified = str(classification.get("type", "")).lower()
        if classified == "unknown":
            return self._unknown_result(
                confidence=float(classification.get("confidence") or 0),
                assumptions=list(classification.get("assumptions") or []),
            )
        if classified == "activity":
            return await self._calculate_activity(
                text=text,
                profile_context=profile_context,
                confidence=float(classification.get("confidence") or 0.8),
                assumptions=list(classification.get("assumptions") or []),
            )

        identification = await self._identify(
            prompt=MEAL_IDENTIFICATION_PROMPT,
            text=text,
            image_path=image_path,
            profile_context=profile_context,
            input_label="User description",
            model=self._step_model("second"),
        )
        return await self._resolve_meal_after_identify(
            identification=identification,
            profile_context=profile_context,
            text=text,
        )

    async def analyze_activity(
        self,
        *,
        text: str | None,
        image_path: str | None,
        profile_context: dict | None = None,
    ) -> AnalysisResult:
        if single_call_enabled():
            return await self._analyze_single(
                text=text,
                image_path=image_path,
                profile_context=profile_context,
                input_label="User description",
                forced_type="activity",
            )
        return await self._calculate_activity(
            text=text,
            profile_context=profile_context,
        )

    async def correct_analysis(
        self,
        *,
        previous_result: dict,
        correction_text: str,
        image_path: str | None = None,
    ) -> AnalysisResult:
        prompt = (
            f"{CORRECTION_PROMPT}\n"
            f"Previous JSON:\n{json.dumps(previous_result, ensure_ascii=False)}\n"
            f"User correction:\n{correction_text}\n"
        )
        raw = await self.run_prompt(prompt, image_path=image_path)
        return parse_analysis_response(raw)
