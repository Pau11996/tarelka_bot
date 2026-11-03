from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import func, select

from test_mobile_experience import api, setup
from src.db.models import MobileMedia, MobileOperation, User
from src.mobile_api import experience, worker
from src.mobile_api.analysis import VOICE_NOT_RECOGNIZED, VOICE_UNAVAILABLE
from src.shared.schemas import AnalysisResult


def mock_voice(monkeypatch, transcript="Суп"):
    transcribe = AsyncMock(return_value=transcript)
    analyze = AsyncMock(return_value=(
        "{}", AnalysisResult(type="meal", title="Суп", total_calories=250),
    ))
    monkeypatch.setattr(experience.AIAnalyzerClient, "transcribe", transcribe)
    monkeypatch.setattr(experience.AIAnalyzerClient, "analyze_text", analyze)
    return transcribe, analyze


async def send_voice(client, headers, key="raw-voice-message", **data):
    response = await client.post(
        "/v1/operations", headers=headers,
        data={"request_key": key, **data},
        files={"audio": ("voice.m4a", b"recorded-audio", "audio/mp4")},
    )
    assert response.status_code == 202, response.text
    return response.json()


async def test_voice_is_in_chat_before_transcription_then_analyzed_once(setup, monkeypatch):
    client, factory, headers, uid = setup
    transcribe, analyze = mock_voice(monkeypatch, "  Суп  ")
    op = await send_voice(client, headers)
    assert op["status"] == "queued" and op["text"] == ""
    transcribe.assert_not_awaited()
    analyze.assert_not_awaited()
    history = (await client.get("/v1/chat", headers=headers)).json()
    assert history["operations"][0]["id"] == op["id"]
    audio = history["media"][0]
    assert audio["mime"] == "audio/mp4"
    assert (await client.get(audio["url"], headers=headers)).content == b"recorded-audio"
    assert (await client.get(audio["url"])).status_code == 401
    assert (await send_voice(client, headers))["id"] == op["id"]
    assert len(list((experience.MEDIA_ROOT / str(uid)).glob("*"))) == 1
    assert await worker.process_one()
    done = (await client.get(f"/v1/operations/{op['id']}", headers=headers)).json()
    assert done["status"] == "done" and done["result"]["status"] == "saved"
    assert done["text"] == done["result"]["transcript"] == "Суп"
    assert done["result"]["entry"]["calories"] == 250
    transcribe.assert_awaited_once()
    assert transcribe.call_args.kwargs["audio_bytes"] == b"recorded-audio"
    analyze.assert_awaited_once()
    assert analyze.call_args.kwargs["text"] == "Суп"
    usage = (await client.get("/v1/subscription", headers=headers)).json()["used"]
    assert usage["voice"] == 1 and usage["text"] == 0
    assert (await send_voice(client, headers))["status"] == "done"
    assert not await worker.process_one()
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(MobileOperation)) == 1
        media = await session.get(MobileMedia, audio["id"])
        assert media.transcript == "Суп"


@pytest.mark.parametrize("failure", ["empty", "silence", "http400"])
async def test_unrecognized_voice_is_persistent_unknown_with_zero_calories(setup, monkeypatch, failure):
    client, _, headers, _ = setup
    transcribe, analyze = mock_voice(monkeypatch, "" if failure == "empty" else " \n ")
    if failure == "http400":
        transcribe.side_effect = httpx.HTTPStatusError(
            "No speech", request=httpx.Request("POST", "http://analyzer/transcribe"),
            response=httpx.Response(400),
        )
    op = await send_voice(client, headers)
    assert await worker.process_one()
    history = (await client.get("/v1/chat", headers=headers)).json()
    done = next(row for row in history["operations"] if row["id"] == op["id"])
    assert done["status"] == "done"
    assert done["result"]["status"] == "unknown"
    assert done["result"]["message"] == VOICE_NOT_RECOGNIZED
    assert done["result"]["result"]["total_calories"] == 0
    assert not history["entries"]
    assert len(history["media"]) == 1
    analyze.assert_not_awaited()
    assert (await client.get("/v1/subscription", headers=headers)).json()["used"]["voice"] == 0
    assert (await client.delete(f"/v1/operations/{op['id']}", headers=headers)).status_code == 204
    assert (await client.get(f"/v1/operations/{op['id']}", headers=headers)).json()["dismissed"]


