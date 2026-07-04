from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass
from datetime import date, datetime


Color = tuple[int, int, int]

_FONT: dict[str, tuple[str, ...]] = {
    "0": ("111", "101", "101", "101", "111"),
    "1": ("010", "110", "010", "010", "111"),
    "2": ("111", "001", "111", "100", "111"),
    "3": ("111", "001", "111", "001", "111"),
    "4": ("101", "101", "111", "001", "001"),
    "5": ("111", "100", "111", "001", "111"),
    "6": ("111", "100", "111", "101", "111"),
    "7": ("111", "001", "010", "010", "010"),
    "8": ("111", "101", "111", "101", "111"),
    "9": ("111", "101", "111", "001", "111"),
    ".": ("0", "0", "0", "0", "1"),
    "-": ("000", "000", "111", "000", "000"),
    "g": ("000", "111", "101", "111", "001"),
    "k": ("101", "110", "100", "110", "101"),
}


@dataclass(frozen=True)
class DailyCaloriesPoint:
    day: date
    calories: float


@dataclass(frozen=True)
class WeightPoint:
    recorded_at: datetime
    weight_kg: float


def _chunk(kind: bytes, data: bytes) -> bytes:
    checksum = zlib.crc32(kind + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", checksum)


def _set_pixel(pixels: bytearray, width: int, x: int, y: int, color: Color) -> None:
    if x < 0 or y < 0 or x >= width:
        return
    index = (y * width + x) * 3
    if index < 0 or index + 2 >= len(pixels):
        return
    pixels[index : index + 3] = bytes(color)


def _draw_rect(
    pixels: bytearray,
    width: int,
    height: int,
    left: int,
    top: int,
    right: int,
    bottom: int,
    color: Color,
) -> None:
    left = max(0, left)
    top = max(0, top)
    right = min(width - 1, right)
    bottom = min(height - 1, bottom)
    for y in range(top, bottom + 1):
        row_start = (y * width + left) * 3
        row_end = (y * width + right + 1) * 3
        pixels[row_start:row_end] = bytes(color) * (right - left + 1)


def _text_width(text: str, *, scale: int = 2, spacing: int = 1) -> int:
    width = 0
    for char in text:
        if char == " ":
            char_width = 2
        else:
            glyph = _FONT.get(char)
            char_width = len(glyph[0]) if glyph else 0
        if char_width:
            width += char_width * scale + spacing
    return max(0, width - spacing)


def _draw_text(
    pixels: bytearray,
    width: int,
    height: int,
    x: int,
    y: int,
    text: str,
    color: Color,
    *,
    scale: int = 2,
    spacing: int = 1,
) -> None:
    cursor_x = x
    for char in text:
        if char == " ":
            cursor_x += 2 * scale + spacing
            continue
        glyph = _FONT.get(char)
        if glyph is None:
            continue
        for row_index, row in enumerate(glyph):
            for col_index, value in enumerate(row):
                if value == "1":
                    _draw_rect(
                        pixels,
                        width,
                        height,
                        cursor_x + col_index * scale,
                        y + row_index * scale,
                        cursor_x + (col_index + 1) * scale - 1,
                        y + (row_index + 1) * scale - 1,
                        color,
                    )
        cursor_x += len(glyph[0]) * scale + spacing


def _draw_line(
    pixels: bytearray,
    width: int,
    height: int,
    x1: int,
    y1: int,
    x2: int,
    y2: int,
    color: Color,
) -> None:
    dx = abs(x2 - x1)
    dy = -abs(y2 - y1)
    sx = 1 if x1 < x2 else -1
    sy = 1 if y1 < y2 else -1
    error = dx + dy
    while True:
        if 0 <= y1 < height:
            _set_pixel(pixels, width, x1, y1, color)
        if x1 == x2 and y1 == y2:
            break
        doubled = 2 * error
        if doubled >= dy:
            error += dy
            x1 += sx
        if doubled <= dx:
            error += dx
            y1 += sy


def render_calories_chart_png(points: list[DailyCaloriesPoint], *, target: float | None = None) -> bytes:
    width = 900
    height = 520
    margin_left = 58
    margin_right = 24
    margin_top = 36
    margin_bottom = 58
    plot_width = width - margin_left - margin_right
    plot_height = height - margin_top - margin_bottom

    background = (255, 255, 255)
    axis = (52, 64, 84)
    grid = (226, 232, 240)
    bar = (72, 139, 255)
    target_color = (240, 112, 80)

    pixels = bytearray(background * width * height)

    for i in range(6):
        y = margin_top + round(plot_height * i / 5)
        _draw_line(pixels, width, height, margin_left, y, width - margin_right, y, grid)

    _draw_line(pixels, width, height, margin_left, margin_top, margin_left, height - margin_bottom, axis)
    _draw_line(
        pixels,
        width,
        height,
        margin_left,
        height - margin_bottom,
        width - margin_right,
        height - margin_bottom,
        axis,
    )

    max_value = max([point.calories for point in points] + ([target] if target else []) + [1])
    max_value *= 1.12
    count = max(1, len(points))
    slot = plot_width / count
    bar_width = max(6, round(slot * 0.62))
    baseline = height - margin_bottom

    if target and target > 0:
        target_y = baseline - round((target / max_value) * plot_height)
        for offset in range(2):
            _draw_line(
                pixels,
                width,
                height,
                margin_left,
                target_y + offset,
                width - margin_right,
                target_y + offset,
                target_color,
            )

    for index, point in enumerate(points):
        value_height = round((point.calories / max_value) * plot_height)
        x_center = margin_left + round(slot * index + slot / 2)
        left = x_center - bar_width // 2
        right = x_center + bar_width // 2
        _draw_rect(pixels, width, height, left, baseline - value_height, right, baseline - 1, bar)

    raw_rows = bytearray()
    row_size = width * 3
    for y in range(height):
        raw_rows.append(0)
        raw_rows.extend(pixels[y * row_size : (y + 1) * row_size])

    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + _chunk(b"IDAT", zlib.compress(bytes(raw_rows), level=9))
        + _chunk(b"IEND", b"")
    )


