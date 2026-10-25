from __future__ import annotations

import json
import logging
import os
import sqlite3
from collections.abc import Awaitable, Callable
from typing import Any

from src.ai_analyzer.barcode import decode_product_barcode
from src.ai_analyzer.parsing import extract_json_payload, parse_analysis_response, parse_coach_review
from src.ai_analyzer.prompts import (
    ACTIVITY_CALCULATION_PROMPT,
    CLASSIFY_PHOTO_PROMPT,
    CLASSIFY_TEXT_PROMPT,
    COMBINED_ANALYSIS_PROMPT,
    CORRECTION_PROMPT,
    MEAL_CALCULATION_PROMPT,
    PHOTO_DETAIL_PROMPT,
    WATER_CALCULATION_PROMPT,
    build_coach_week_prompt,
)
from src.ai_analyzer.products import (
    BARCODE_UNREADABLE,
    ESTIMATE_ASSUMPTION,
    LABEL_ASSUMPTION,
    PRODUCT_DB_UNAVAILABLE,
    PRODUCT_NOT_FOUND,
    CatalogProduct,
    LabelNutrition,
    barcode_digits,
    ean_checksum_ok,
    is_plain_water,
    lookup_product,
    package_grams,
    parse_energy_cost,
    product_title,
    volume_ml,
)
from src.shared.schemas import (
    AnalysisResult,
    CoachWeekReview,
    MANUAL_WEIGHT_ENTRY,
    NutrientItem,
    apply_typed_result,
    meal_slot_from_text,
    normalize_meal_slot,
)

logger = logging.getLogger(__name__)

_TRUTHY = {"true", "1", "yes", "on"}
PHOTO_NO_FOOD_REASON = "На фото нет еды"
DEFAULT_UNKNOWN_REASON = "Не удалось распознать еду или активность."
ProgressCallback = Callable[[str, dict[str, Any]], Awaitable[None]] | None


async def _notify_progress(
    on_progress: ProgressCallback,
    event: str,
    **payload: Any,
) -> None:
    if on_progress is None:
        return
    await on_progress(event, payload)


def single_call_enabled() -> bool:
    return os.environ.get("AI_SINGLE_CALL", "true").strip().lower() in _TRUTHY


def _unknown_result(
    *,
    unknown_reason: str | None = None,
    title: str = "",
    confidence: float = 0.0,
) -> AnalysisResult:
    return AnalysisResult(
        type="unknown",
        title=title or "",
        total_calories=0.0,
        confidence=confidence,
        unknown_reason=unknown_reason or DEFAULT_UNKNOWN_REASON,
        portion_assumed=False,
        needs_clarification=False,
        clarification_question=None,
    )


def _catalog_estimate_text(title: str, quantity: str, energy_cost: str | None) -> str:
    raw_label = (energy_cost or "").strip()
    if raw_label:
        nutrition = (
            "Сырой текст КБЖУ из базы, скрипт его не разобрал. "
            "Если в тексте есть калории или БЖУ, используй эти числа и пересчитай на всю упаковку. "
            "Если это не КБЖУ, оцени по названию и весу. "
            f"Текст: {raw_label}"
        )
    else:
        nutrition = "Текст КБЖУ в базе пустой. Оцени калории и БЖУ всей упаковки по названию и весу."
    return f"Упаковка продукта из базы: {title}. Вес упаковки: {quantity}. {nutrition}"


def _meal_from_label(
    title: str,
    product: CatalogProduct,
    label: LabelNutrition,
    meal_slot: str | None,
    confidence: float,
) -> AnalysisResult:
    grams, assumed = package_grams(product.volume, product.weight_g)
    factor = grams / label.basis_g
    calories = round(label.kcal * factor, 1)
    protein_g = round(label.protein_g * factor, 1)
    fat_g = round(label.fat_g * factor, 1)
    carbs_g = round(label.carbs_g * factor, 1)
    fiber_g = round(label.fiber_g * factor, 1)
    quantity = f"{grams:.0f} г"
    result = AnalysisResult(
        type="meal",
        title=title,
        items=[
            NutrientItem(
                name=title,
                quantity=quantity,
                calories=calories,
                protein_g=protein_g,
                fat_g=fat_g,
                carbs_g=carbs_g,
            )
        ],
        total_calories=calories,
        protein_g=protein_g,
        fat_g=fat_g,
        carbs_g=carbs_g,
        micronutrients={"fiber_g": fiber_g, "sugar_g": 0.0},
        confidence=confidence,
        assumptions=[LABEL_ASSUMPTION],
        meal_slot=meal_slot,
        portion_assumed=assumed,
        needs_clarification=False,
        clarification_question=None,
    )
    return _with_product_image(apply_typed_result(result), product)


