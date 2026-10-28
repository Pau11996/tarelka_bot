import asyncio
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from aiogram.types import Message
from PIL import Image, ImageChops

from src.bot.handlers import sharing
from src.bot.services import share_cards
from src.bot.services.nutrition import calculate_daily_nutrient_targets
from src.bot.services.share_cards import DailyNorm, daily_norm_from_profile, render_daily_norm_png
from src.db.models import ActivityLevel, Goal, Profile, Sex


def profile(**changes):
    values = dict(user_id=77, weight_kg=75, height_cm=180, age=30, sex=Sex.MALE,
                  goal=Goal.MAINTAIN, activity_level=ActivityLevel.MODERATE, daily_calorie_target=2100)
    return Profile(**(values | changes))


def test_card_uses_the_same_targets_as_mobile_and_labels_starter_values():
    person = profile()
    targets = calculate_daily_nutrient_targets(person)
    norm = daily_norm_from_profile(person)
    assert norm.calories == person.daily_calorie_target
    assert norm.protein == int(targets.protein_g + .5)
    assert norm.fat == int(targets.fat_g + .5)
    assert norm.carbs == int(targets.carbs_g + .5)
    assert norm.title == "Моя дневная норма"
    starter = daily_norm_from_profile(profile(weight_kg=None, height_cm=None))
    assert starter.title == "Стартовый ориентир"
    # The server can legitimately produce a zero carbohydrate target.
    assert daily_norm_from_profile(profile(weight_kg=400, daily_calorie_target=1200)).carbs == 0


def test_rounding_matches_mobile_including_half_values(monkeypatch):
    monkeypatch.setattr(share_cards, "calculate_daily_nutrient_targets", lambda _: SimpleNamespace(protein_g=120.5, fat_g=60.5, carbs_g=269.5))
    assert daily_norm_from_profile(profile(daily_calorie_target=2100.5)).values == (2101, 121, 61, 270)


@pytest.mark.parametrize("norm", [DailyNorm(2100, 120, 60, 270, True), DailyNorm(2000, 125, 60, 240, False), DailyNorm(10000, 1000, 333, 1500, True)])
def test_png_is_compact_and_all_four_values_are_drawn_without_overflow(norm):
    content = render_daily_norm_png(norm)
    image = Image.open(BytesIO(content))
    assert image.format == "PNG"
    assert image.size == (1080, 216)
    assert len(content) < 1_000_000
    with Image.open(share_cards.ASSETS / "daily-norm-template.png") as template:
        difference = ImageChops.difference(image, template.convert("RGB"))
        # Only the title and target fields change; the cat and footer stay intact.
        assert difference.crop((0, 0, 355, 216)).getbbox() is None
        assert difference.crop((355, 170, 1080, 216)).getbbox() is None
        for x, right in [(390, 572), (594, 724), (746, 876), (898, 1046)]:
            assert difference.crop((x, 100, right, 160)).getbbox() is not None
            assert difference.crop((right, 100, right + 20, 160)).getbbox() is None


def test_download_snapshot_survives_profile_changes_and_stays_within_callback_limit():
    original = daily_norm_from_profile(profile())
    payload = original.download_callback()
    assert len(payload.encode()) <= 64
    assert DailyNorm.from_callback(payload) == original
    changed = daily_norm_from_profile(profile(daily_calorie_target=1800))
    assert DailyNorm.from_callback(payload) != changed
    assert len(DailyNorm(100000, 100000, 100000, 100000, False).download_callback().encode()) <= 64


@pytest.mark.parametrize("payload", ["share:norm:png:", "share:norm:png:0:120:60:270:1", "share:norm:png:2100:-1:60:270:1", "share:norm:png:2100:120:60:270:2", "share:norm:png:2100:120:60:270:1:1", "share:norm:png:100001:120:60:270:1", "share:norm:png:nan:120:60:270:1", "share:norm:png:" + "1" * 65])
def test_invalid_snapshots_are_rejected(payload):
    with pytest.raises(ValueError):
        DailyNorm.from_callback(payload)


