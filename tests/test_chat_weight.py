import io
import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select

from test_mobile_api import api
from test_mobile_experience import setup
from test_weight_bot import bot_weights, message
from src.ai_analyzer.analysis_runner import BaseAnalysisRunner
from src.bot.handlers import food
from src.bot.handlers import achievements as weight_handlers
from src.bot.states import WeightTrackingStates
from src.bot.services.ai_client import AIAnalyzerClient
from src.db.models import DayEntry, User, WeightHistory
from src.mobile_api import worker
from src.shared.schemas import AnalysisResult, MANUAL_WEIGHT_ENTRY
from src.shared.weight_tracking import record_weight, current_weight


@pytest.mark.parametrize("value", [None, 0, -5, 79.5, "79,5", 1001, float("nan"), float("inf")])
def test_retired_chat_weight_result_is_rejected_without_food_or_measurement(value):
    payload = {"type": "weight", "weight_kg": value, "total_calories": 500,
               "protein_g": 20, "volume_ml": 250, "meal_slot": "dinner"}
    for result in (AnalysisResult.from_dict(payload), AnalysisResult(**payload)):
        assert result.type == "unknown"
        assert result.total_calories == result.protein_g == 0
        assert result.items == []
        assert result.meal_slot is result.volume_ml is None
        assert "weight_kg" not in result.model_dump()
        assert result.unknown_reason == MANUAL_WEIGHT_ENTRY


async def test_messages_in_same_second_use_latest_measurement_across_id_boundaries(bot_weights):
    factory, uid, _, _, _ = bot_weights
    moment = datetime.now(timezone.utc)
    async with factory() as session:
        user = await session.get(User, uid)
        for index in range(10):
            await record_weight(session, user, 70 + index, operation_key=f"same-second:{index}", now=moment)
        assert await current_weight(session, user) == 79


class RetiredWeightRunner(BaseAnalysisRunner):
    def __init__(self):
        self.calls = []

    async def run_prompt(self, prompt, image_path=None, *, stage=None):
        self.calls.append((prompt, image_path, stage))
        return json.dumps({"type": "weight", "weight_kg": 79.5, "confidence": 0.99})


@pytest.mark.parametrize("single_call", ["true", "false"])
@pytest.mark.parametrize("photo", [True, False])
@pytest.mark.parametrize("mode", ["auto", "food", "water", "activity"])
async def test_analyzer_no_longer_requests_or_accepts_weight(single_call, photo, mode, monkeypatch):
    monkeypatch.setenv("AI_SINGLE_CALL", single_call)
    runner = RetiredWeightRunner()
    result = await getattr(runner, f"analyze_{mode}")(
        text=None if photo else "мой вес 79,5", image_path="/tmp/scale.jpg" if photo else None,
        profile_context={"weight_kg": 90})
    assert result.type == "unknown" and result.unknown_reason == MANUAL_WEIGHT_ENTRY
    assert len(runner.calls) == 1
    prompt = runner.calls[0][0]
    assert '"weight"' not in prompt
    assert "Body-weight logging rules" not in prompt
    assert "bathroom/body scales" not in prompt


async def test_retired_weight_response_during_calculation_cannot_become_food(monkeypatch):
    monkeypatch.setenv("AI_SINGLE_CALL", "false")

    class Runner(RetiredWeightRunner):
        async def run_prompt(self, prompt, image_path=None, *, stage=None):
            if stage == "classify":
                return json.dumps({"type": "meal", "title": "Рис"})
            return await super().run_prompt(prompt, image_path, stage=stage)

    result = await Runner().analyze_auto(text="рис", image_path=None)
    assert result.type == "unknown" and result.unknown_reason == MANUAL_WEIGHT_ENTRY


