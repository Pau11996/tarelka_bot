import base64
from io import BytesIO
from unittest.mock import Mock

import pytest
from PIL import Image

from test_mobile_api import api, _login
from src.bot.services.share_cards import DailyNorm, render_daily_norm_png
from src.mobile_api import sharing

SNAPSHOT = dict(calories=2100, protein=120, fat=60, carbs=270, personalized=True)


async def test_share_card_is_the_exact_template_snapshot_without_consuming_requests(api):
    client, factory = api
    token, _ = await _login(client, factory, 76501)
    headers = {"Authorization": f"Bearer {token}"}
    before = (await client.get("/v1/subscription", headers=headers)).json()
    # The profile has changed since the snapshot was displayed.
    assert (await client.put("/v1/profile", headers=headers, json={"daily_calorie_target": 1800})).status_code == 200
    response = await client.post("/v1/share/daily-norm", headers=headers, json=SNAPSHOT)
    assert response.status_code == 200, response.text
    content = base64.b64decode(response.json()["image_base64"], validate=True)
    assert content == render_daily_norm_png(DailyNorm(**SNAPSHOT))
    image = Image.open(BytesIO(content))
    assert image.format == "PNG"
    assert image.size == (1080, 144)
    assert response.headers["cache-control"] == "no-store"
    after = (await client.get("/v1/subscription", headers=headers)).json()
    assert after["used"] == before["used"]
    assert after["bonus_requests"] == before["bonus_requests"]


async def test_share_card_requires_login(api, monkeypatch):
    client, _ = api
    renderer = Mock()
    monkeypatch.setattr(sharing, "render_daily_norm_png", renderer)
    response = await client.post("/v1/share/daily-norm", json=SNAPSHOT)
    assert response.status_code == 401
    renderer.assert_not_called()


@pytest.mark.parametrize("changes", [
    {"calories": 0}, {"calories": -1}, {"calories": 100001}, {"protein": -1},
    {"fat": "60"}, {"carbs": 1.5}, {"calories": True}, {"personalized": "true"}, {"user_id": 123},
])
async def test_invalid_share_values_are_rejected_before_rendering(api, monkeypatch, changes):
    client, factory = api
    token, _ = await _login(client, factory, 76502)
    renderer = Mock()
    monkeypatch.setattr(sharing, "render_daily_norm_png", renderer)
    response = await client.post("/v1/share/daily-norm", headers={"Authorization": f"Bearer {token}"}, json={**SNAPSHOT, **changes})
    assert response.status_code == 422
    renderer.assert_not_called()


async def test_render_failure_can_be_retried(api, monkeypatch):
    client, factory = api
    token, _ = await _login(client, factory, 76503)
    headers = {"Authorization": f"Bearer {token}"}
    png = render_daily_norm_png(DailyNorm(**SNAPSHOT))
    monkeypatch.setattr(sharing, "render_daily_norm_png", Mock(side_effect=[OSError("template unavailable"), png]))
    failed = await client.post("/v1/share/daily-norm", headers=headers, json=SNAPSHOT)
    assert failed.status_code == 503
    retried = await client.post("/v1/share/daily-norm", headers=headers, json=SNAPSHOT)
    assert base64.b64decode(retried.json()["image_base64"]) == png