def _with_product_image(result: AnalysisResult, product: CatalogProduct) -> AnalysisResult:
    if product.image_url:
        result.product_image_url = product.image_url
    return result


def _water_from_catalog(title: str, product: CatalogProduct, confidence: float) -> AnalysisResult:
    milliliters = volume_ml(product.volume)
    assumed = milliliters is None
    result = AnalysisResult(
        type="water",
        title=title,
        confidence=confidence,
        assumptions=["Объём из базы продуктов."] if not assumed else ["Объём воды в базе не указан."],
        volume_ml=milliliters,
        portion_assumed=assumed,
        needs_clarification=False,
        clarification_question=None,
    )
    return _with_product_image(apply_typed_result(result), product)


_BODY_METRIC_KEYS = ("weight_kg", "height_cm", "age", "sex", "activity_level")


def _format_body_metrics(profile_context: dict | None) -> str:
    lines = ["User body metrics for calorie burn estimate:"]
    found = False
    if profile_context:
        for key in _BODY_METRIC_KEYS:
            value = profile_context.get(key)
            if value is None or value == "":
                continue
            lines.append(f"- {key}: {value}")
            found = True
    if not found:
        lines.append("- not provided; assume a typical adult (70 kg) and state that in assumptions")
    return "\n".join(lines) + "\n"