@pytest.fixture
def export_context(monkeypatch):
    person = profile()
    repo = SimpleNamespace(get_or_create_user=AsyncMock(return_value=SimpleNamespace(id=77)), ensure_default_profile=AsyncMock(return_value=person))
    repository = MagicMock(return_value=repo)
    monkeypatch.setattr(sharing, "UserRepository", repository)
    message = MagicMock(spec=Message)
    message.chat = SimpleNamespace(id=123, type="private")
    message.message_id = 456
    message.answer_photo = AsyncMock()
    message.answer_document = AsyncMock()
    message.answer = AsyncMock(return_value=message)
    callback = SimpleNamespace(message=message, from_user=SimpleNamespace(id=123), answer=AsyncMock(), data="share:norm")
    return SimpleNamespace(callback=callback, message=message, repo=repo, repository=repository, cleanup=MagicMock(), person=person)


async def test_photo_is_persistent_and_has_a_download_for_its_exact_values(export_context):
    ctx = export_context
    await sharing.share_daily_norm(ctx.callback, None, ctx.cleanup)
    ctx.repo.get_or_create_user.assert_awaited_once_with(123, sharing.settings.default_timezone)
    ctx.repo.ensure_default_profile.assert_awaited_once_with(77)
    sent = ctx.message.answer_photo.await_args.kwargs
    norm = daily_norm_from_profile(ctx.person)
    assert sent["photo"].data == render_daily_norm_png(norm)
    assert norm.title in sent["caption"]
    assert sent["reply_markup"].inline_keyboard[0][0].callback_data == norm.download_callback()
    ctx.cleanup.schedule.assert_not_called()
    ctx.callback.answer.assert_awaited_once()


async def test_png_download_uses_snapshot_without_reading_current_profile(export_context):
    ctx = export_context
    norm = DailyNorm(2000, 125, 60, 240, False)
    ctx.callback.data = norm.download_callback()
    await sharing.download_daily_norm(ctx.callback, None, ctx.cleanup)
    ctx.repository.assert_not_called()
    sent = ctx.message.answer_document.await_args.kwargs
    assert sent["document"].filename.endswith(".png")
    assert sent["document"].data == render_daily_norm_png(norm)
    assert sent["disable_content_type_detection"] is True
    assert sent["caption"] == "Стартовый ориентир"
    ctx.cleanup.schedule.assert_not_called()


async def test_fast_double_click_does_not_send_two_cards(export_context, monkeypatch):
    ctx = export_context
    started, release = asyncio.Event(), asyncio.Event()

    async def render_thread(fn, norm):
        started.set()
        await release.wait()
        return fn(norm)

    monkeypatch.setattr(sharing.asyncio, "to_thread", render_thread)
    task = asyncio.create_task(sharing.share_daily_norm(ctx.callback, None, ctx.cleanup))
    await started.wait()
    await sharing.share_daily_norm(ctx.callback, None, ctx.cleanup)
    release.set()
    await task
    ctx.message.answer_photo.assert_awaited_once()
    ctx.repo.ensure_default_profile.assert_awaited_once()
    assert ctx.callback.answer.await_args.args == ("Карточка уже готовится…",)


async def test_failure_has_retry_and_does_not_lock_future_exports(export_context, monkeypatch):
    ctx = export_context
    render = MagicMock(side_effect=[OSError("Render failed"), render_daily_norm_png(DailyNorm(2100, 120, 60, 270, True))])
    monkeypatch.setattr(sharing, "render_daily_norm_png", render)
    await sharing.share_daily_norm(ctx.callback, None, ctx.cleanup)
    ctx.message.answer_photo.assert_not_awaited()
    error = ctx.message.answer.await_args
    assert "Попробуйте ещё раз" in error.args[0]
    assert error.kwargs["reply_markup"].inline_keyboard[0][0].callback_data == "share:norm"
    await sharing.share_daily_norm(ctx.callback, None, ctx.cleanup)
    ctx.message.answer_photo.assert_awaited_once()


@pytest.mark.parametrize("invalid_context", ["group", "foreign", "inaccessible"])
async def test_export_never_posts_personal_targets_to_a_group_or_foreign_chat(export_context, invalid_context):
    ctx = export_context
    if invalid_context == "group":
        ctx.message.chat.type = "group"
    elif invalid_context == "foreign":
        ctx.message.chat.id = 999
    else:
        ctx.callback.message = None
    await sharing.share_daily_norm(ctx.callback, None, ctx.cleanup)
    ctx.repository.assert_not_called()
    ctx.message.answer_photo.assert_not_awaited()
    assert ctx.callback.answer.await_args.kwargs["show_alert"] is True