def render_weight_chart_png(points: list[WeightPoint]) -> bytes:
    width = 900
    height = 520
    margin_left = 58
    margin_right = 32
    margin_top = 54
    margin_bottom = 74
    plot_width = width - margin_left - margin_right
    plot_height = height - margin_top - margin_bottom

    background = (255, 255, 255)
    axis = (52, 64, 84)
    grid = (226, 232, 240)
    line_color = (46, 160, 120)
    point_color = (34, 120, 90)
    label_color = (52, 64, 84)

    pixels = bytearray(background * width * height)

    for i in range(6):
        y = margin_top + round(plot_height * i / 5)
        _draw_line(pixels, width, height, margin_left, y, width - margin_right, y, grid)

    _draw_line(pixels, width, height, margin_left, margin_top, margin_left, height - margin_bottom, axis)
    _draw_line(
        pixels,
        width,
        height,
        margin_left,
        height - margin_bottom,
        width - margin_right,
        height - margin_bottom,
        axis,
    )

    if not points:
        raw_rows = bytearray()
        row_size = width * 3
        for y in range(height):
            raw_rows.append(0)
            raw_rows.extend(pixels[y * row_size : (y + 1) * row_size])
        return (
            b"\x89PNG\r\n\x1a\n"
            + _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + _chunk(b"IDAT", zlib.compress(bytes(raw_rows), level=9))
            + _chunk(b"IEND", b"")
        )

    min_weight = min(point.weight_kg for point in points)
    max_weight = max(point.weight_kg for point in points)
    if min_weight == max_weight:
        padding = max(1.0, min_weight * 0.05)
        min_weight -= padding
        max_weight += padding
    else:
        padding = (max_weight - min_weight) * 0.12
        min_weight -= padding
        max_weight += padding

    weight_range = max(max_weight - min_weight, 0.1)
    count = len(points)
    baseline = height - margin_bottom

    def _x_for_index(index: int) -> int:
        if count == 1:
            return margin_left + plot_width // 2
        return margin_left + round(plot_width * index / (count - 1))

    def _y_for_weight(weight_kg: float) -> int:
        ratio = (weight_kg - min_weight) / weight_range
        return baseline - round(ratio * plot_height)

    for index in range(1, count):
        x1 = _x_for_index(index - 1)
        y1 = _y_for_weight(points[index - 1].weight_kg)
        x2 = _x_for_index(index)
        y2 = _y_for_weight(points[index].weight_kg)
        _draw_line(pixels, width, height, x1, y1, x2, y2, line_color)

    for index, point in enumerate(points):
        x_center = _x_for_index(index)
        y_center = _y_for_weight(point.weight_kg)
        _draw_rect(pixels, width, height, x_center - 4, y_center - 4, x_center + 4, y_center + 4, point_color)
        weight_label = f"{point.weight_kg:g} kg"
        weight_x = max(margin_left, min(width - margin_right - _text_width(weight_label), x_center - _text_width(weight_label) // 2))
        weight_y = max(8, y_center - 22)
        _draw_text(pixels, width, height, weight_x, weight_y, weight_label, label_color)

        date_label = point.recorded_at.strftime("%d.%m")
        date_x = max(margin_left, min(width - margin_right - _text_width(date_label), x_center - _text_width(date_label) // 2))
        _draw_text(pixels, width, height, date_x, baseline + 14, date_label, label_color)

    raw_rows = bytearray()
    row_size = width * 3
    for y in range(height):
        raw_rows.append(0)
        raw_rows.extend(pixels[y * row_size : (y + 1) * row_size])

    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + _chunk(b"IDAT", zlib.compress(bytes(raw_rows), level=9))
        + _chunk(b"IEND", b"")
    )
