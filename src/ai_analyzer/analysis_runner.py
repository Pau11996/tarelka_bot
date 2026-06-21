from __future__ import annotations

import json

from src.ai_analyzer.parsing import extract_json_payload, parse_analysis_response
from src.ai_analyzer.prompts import (
    ACTIVITY_ANALYSIS_PROMPT,
    CORRECTION_PROMPT,
    FOOD_ANALYSIS_PROMPT,
    GENERAL_ANALYSIS_PROMPT,
    NUTRITION_CALCULATION_PROMPT,
)
from src.shared.schemas import AnalysisResult


class BaseAnalysisRunner:
    async def run_prompt(self, prompt: str, image_path: str | None = None) -> str:
        raise NotImplementedError

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
    ) -> dict:
        context = self._build_context(
            text=text,
            profile_context=profile_context,
            input_label=input_label,
        )
        raw = await self.run_prompt(f"{prompt}\n{context}", image_path=image_path)
        return extract_json_payload(raw)

    async def _calculate(
        self,
        *,
        identification: dict,
        profile_context: dict | None,
    ) -> AnalysisResult:
        prompt = (
            f"{NUTRITION_CALCULATION_PROMPT}\n"
            f"Identification JSON:\n{json.dumps(identification, ensure_ascii=False)}\n"
        )
        if profile_context:
            prompt += f"User profile context:\n{json.dumps(profile_context, ensure_ascii=False)}\n"
        raw = await self.run_prompt(prompt)
        result = parse_analysis_response(raw)
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
        identification = await self._identify(
            prompt=FOOD_ANALYSIS_PROMPT,
            text=text,
            image_path=image_path,
            profile_context=profile_context,
            input_label="User description",
        )
        identification["type"] = "meal"
        return await self._calculate(
            identification=identification,
            profile_context=profile_context,
        )

    async def analyze_auto(
        self,
        *,
        text: str | None,
        image_path: str | None,
        profile_context: dict | None = None,
    ) -> AnalysisResult:
        identification = await self._identify(
            prompt=GENERAL_ANALYSIS_PROMPT,
            text=text,
            image_path=image_path,
            profile_context=profile_context,
        )
        return await self._calculate(
            identification=identification,
            profile_context=profile_context,
        )

    async def analyze_activity(
        self,
        *,
        text: str | None,
        image_path: str | None,
        profile_context: dict | None = None,
    ) -> AnalysisResult:
        identification = await self._identify(
            prompt=ACTIVITY_ANALYSIS_PROMPT,
            text=text,
            image_path=image_path,
            profile_context=profile_context,
            input_label="User description",
        )
        identification["type"] = "activity"
        return await self._calculate(
            identification=identification,
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
