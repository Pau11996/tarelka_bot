from __future__ import annotations

import logging

import httpx
from aiogram import Bot
from fastapi import HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from src.bot.config import settings
from src.bot.services.ai_client import AIAnalyzerClient
from src.bot.services.entry_service import EntryService
from src.bot.services.formatting import profile_context
from src.bot.services.referrals import reward_referrer_after_first_analysis
from src.bot.services.request_limit import consume_request_grant, format_limit_reached_message, refund_request
from src.db.models import AnalysisType, EntryType, User
from src.db.repository import UserRepository
from src.mobile_api.serializers import balance_out, entry_out
from src.shared.schemas import AnalysisResult

logger = logging.getLogger(__name__)

UNKNOWN_MESSAGE = (
    "Не получилось понять, что это. "
    "Отправьте фото еды, опишите блюдо текстом или расскажите про тренировку."
)
ANALYSIS_UNAVAILABLE = "Анализ временно недоступен. Попробуйте ещё раз."
VOICE_NOT_RECOGNIZED = "Не удалось распознать речь. Попробуйте ещё раз или напишите текстом."
VOICE_UNAVAILABLE = "Голосовой ввод временно недоступен. Отправьте описание текстом или фото."


def _analysis_type(*, result: AnalysisResult, has_image: bool) -> AnalysisType:
    if result.type == "activity":
        return AnalysisType.ACTIVITY_PHOTO if has_image else AnalysisType.ACTIVITY_TEXT
    return AnalysisType.FOOD_PHOTO if has_image else AnalysisType.FOOD_TEXT


async def _reward_referrer(repo: UserRepository, user_id: int) -> None:
    try:
        if not settings.telegram_bot_token:
            await repo.grant_referral_reward(
                user_id,
                bonus_requests=settings.referral_bonus_requests,
            )
            return
        async with Bot(token=settings.telegram_bot_token) as bot:
            await reward_referrer_after_first_analysis(
                bot,
                repo,
                referred_user_id=user_id,
            )
    except Exception:
        logger.exception("Failed to grant referral reward for user_id=%s", user_id)


async def _read_upload(upload: UploadFile | None, default_name: str) -> tuple[bytes, str] | None:
    if upload is None:
        return None
    content = await upload.read()
    if not content:
        return None
    return content, upload.filename or default_name


