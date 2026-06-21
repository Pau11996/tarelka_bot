from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from src.ai_analyzer.cursor_runner import save_upload
from src.ai_analyzer.runner_factory import create_analysis_runner, use_openai_api
from src.shared.schemas import AnalysisResult

logger = logging.getLogger(__name__)

app = FastAPI(title="ТАРЕЛКА AI Analyzer")
runner = create_analysis_runner()


class TextAnalyzeRequest(BaseModel):
    mode: str
    text: str
    profile_context: dict[str, Any] | None = None
    previous_result: dict[str, Any] | None = None


class AnalyzeResponse(BaseModel):
    raw_response: str
    parsed: AnalysisResult


@app.get("/health")
async def health() -> dict[str, str]:
    backend = "openai" if use_openai_api() else "cursor"
    return {"status": "ok", "backend": backend}


@app.post("/analyze/text", response_model=AnalyzeResponse)
async def analyze_text(request: TextAnalyzeRequest) -> AnalyzeResponse:
    try:
        if request.previous_result:
            result = await runner.correct_analysis(
                previous_result=request.previous_result,
                correction_text=request.text,
            )
            raw = json.dumps(result.model_dump(), ensure_ascii=False)
            return AnalyzeResponse(raw_response=raw, parsed=result)

        if request.mode == "auto":
            result = await runner.analyze_auto(
                text=request.text,
                image_path=None,
                profile_context=request.profile_context,
            )
        elif request.mode == "activity":
            result = await runner.analyze_activity(
                text=request.text,
                image_path=None,
                profile_context=request.profile_context,
            )
        else:
            result = await runner.analyze_food(
                text=request.text,
                image_path=None,
                profile_context=request.profile_context,
            )
        raw = json.dumps(result.model_dump(), ensure_ascii=False)
        return AnalyzeResponse(raw_response=raw, parsed=result)
    except Exception as exc:
        logger.exception("Text analysis failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/analyze/image", response_model=AnalyzeResponse)
async def analyze_image(
    mode: str = Form("meal"),
    text: str | None = Form(None),
    profile_context: str | None = Form(None),
    previous_result: str | None = Form(None),
    image: UploadFile = File(...),
) -> AnalyzeResponse:
    try:
        content = await image.read()
        suffix = os.path.splitext(image.filename or "upload.jpg")[1] or ".jpg"
        image_path = save_upload(f"{uuid.uuid4().hex}{suffix}", content)
        profile = json.loads(profile_context) if profile_context else None
        prev = json.loads(previous_result) if previous_result else None

        if prev:
            result = await runner.correct_analysis(
                previous_result=prev,
                correction_text=text or "Исправь анализ по фото с учетом уточнений пользователя.",
                image_path=image_path,
            )
        elif mode == "auto":
            result = await runner.analyze_auto(
                text=text,
                image_path=image_path,
                profile_context=profile,
            )
        elif mode == "activity":
            result = await runner.analyze_activity(
                text=text,
                image_path=image_path,
                profile_context=profile,
            )
        else:
            result = await runner.analyze_food(
                text=text,
                image_path=image_path,
                profile_context=profile,
            )

        raw = json.dumps(result.model_dump(), ensure_ascii=False)
        return AnalyzeResponse(raw_response=raw, parsed=result)
    except Exception as exc:
        logger.exception("Image analysis failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def main() -> None:
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    uvicorn.run(app, host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()