@pytest.mark.parametrize("kind", ["text", "photo", "voice"])
async def test_mobile_chat_cannot_save_weight_or_finish_goal(setup, monkeypatch, kind):
    client, factory, headers, uid = setup
    await client.put("/v1/profile", headers=headers, json={"weight_kg": 80})
    await client.put("/v1/weight-goal", headers=headers, json={"target_weight_kg": 75})
    before = (await client.get("/v1/achievements", headers=headers)).json()
    rejected = AnalysisResult(type="weight", weight_kg=70)
    monkeypatch.setattr(AIAnalyzerClient, "analyze_text", AsyncMock(return_value=("{}", rejected)))
    monkeypatch.setattr(AIAnalyzerClient, "analyze_image", AsyncMock(return_value=("{}", rejected)))
    monkeypatch.setattr(AIAnalyzerClient, "transcribe", AsyncMock(return_value="мой вес семьдесят"))
    data = {"request_key": f"weight-chat-{kind}", "text": "мой вес 70" if kind == "text" else ""}
    files = {"image": ("scale.jpg", b"photo", "image/jpeg")} if kind == "photo" else None
    if kind == "voice":
        transcription = await client.post("/v1/voice/transcribe", headers=headers,
                                          files={"audio": ("weight.m4a", b"audio", "audio/mp4")})
        assert transcription.status_code == 200
        data["voice_id"] = transcription.json()["media_id"]
    first = (await client.post("/v1/operations", headers=headers, data=data, files=files)).json()
    assert await worker.process_one()
    replay = (await client.post("/v1/operations", headers=headers, data=data, files=files)).json()
    assert replay["id"] == first["id"]
    assert replay["status"] == "done" and replay["result"]["status"] == "unknown"
    assert replay["result"]["message"] == MANUAL_WEIGHT_ENTRY
    after = (await client.get("/v1/achievements", headers=headers)).json()
    assert after["current_weight_kg"] == 80 and after["goal"]["id"] == before["goal"]["id"]
    assert len(after["weight_history"]) == len(before["weight_history"])
    history = (await client.get("/v1/chat", headers=headers)).json()
    assert history["entries"] == [] and history["notices"] == []


async def test_direct_mobile_chat_analysis_cannot_save_weight(setup, monkeypatch):
    client, _, headers, _ = setup
    monkeypatch.setattr(AIAnalyzerClient, "analyze_text", AsyncMock(
        return_value=("{}", AnalysisResult(type="weight", weight_kg=79))))
    response = await client.post("/v1/entries/analyze", headers=headers,
                                 data={"text": "мой вес 79", "operation_id": "retired-weight"})
    assert response.status_code == 200 and response.json()["status"] == "unknown"
    assert response.json()["message"] == MANUAL_WEIGHT_ENTRY
    assert (await client.get("/v1/achievements", headers=headers)).json()["weight_history"] == []


def media_message(kind, text="мой вес 70", message_id=219):
    event = message(text, message_id)
    event.caption = None
    event.photo = [SimpleNamespace(file_id="scale-photo")] if kind == "photo" else None
    event.voice = SimpleNamespace(duration=3, file_id="weight-voice") if kind == "voice" else None
    event.bot.get_file = AsyncMock(return_value=SimpleNamespace(file_path="file"))
    event.bot.download_file = AsyncMock(side_effect=lambda *_: io.BytesIO(b"file"))
    return event


@pytest.mark.parametrize("kind", ["text", "photo", "voice"])
async def test_telegram_chat_cannot_save_weight_or_food(bot_weights, monkeypatch, kind):
    factory, uid, state, cleanup, client = bot_weights
    rejected = AnalysisResult(type="weight", weight_kg=70)
    monkeypatch.setattr(food.ai_client, "analyze_text", AsyncMock(return_value=("{}", rejected)))
    monkeypatch.setattr(food.ai_client, "analyze_image", AsyncMock(return_value=("{}", rejected)))
    monkeypatch.setattr(food.ai_client, "transcribe", AsyncMock(return_value="мой вес 70"))
    event = media_message(kind)
    handler = {"text": food.handle_food_text, "photo": food.handle_food_photo, "voice": food.handle_food_voice}[kind]
    async with factory() as session:
        await handler(event, state, session, cleanup)
        assert await session.scalar(select(func.count()).select_from(DayEntry).where(DayEntry.user_id == uid)) == 0
        assert await session.scalar(select(func.count()).select_from(WeightHistory).where(WeightHistory.user_id == uid)) == 0
    assert MANUAL_WEIGHT_ENTRY in event.answer.call_args.args[0]


