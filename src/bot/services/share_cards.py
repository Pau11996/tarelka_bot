"""Local PNG exports of the approved D6 daily norm card."""
from __future__ import annotations

import math
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from src.bot.services.nutrition import calculate_daily_nutrient_targets
from src.db.models import Profile

ASSETS = Path(__file__).resolve().parents[1] / "assets" / "share"
DOWNLOAD_PREFIX = "share:norm:png:"
INK = "#274d35"


@dataclass(frozen=True)
class DailyNorm:
    calories: int
    protein: int
    fat: int
    carbs: int
    personalized: bool

    def __post_init__(self) -> None:
        if any(type(value) is not int or not 0 <= value <= 100_000 for value in self.values):
            raise ValueError("Invalid nutrient target")
        if self.calories == 0 or type(self.personalized) is not bool:
            raise ValueError("Invalid daily norm")

    @property
    def values(self) -> tuple[int, int, int, int]:
        return self.calories, self.protein, self.fat, self.carbs

    @property
    def title(self) -> str:
        return "Моя дневная норма" if self.personalized else "Стартовый ориентир"

    def download_callback(self) -> str:
        # Snapshot of the already visible values: a later profile edit must not
        # change the PNG requested underneath an older card. Fits Telegram's 64 bytes.
        return DOWNLOAD_PREFIX + ":".join(map(str, (*self.values, int(self.personalized))))

    @classmethod
    def from_callback(cls, data: str) -> DailyNorm:
        if not data.startswith(DOWNLOAD_PREFIX) or len(data.encode()) > 64:
            raise ValueError("Invalid export callback")
        fields = data[len(DOWNLOAD_PREFIX):].split(":")
        if len(fields) != 5 or fields[-1] not in {"0", "1"}:
            raise ValueError("Invalid export callback")
        if any(not value.isascii() or not value.isdigit() for value in fields):
            raise ValueError("Invalid export callback")
        return cls(*(int(value) for value in fields[:4]), personalized=fields[-1] == "1")


def daily_norm_from_profile(profile: Profile) -> DailyNorm:
    targets = calculate_daily_nutrient_targets(profile)
    values = (profile.daily_calorie_target, targets.protein_g, targets.fat_g, targets.carbs_g)
    if any(not math.isfinite(value) or value < 0 for value in values):
        raise ValueError("Invalid daily targets")
    # Match Math.round in the mobile share card, including .5 values.
    return DailyNorm(*(math.floor(value + 0.5) for value in values), personalized=profile.is_complete())


def _tracked_width(text: str, font: ImageFont.FreeTypeFont, spacing: int = -2) -> float:
    return sum(font.getlength(char) for char in text) + spacing * (len(text) - 1)


def _draw_value(draw: ImageDraw.ImageDraw, x: int, value: int, unit: str, column_width: int, index: int) -> None:
    text = f"{value:,}".replace(",", " ")
    units = ImageFont.truetype(str(ASSETS / "LiberationSans-Regular.ttf"), 14)
    size = 38 if len(str(value)) > (4 if index == 0 else 3) else 48
    while True:
        font = ImageFont.truetype(str(ASSETS / "LiberationSans-Bold.ttf"), size)
        if _tracked_width(text, font) + 4 + units.getlength(unit) <= column_width or size <= 16:
            break
        size -= 2
    cursor = float(x)
    for char in text:
        draw.text((cursor, 152), char, font=font, fill=INK, anchor="ls")
        cursor += font.getlength(char) - 2
    draw.text((cursor + 6, 152), unit, font=units, fill=INK, anchor="ls")


def render_daily_norm_png(norm: DailyNorm) -> bytes:
    with Image.open(ASSETS / "daily-norm-template.png") as template:
        image = template.convert("RGB")
    draw = ImageDraw.Draw(image)
    heading = ImageFont.truetype(str(ASSETS / "LiberationSans-Bold.ttf"), 22)
    draw.text((390, 46), norm.title, fill=INK, font=heading, anchor="ls")
    for index, (x, width, value) in enumerate(zip((390, 594, 746, 898), (182, 130, 130, 148), norm.values)):
        _draw_value(draw, x, value, "ккал" if index == 0 else "г", width, index)
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()