class BaseAnalysisRunner:
    async def run_prompt(
        self,
        prompt: str,
        image_path: str | None = None,
        *,
        stage: str | None = None,
    ) -> str:
        raise NotImplementedError

    def _build_context(
        self,
        *,
        text: str | None,
        profile_context: dict | None,
        input_label: str = "User input",
        include_profile: bool = True,
    ) -> str:
        context = ""
        if include_profile and profile_context:
            context = f"User profile context: {json.dumps(profile_context, ensure_ascii=False)}\n"
        if text:
            context += f"{input_label}: {text}\n"
        return context

    async def _classify(
        self,
        *,
        text: str | None,
        image_path: str | None,
        profile_context: dict | None,
    ) -> dict:
        del profile_context
        prompt = CLASSIFY_PHOTO_PROMPT if image_path else CLASSIFY_TEXT_PROMPT
        context = self._build_context(
            text=text,
            profile_context=None,
            input_label="User input",
            include_profile=False,
        )
        raw = await self.run_prompt(
            f"{prompt}\n{context}",
            image_path=image_path,
            stage="classify",
        )
        return extract_json_payload(raw)

    async def _detail_photo(
        self,
        *,
        text: str | None,
        image_path: str,
        profile_context: dict | None,
        classification: dict,
    ) -> dict:
        del profile_context
        context = self._build_context(
            text=text,
            profile_context=None,
            input_label="User caption",
            include_profile=False,
        )
        prompt = (
            f"{PHOTO_DETAIL_PROMPT}\n"
            f"Classification JSON:\n{json.dumps(classification, ensure_ascii=False)}\n"
            f"{context}"
        )
        raw = await self.run_prompt(prompt, image_path=image_path, stage="photo")
        return extract_json_payload(raw)

    async def _calculate(
        self,
        *,
        identification: dict,
        text: str | None,
        profile_context: dict | None,
    ) -> AnalysisResult:
        result_type = str(identification.get("type", "meal")).lower()
        if result_type == "activity":
            prompt = (
                f"{ACTIVITY_CALCULATION_PROMPT}\n"
                f"{_format_body_metrics(profile_context)}"
                f"Identification JSON:\n{json.dumps(identification, ensure_ascii=False)}\n"
            )
        elif result_type == "water":
            prompt = (
                f"{WATER_CALCULATION_PROMPT}\n"
                f"Identification JSON:\n{json.dumps(identification, ensure_ascii=False)}\n"
            )
        else:
            prompt = (
                f"{MEAL_CALCULATION_PROMPT}\n"
                f"Identification JSON:\n{json.dumps(identification, ensure_ascii=False)}\n"
            )
        if text:
            prompt += f"Original user input:\n{text}\n"
        raw = await self.run_prompt(prompt, stage="calc")
        result = parse_analysis_response(raw)
        result.needs_clarification = False
        result.clarification_question = None
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
        if image_path and result.type == "activity":
            return _unknown_result(unknown_reason=PHOTO_NO_FOOD_REASON, confidence=result.confidence)
        if result.type == "unknown":
            result.total_calories = 0.0
            result.protein_g = 0.0
            result.fat_g = 0.0
            result.carbs_g = 0.0
            result.items = []
            result.portion_assumed = False
            result.meal_slot = None
            result.volume_ml = None
            if not result.unknown_reason:
                result.unknown_reason = DEFAULT_UNKNOWN_REASON
            result.needs_clarification = False
            result.clarification_question = None
            return result
        if forced_type:
            result.type = forced_type
        result = apply_typed_result(result)
        result.needs_clarification = False
        result.clarification_question = None
        return result

    async def _analyze_staged(
        self,
        *,
        text: str | None,
        image_path: str | None,
        profile_context: dict | None = None,
        forced_type: str | None = None,
        on_progress: ProgressCallback = None,
        classification: dict | None = None,
    ) -> AnalysisResult:
        if classification is None:
            classification = await self._classify(
                text=text,
                image_path=image_path,
                profile_context=profile_context,
            )
        classified_type = str(classification.get("type", "unknown")).lower()
        confidence = float(classification.get("confidence", 0) or 0)
        title = str(classification.get("title") or "")
        unknown_reason = classification.get("unknown_reason")
        classified_slot = normalize_meal_slot(classification.get("meal_slot"))

        async def _unknown(
            *,
            reason: str,
            progress_type: str = "unknown",
        ) -> AnalysisResult:
            await _notify_progress(on_progress, "classified", type=progress_type)
            return _unknown_result(
                unknown_reason=reason,
                title=title,
                confidence=confidence,
            )

        if image_path and classified_type == "activity":
            return await _unknown(reason=PHOTO_NO_FOOD_REASON)

        if classified_type == "unknown":
            return await _unknown(
                reason=str(unknown_reason) if unknown_reason else DEFAULT_UNKNOWN_REASON,
            )

        if classified_type == "weight":
            return await _unknown(reason=MANUAL_WEIGHT_ENTRY)

        if classified_type not in {"meal", "activity", "water"}:
            return await _unknown(reason=DEFAULT_UNKNOWN_REASON)

        result_type = forced_type if forced_type else classified_type
        if image_path and result_type == "activity":
            return await _unknown(reason=PHOTO_NO_FOOD_REASON)

        await _notify_progress(on_progress, "classified", type=result_type)

        identification: dict = {
            "type": result_type,
            "title": title,
            "confidence": confidence,
            "assumptions": list(classification.get("assumptions") or []),
        }

        if image_path:
            await _notify_progress(on_progress, "photo_detail", type=result_type)
            detail = await self._detail_photo(
                text=text,
                image_path=image_path,
                profile_context=profile_context,
                classification=classification,
            )
            detail_type = str(detail.get("type", "meal")).lower()
            if detail_type == "unknown":
                return _unknown_result(
                    unknown_reason=str(detail.get("unknown_reason") or PHOTO_NO_FOOD_REASON),
                    title=str(detail.get("title") or title),
                    confidence=float(detail.get("confidence", confidence) or confidence),
                )
            identification["title"] = str(detail.get("title") or title)
            identification["assumptions"] = list(detail.get("assumptions") or [])
            identification["confidence"] = float(detail.get("confidence", confidence) or confidence)
            if result_type == "water":
                identification["volume_ml"] = detail.get("volume_ml")
                identification["meal_slot"] = None
            else:
                identification["components"] = list(detail.get("components") or [])
                identification["meal_slot"] = classified_slot
            if result_type == "activity":
                identification["activity"] = detail.get("activity") or {
                    "name": identification["title"],
                    "duration_minutes": detail.get("duration_minutes"),
                    "intensity": None,
                }
        else:
            if result_type == "activity":
                identification["activity"] = {
                    "name": title or None,
                    "duration_minutes": classification.get("duration_minutes"),
                    "intensity": classification.get("intensity"),
                }
            elif result_type == "water":
                identification["volume_ml"] = classification.get("volume_ml")
                identification["meal_slot"] = None
            else:
                identification["components"] = list(classification.get("components") or [])
                identification["meal_slot"] = classified_slot

        await _notify_progress(on_progress, "calculate", type=result_type)
        result = await self._calculate(
            identification=identification,
            text=text,
            profile_context=profile_context,
        )
        if result.unknown_reason == MANUAL_WEIGHT_ENTRY:
            return result
        result.type = result_type
        result = apply_typed_result(result)
        if result.type == "meal" and result.meal_slot is None:
            result.meal_slot = classified_slot
        result.needs_clarification = False
        result.clarification_question = None
        result.unknown_reason = None
        return result

    async def _analyze_image(
        self,
        *,
        text: str | None,
        image_path: str,
        profile_context: dict | None,
        input_label: str = "User input",
        forced_type: str | None = None,
        on_progress: ProgressCallback = None,
    ) -> AnalysisResult:
        decoded = decode_product_barcode(image_path)
        if decoded:
            return await self._resolve_barcode(
                {
                    "type": "barcode",
                    "barcode": decoded,
                    "meal_slot": meal_slot_from_text(text),
                    "confidence": 1.0,
                },
                text=text,
                on_progress=on_progress,
            )
        classification = await self._classify(
            text=text,
            image_path=image_path,
            profile_context=profile_context,
        )
        if str(classification.get("type", "")).lower() == "barcode":
            return await self._resolve_barcode(
                classification,
                text=text,
                on_progress=on_progress,
            )
        if str(classification.get("type", "")).lower() == "weight":
            return _unknown_result(unknown_reason=MANUAL_WEIGHT_ENTRY)
        if single_call_enabled():
            return await self._analyze_single(
                text=text,
                image_path=image_path,
                profile_context=profile_context,
                input_label=input_label,
                forced_type=forced_type,
            )
        return await self._analyze_staged(
            text=text,
            image_path=image_path,
            profile_context=profile_context,
            forced_type=forced_type,
            on_progress=on_progress,
            classification=classification,
        )

    async def _resolve_barcode(
        self,
        classification: dict,
        *,
        text: str | None,
        on_progress: ProgressCallback,
    ) -> AnalysisResult:
        confidence = float(classification.get("confidence", 0) or 0)
        meal_slot = normalize_meal_slot(classification.get("meal_slot"))
        del text
        await _notify_progress(on_progress, "classified", type="barcode")
        code = barcode_digits(classification.get("barcode"))
        if not ean_checksum_ok(code):
            return _unknown_result(unknown_reason=BARCODE_UNREADABLE, confidence=confidence)

        try:
            product = lookup_product(code)
        except (FileNotFoundError, sqlite3.Error):
            return _unknown_result(unknown_reason=PRODUCT_DB_UNAVAILABLE, confidence=confidence)
        if product is None:
            return _unknown_result(unknown_reason=PRODUCT_NOT_FOUND, confidence=confidence)

        try:
            label = parse_energy_cost(product.energy_cost)
        except (AttributeError, ValueError):
            logger.exception("Catalog nutrition parse failed")
            label = None
        title = product_title(product.title, product.brand)
        if label is not None and is_plain_water(title, label):
            return _water_from_catalog(title, product, confidence)
        if label is not None:
            return _meal_from_label(title, product, label, meal_slot, confidence)

        await _notify_progress(on_progress, "calculate", type="meal")
        grams, assumed = package_grams(product.volume, product.weight_g)
        quantity = f"{grams:.0f} г"
        identification = {
            "type": "meal",
            "title": title,
            "meal_slot": meal_slot,
            "components": [{"name": title, "estimated_weight_g": grams}],
        }
        description = _catalog_estimate_text(title, quantity, product.energy_cost)
        result = await self._calculate(
            identification=identification,
            text=description,
            profile_context=None,
        )
        if result.unknown_reason == MANUAL_WEIGHT_ENTRY:
            return result
        result.type = "meal"
        result = apply_typed_result(result)
        result.meal_slot = meal_slot
        result.title = result.title or title
        result.portion_assumed = assumed
        if ESTIMATE_ASSUMPTION not in result.assumptions:
            result.assumptions.append(ESTIMATE_ASSUMPTION)
        result.needs_clarification = False
        result.clarification_question = None
        result.unknown_reason = None
        return _with_product_image(result, product)

    async def analyze_food(
        self,
        *,
        text: str | None,
        image_path: str | None,
        profile_context: dict | None = None,
        on_progress: ProgressCallback = None,
    ) -> AnalysisResult:
        if image_path:
            return await self._analyze_image(
                text=text,
                image_path=image_path,
                profile_context=profile_context,
                input_label="User description",
                forced_type="meal",
                on_progress=on_progress,
            )
        if single_call_enabled():
            return await self._analyze_single(
                text=text,
                image_path=image_path,
                profile_context=profile_context,
                input_label="User description",
                forced_type="meal",
            )
        return await self._analyze_staged(
            text=text,
            image_path=image_path,
            profile_context=profile_context,
            forced_type="meal",
            on_progress=on_progress,
        )

    async def analyze_auto(
        self,
        *,
        text: str | None,
        image_path: str | None,
        profile_context: dict | None = None,
        on_progress: ProgressCallback = None,
    ) -> AnalysisResult:
        if image_path:
            return await self._analyze_image(
                text=text,
                image_path=image_path,
                profile_context=profile_context,
                on_progress=on_progress,
            )
        if single_call_enabled():
            return await self._analyze_single(
                text=text,
                image_path=image_path,
                profile_context=profile_context,
            )
        return await self._analyze_staged(
            text=text,
            image_path=image_path,
            profile_context=profile_context,
            on_progress=on_progress,
        )

    async def analyze_water(
        self,
        *,
        text: str | None,
        image_path: str | None,
        profile_context: dict | None = None,
        on_progress: ProgressCallback = None,
    ) -> AnalysisResult:
        if image_path:
            return await self._analyze_image(
                text=text,
                image_path=image_path,
                profile_context=profile_context,
                input_label="User description",
                forced_type="water",
                on_progress=on_progress,
            )
        if single_call_enabled():
            return await self._analyze_single(
                text=text,
                image_path=image_path,
                profile_context=profile_context,
                input_label="User description",
                forced_type="water",
            )
        return await self._analyze_staged(
            text=text,
            image_path=image_path,
            profile_context=profile_context,
            forced_type="water",
            on_progress=on_progress,
        )

    async def analyze_activity(
        self,
        *,
        text: str | None,
        image_path: str | None,
        profile_context: dict | None = None,
        on_progress: ProgressCallback = None,
    ) -> AnalysisResult:
        if image_path:
            return await self._analyze_image(
                text=text,
                image_path=image_path,
                profile_context=profile_context,
                input_label="User description",
                forced_type="activity",
                on_progress=on_progress,
            )
        if single_call_enabled():
            return await self._analyze_single(
                text=text,
                image_path=image_path,
                profile_context=profile_context,
                input_label="User description",
                forced_type="activity",
            )
        return await self._analyze_staged(
            text=text,
            image_path=image_path,
            profile_context=profile_context,
            forced_type="activity",
            on_progress=on_progress,
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

    async def write_week_review(self, facts: dict[str, Any]) -> CoachWeekReview:
        raw = await self.run_prompt(build_coach_week_prompt(facts))
        return parse_coach_review(raw)