class AnalysisService:
    def __init__(self, session: AsyncSession, ai_client: AIAnalyzerClient | None = None) -> None:
        self.session = session
        self.repo = UserRepository(session)
        self.entries = EntryService(session)
        self.ai = ai_client or AIAnalyzerClient()

    async def analyze(
        self,
        user: User,
        *,
        text: str | None,
        image: UploadFile | list[UploadFile] | None,
        audio: UploadFile | None,
    ) -> dict:
        profile = await self.repo.ensure_default_profile(user.id)
        grant = await consume_request_grant(self.repo, user)
        if grant is None:
            raise HTTPException(status_code=429, detail=format_limit_reached_message(user))

        uploads = image if isinstance(image, list) else [image] if image is not None else []
        image_payloads: list[tuple[bytes, str]] = []
        for item in uploads:
            payload = await _read_upload(item, "photo.jpg")
            if payload is not None:
                image_payloads.append(payload)
        audio_payload = await _read_upload(audio, "voice.m4a")
        caption = (text or "").strip()
        transcript = ""

        try:
            if audio_payload is not None:
                audio_bytes, audio_name = audio_payload
                try:
                    transcript = await self.ai.transcribe(audio_bytes=audio_bytes, filename=audio_name)
                except httpx.HTTPStatusError as exc:
                    status = exc.response.status_code if exc.response is not None else 0
                    detail = VOICE_NOT_RECOGNIZED if status == 400 else VOICE_UNAVAILABLE
                    raise HTTPException(status_code=400 if status == 400 else 503, detail=detail) from exc
                except httpx.HTTPError as exc:
                    raise HTTPException(status_code=503, detail=VOICE_UNAVAILABLE) from exc
                if not transcript:
                    raise HTTPException(status_code=400, detail=VOICE_NOT_RECOGNIZED)

            parts = [part for part in (caption, transcript) if part]
            combined = "\n".join(parts)
            if not image_payloads and not combined:
                raise HTTPException(status_code=400, detail="Отправьте фото, текст или голосовое.")

            context = profile_context(profile)
            if image_payloads:
                image_bytes, image_name = image_payloads[0]
                raw, result = await self.ai.analyze_image(
                    mode="auto",
                    image_bytes=image_bytes,
                    filename=image_name,
                    extra_images=image_payloads[1:],
                    text=combined or None,
                    profile_context=context,
                )
            else:
                raw, result = await self.ai.analyze_text(
                    mode="auto",
                    text=combined,
                    profile_context=context,
                )
        except httpx.HTTPError as exc:
            logger.exception("Mobile analysis request failed")
            await refund_request(self.repo, user, grant)
            raise HTTPException(status_code=503, detail=ANALYSIS_UNAVAILABLE) from exc
        except Exception:
            await refund_request(self.repo, user, grant)
            raise

        analysis_type = _analysis_type(result=result, has_image=bool(image_payloads))
        input_text = combined or None
        if result.type == "unknown":
            await self.entries.log_unknown_analysis(
                user=user,
                analysis_type=analysis_type,
                input_text=input_text,
                image_path=None,
                raw_response=raw,
                result=result,
            )
            await refund_request(self.repo, user, grant)
            return {
                "status": "unknown",
                "message": UNKNOWN_MESSAGE,
                "result": result.model_dump(),
            }

        try:
            if result.type == "activity":
                entry, balance = await self.entries.save_activity_from_analysis(
                    user=user,
                    analysis_type=analysis_type,
                    input_text=input_text,
                    image_path=None,
                    raw_response=raw,
                    result=result,
                )
            else:
                entry, balance = await self.entries.save_meal_from_analysis(
                    user=user,
                    analysis_type=analysis_type,
                    input_text=input_text,
                    image_path=None,
                    raw_response=raw,
                    result=result,
                )
        except Exception:
            await refund_request(self.repo, user, grant)
            raise

        await _reward_referrer(self.repo, user.id)
        return {
            "status": "saved",
            "entry": entry_out(entry),
            "balance": balance_out(balance),
            "transcript": transcript or None,
        }

    async def correct(self, user: User, entry_id: int, text: str) -> dict:
        entry = await self.repo.get_entry(entry_id, user.id)
        if entry is None or entry.entry_type not in {EntryType.MEAL, EntryType.ACTIVITY}:
            raise HTTPException(status_code=404, detail="Запись не найдена")

        grant = await consume_request_grant(self.repo, user)
        if grant is None:
            raise HTTPException(status_code=429, detail=format_limit_reached_message(user))

        previous = None
        if entry.ai_analysis_id:
            analysis = await self.repo.get_analysis(entry.ai_analysis_id)
            if analysis is not None and analysis.parsed_json:
                previous = analysis.parsed_json

        mode = "activity" if entry.entry_type == EntryType.ACTIVITY else "meal"
        try:
            raw, result = await self.ai.analyze_text(
                mode=mode,
                text=text,
                previous_result=previous,
            )
        except httpx.HTTPError as exc:
            logger.exception("Mobile correction request failed")
            await refund_request(self.repo, user, grant)
            raise HTTPException(status_code=503, detail=ANALYSIS_UNAVAILABLE) from exc
        except Exception:
            await refund_request(self.repo, user, grant)
            raise

        if result.type == "unknown":
            await refund_request(self.repo, user, grant)
            return {
                "status": "unknown",
                "message": UNKNOWN_MESSAGE,
                "result": result.model_dump(),
            }

        try:
            if entry.entry_type == EntryType.ACTIVITY:
                balance = await self.entries.update_activity_from_correction(
                    user=user,
                    entry=entry,
                    correction_text=text,
                    raw_response=raw,
                    result=result,
                )
            else:
                balance = await self.entries.update_meal_from_correction(
                    user=user,
                    entry=entry,
                    correction_text=text,
                    raw_response=raw,
                    result=result,
                )
        except Exception:
            await refund_request(self.repo, user, grant)
            raise

        return {
            "status": "saved",
            "entry": entry_out(entry),
            "balance": balance_out(balance),
        }
