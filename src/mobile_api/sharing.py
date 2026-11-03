"""Compose share cards from a bundled template and the displayed values, without AI."""
import asyncio
import base64

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from src.bot.services.share_cards import DailyNorm, render_daily_norm_png
from src.db.models import User
from src.mobile_api.deps import get_current_user

router = APIRouter(prefix="/share")


class NormSnapshot(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    calories: int = Field(gt=0, le=100_000)
    protein: int = Field(ge=0, le=100_000)
    fat: int = Field(ge=0, le=100_000)
    carbs: int = Field(ge=0, le=100_000)
    personalized: bool


@router.post("/daily-norm")
async def share_daily_norm(body: NormSnapshot, response: Response, user: User = Depends(get_current_user)):
    # Keep the snapshot: changes to the profile must not change an open share card.
    norm = DailyNorm(**body.model_dump())
    try:
        png = await asyncio.to_thread(render_daily_norm_png, norm)
    except OSError:
        raise HTTPException(503, "Не удалось подготовить картинку. Попробуйте ещё раз.") from None
    response.headers["Cache-Control"] = "no-store"
    return {"image_base64": base64.b64encode(png).decode("ascii")}