@pytest.mark.parametrize("number", ["70", "70,0", "70.0"])
async def test_manual_weight_form_completes_goal_without_ai(bot_weights, monkeypatch, number):
    factory, uid, state, cleanup, client = bot_weights
    await client.put("/v1/profile", json={"weight_kg": 80})
    await client.put("/v1/weight-goal", json={"target_weight_kg": 70})
    analyzer = AsyncMock(side_effect=AssertionError("Manual weight must not use AI"))
    for method in ("analyze_text", "analyze_image", "transcribe"):
        monkeypatch.setattr(food.ai_client, method, analyzer)
    event = message(number, 220)
    async with factory() as session:
        await state.set_state(WeightTrackingStates.weight)
        await weight_handlers.save_measurement(event, state, session, cleanup)
        assert await state.get_state() is None
        assert await session.scalar(select(func.count()).select_from(DayEntry).where(DayEntry.user_id == uid)) == 0
    analyzer.assert_not_awaited()
    data = (await client.get("/v1/achievements")).json()
    assert data["goal"] is None and data["goal_history"][0]["status"] == "completed"
    assert data["current_weight_kg"] == 70
    assert any(award["key"] == "weight_goal_completed" and award["earned"] for award in data["achievements"])
    assert "Записал <b>70 кг</b>" in event.answer.call_args.args[0]
    assert len((await client.get("/v1/chat")).json()["notices"]) == 1


@pytest.mark.parametrize("kind,text", [("text", "мой вес 70"), ("text", "семьдесят"), ("text", "70 кг"),
                                      ("text", "nan"), ("text", "-1"), ("text", "1001"),
                                      ("photo", "70"), ("voice", "70")])
async def test_manual_weight_form_rejects_non_numeric_inputs_without_ai(bot_weights, monkeypatch, kind, text):
    factory, uid, state, cleanup, _ = bot_weights
    analyzer = AsyncMock(side_effect=AssertionError("Invalid weight must not use AI"))
    for method in ("analyze_text", "analyze_image", "transcribe"):
        monkeypatch.setattr(food.ai_client, method, analyzer)
    event = media_message(kind, text=text)
    async with factory() as session:
        await state.set_state(WeightTrackingStates.weight)
        await weight_handlers.save_measurement(event, state, session, cleanup)
        assert await state.get_state() == WeightTrackingStates.weight.state
        assert await session.scalar(select(func.count()).select_from(DayEntry).where(DayEntry.user_id == uid)) == 0
        assert await session.scalar(select(func.count()).select_from(WeightHistory).where(WeightHistory.user_id == uid)) == 0
    analyzer.assert_not_awaited()
    event.bot.get_file.assert_not_awaited()
    assert "Введите" in event.answer.call_args.args[0]


async def test_manual_weight_replay_after_state_clears_does_not_analyze_or_create_food(bot_weights, monkeypatch):
    factory, uid, state, cleanup, client = bot_weights
    await client.put("/v1/profile", json={"weight_kg": 80})
    analyzer = AsyncMock(side_effect=AssertionError("Manual weight replay must not use AI"))
    monkeypatch.setattr(food.ai_client, "analyze_text", analyzer)
    event = message("79", 223)
    async with factory() as session:
        await state.set_state(WeightTrackingStates.weight)
        await weight_handlers.save_measurement(event, state, session, cleanup)
        assert await state.get_state() is None
        await food.handle_food_text(event, state, session, cleanup)
        analyzer.assert_not_awaited()
        assert await session.scalar(select(func.count()).select_from(WeightHistory).where(WeightHistory.user_id == uid)) == 2
        assert await session.scalar(select(func.count()).select_from(DayEntry).where(DayEntry.user_id == uid)) == 0
    assert "Записал <b>79 кг</b>" in event.answer.call_args.args[0]