async def test_recognized_but_irrelevant_voice_keeps_transcript_and_unknown_card(setup, monkeypatch):
    client, _, headers, _ = setup
    _, analyze = mock_voice(monkeypatch, "Сегодня прекрасная погода")
    analyze.return_value = ("{}", AnalysisResult(type="unknown"))
    op = await send_voice(client, headers)
    await worker.process_one()
    done = (await client.get(f"/v1/operations/{op['id']}", headers=headers)).json()
    assert done["status"] == "done" and done["result"]["status"] == "unknown"
    assert done["text"] == "Сегодня прекрасная погода"
    assert done["result"]["result"]["total_calories"] == 0
    assert not (await client.get("/v1/chat", headers=headers)).json()["entries"]
    assert (await client.get("/v1/subscription", headers=headers)).json()["used"]["voice"] == 0


@pytest.mark.parametrize("failure", ["network", "service"])
async def test_transcription_outage_is_retryable_without_losing_audio_or_quota(setup, monkeypatch, failure):
    client, _, headers, _ = setup
    transcribe, analyze = mock_voice(monkeypatch)
    transcribe.side_effect = httpx.ConnectError("Unavailable") if failure == "network" else httpx.HTTPStatusError(
        "Unavailable", request=httpx.Request("POST", "http://analyzer/transcribe"),
        response=httpx.Response(503),
    )
    op = await send_voice(client, headers)
    await worker.process_one()
    failed = (await client.get(f"/v1/operations/{op['id']}", headers=headers)).json()
    assert failed["status"] == "failed" and failed["error"] == VOICE_UNAVAILABLE
    analyze.assert_not_awaited()
    assert (await client.get("/v1/subscription", headers=headers)).json()["used"]["voice"] == 0
    transcribe.side_effect = None
    await client.post(f"/v1/operations/{op['id']}/retry", headers=headers)
    await worker.process_one()
    history = (await client.get("/v1/chat", headers=headers)).json()
    assert len(history["entries"]) == len(history["operations"]) == len(history["media"]) == 1
    assert history["operations"][0]["status"] == "done"
    assert (await client.get("/v1/subscription", headers=headers)).json()["used"]["voice"] == 1


async def test_legacy_prepaid_voice_still_analyzes_without_second_transcription_or_charge(setup, monkeypatch):
    client, _, headers, _ = setup
    transcribe, analyze = mock_voice(monkeypatch)
    draft = (await client.post("/v1/voice/transcribe", headers=headers,
        files={"audio": ("voice.m4a", b"audio", "audio/mp4")},
    )).json()
    response = await client.post("/v1/operations", headers=headers, data={
        "request_key": "legacy-voice-message", "voice_id": draft["media_id"], "text": "Суп с хлебом",
    })
    assert response.status_code == 202
    await worker.process_one()
    transcribe.assert_awaited_once()
    assert analyze.call_args.kwargs["text"] == "Суп с хлебом"
    usage = (await client.get("/v1/subscription", headers=headers)).json()["used"]
    assert usage["voice"] == 1 and usage["text"] == 0


async def test_raw_voice_limit_is_reported_in_the_chat_before_recognition(setup, monkeypatch):
    client, factory, headers, uid = setup
    transcribe, analyze = mock_voice(monkeypatch)
    async with factory() as session:
        user = await session.get(User, uid)
        user.daily_request_limit = 0
        await session.commit()
    op = await send_voice(client, headers)
    await worker.process_one()
    failed = (await client.get(f"/v1/operations/{op['id']}", headers=headers)).json()
    assert failed["status"] == "failed"
    assert failed["limit_reached"]["kind"] == "voice"
    transcribe.assert_not_awaited()
    analyze.assert_not_awaited()


@pytest.mark.parametrize("case,expected", [("photo", 422), ("legacy_voice", 422), ("mime", 415), ("empty", 413)])
async def test_invalid_audio_submission_does_not_create_job_or_files(setup, case, expected):
    client, factory, headers, uid = setup
    data = {"request_key": "invalid-voice-message"}
    files = {"audio": ("voice.m4a", b"audio", "audio/mp4")}
    if case == "photo":
        files["image"] = ("food.jpg", b"image", "image/jpeg")
    elif case == "legacy_voice":
        data["voice_id"] = "old-voice"
    elif case == "mime":
        files["audio"] = ("photo.jpg", b"image", "image/jpeg")
    else:
        files["audio"] = ("voice.m4a", b"", "audio/mp4")
    response = await client.post("/v1/operations", headers=headers, data=data, files=files)
    assert response.status_code == expected
    assert not list((experience.MEDIA_ROOT / str(uid)).glob("*"))
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(MobileOperation)) == 0
        assert await session.scalar(select(func.count()).select_from(MobileMedia)) == 0
