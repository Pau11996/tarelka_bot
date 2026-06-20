from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass
from datetime import date


Color = tuple[int, int, int]


@dataclass(frozen=True)
class DailyCaloriesPoint:
    day: date
    calories: float


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
