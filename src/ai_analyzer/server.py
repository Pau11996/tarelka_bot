from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from src.ai_analyzer.admin import router as admin_router
from src.ai_analyzer.analysis_runner import ProgressCallback
from src.ai_analyzer.transcribe import (
    TranscriptionEmpty,
    TranscriptionUnavailable,
    transcribe_audio,
)
from src.shared.logging_config import setup_logging
from src.ai_analyzer.runner_factory import create_analysis_runner
from src.shared.schemas import AnalysisResult

logger = logging.getLogger(__name__)

app = FastAPI(title="ТАРЕЛКА AI Analyzer")
app.include_router(admin_router)
runner = create_analysis_runner()


def save_upload(filename: str, content: bytes, upload_dir: str | None = None) -> str:
    base = Path(upload_dir or os.environ.get("UPLOAD_DIR", "/tmp/uploads"))
    base.mkdir(parents=True, exist_ok=True)
    path = base / filename
    path.write_bytes(content)
    return str(path)


class TextAnalyzeRequest(BaseModel):
    mode: str
    text: str
    profile_context: dict[str, Any] | None = None
    previous_result: dict[str, Any] | None = None
    stream: bool = False


class AnalyzeResponse(BaseModel):
    raw_response: str
    parsed: AnalysisResult


class TranscribeResponse(BaseModel):
    text: str


def _delete_upload(image_path: str | None) -> None:
    if image_path is None:
        return
    try:
        Path(image_path).unlink(missing_ok=True)
    except OSError:
        logger.warning("Failed to delete temporary upload %s", image_path)


def _analyze_response(result: AnalysisResult) -> AnalyzeResponse:
    raw = json.dumps(result.model_dump(), ensure_ascii=False)
    return AnalyzeResponse(raw_response=raw, parsed=result)


async def _run_analysis(
    *,
    mode: str,
    text: str | None,
    image_path: str | None,
    profile_context: dict[str, Any] | None,
    previous_result: dict[str, Any] | None,
    on_progress: ProgressCallback = None,
) -> AnalysisResult:
    if previous_result:
        return await runner.correct_analysis(
            previous_result=previous_result,
            correction_text=text or "Исправь анализ по фото с учетом уточнений пользователя.",
            image_path=image_path,
        )
    if mode == "auto":
        return await runner.analyze_auto(
            text=text,
            image_path=image_path,
            profile_context=profile_context,
            on_progress=on_progress,
        )
    if mode == "activity":
        return await runner.analyze_activity(
            text=text,
            image_path=image_path,
            profile_context=profile_context,
            on_progress=on_progress,
        )
    return await runner.analyze_food(
        text=text,
        image_path=image_path,
        profile_context=profile_context,
        on_progress=on_progress,
    )


def _stream_analysis(
    run: Callable[[ProgressCallback], Awaitable[AnalysisResult]],
    *,
    cleanup: Callable[[], None] | None = None,
) -> StreamingResponse:
    async def generate() -> AsyncIterator[str]:
        queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

        async def on_progress(event: str, payload: dict[str, Any]) -> None:
            await queue.put({"event": event, **payload})

        async def worker() -> None:
            try:
                result = await run(on_progress)
                raw = json.dumps(result.model_dump(), ensure_ascii=False)
                await queue.put(
                    {
                        "event": "done",
                        "raw_response": raw,
                        "parsed": result.model_dump(),
                    }
                )
            except Exception as exc:
                logger.exception("Analysis failed")
                await queue.put({"event": "error", "detail": str(exc)})
            finally:
                await queue.put(None)

        task = asyncio.create_task(worker())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield json.dumps(item, ensure_ascii=False) + "\n"
        finally:
            await task
            if cleanup is not None:
                cleanup()

    return StreamingResponse(generate(), media_type="application/x-ndjson")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "backend": "openai"}


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(audio: UploadFile = File(...)) -> TranscribeResponse:
    try:
        content = await audio.read()
        filename = audio.filename or "voice.ogg"
        text = await transcribe_audio(content, filename=filename)
        return TranscribeResponse(text=text)
    except TranscriptionUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except TranscriptionEmpty as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Transcription failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/analyze/text")
async def analyze_text(request: TextAnalyzeRequest):
    async def run(on_progress: ProgressCallback) -> AnalysisResult:
        return await _run_analysis(
            mode=request.mode,
            text=request.text,
            image_path=None,
            profile_context=request.profile_context,
            previous_result=request.previous_result,
            on_progress=on_progress,
        )

    if request.stream:
        return _stream_analysis(run)
    try:
        result = await run(None)
        return _analyze_response(result)
    except Exception as exc:
        logger.exception("Text analysis failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/analyze/image")
async def analyze_image(
    mode: str = Form("meal"),
    text: str | None = Form(None),
    profile_context: str | None = Form(None),
    previous_result: str | None = Form(None),
    image: UploadFile = File(...),
    stream: bool = Form(False),
):
    content = await image.read()
    suffix = os.path.splitext(image.filename or "upload.jpg")[1] or ".jpg"
    image_path = save_upload(f"{uuid.uuid4().hex}{suffix}", content)
    try:
        profile = json.loads(profile_context) if profile_context else None
        prev = json.loads(previous_result) if previous_result else None
    except json.JSONDecodeError as exc:
        _delete_upload(image_path)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    async def run(on_progress: ProgressCallback) -> AnalysisResult:
        return await _run_analysis(
            mode=mode,
            text=text,
            image_path=image_path,
            profile_context=profile,
            previous_result=prev,
            on_progress=on_progress,
        )

    if stream is True:
        return _stream_analysis(run, cleanup=lambda: _delete_upload(image_path))
    try:
        result = await run(None)
        return _analyze_response(result)
    except Exception as exc:
        logger.exception("Image analysis failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        _delete_upload(image_path)


def main() -> None:
    import uvicorn

    setup_logging("ai_analyzer")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_config=None)


if __name__ == "__main__":
    main()
