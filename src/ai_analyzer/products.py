from __future__ import annotations

import os
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path

BARCODE_UNREADABLE = "Не удалось прочитать штрихкод"
PRODUCT_NOT_FOUND = "Продукт с таким штрихкодом не найден"
PRODUCT_DB_UNAVAILABLE = "База продуктов недоступна"
LABEL_ASSUMPTION = "КБЖУ из базы продуктов, на всю упаковку."
ESTIMATE_ASSUMPTION = "В базе нет КБЖУ, значения оценены по названию и весу."

BARCODE_FAILURES = {BARCODE_UNREADABLE, PRODUCT_NOT_FOUND, PRODUCT_DB_UNAVAILABLE}

_DEFAULT_DB = "data/green_by_products.sqlite"
_NUMBER = r"(\d+(?:[.,]\d+)?)"


@dataclass(frozen=True)
class LabelNutrition:
    kcal: float
    protein_g: float
    fat_g: float
    carbs_g: float
    fiber_g: float
    basis_g: float


@dataclass(frozen=True)
class CatalogProduct:
    title: str
    brand: str
    weight_g: int | None
    volume: str
    energy_cost: str


def product_db_path() -> Path:
    return Path(os.environ.get("PRODUCT_DB_PATH", _DEFAULT_DB))


def barcode_digits(value: object) -> str:
    return "".join(character for character in str(value or "") if character.isdigit())


def ean_checksum_ok(code: str) -> bool:
    if len(code) not in {8, 13} or not code.isdigit():
        return False
    body, check = code[:-1], int(code[-1])
    total = 0
    for index, digit in enumerate(reversed(body)):
        total += int(digit) * (3 if index % 2 == 0 else 1)
    expected = (10 - (total % 10)) % 10
    return expected == check


def parse_energy_cost(text: str | None) -> LabelNutrition | None:
    if not text or not text.strip():
        return None
    normalized = text.replace("ё", "е").lower()
    kcal_match = re.search(rf"{_NUMBER}\s*ккал", normalized)
    if kcal_match is None:
        return None
    basis_match = re.search(rf"(?:в|на)\s*{_NUMBER}\s*г", normalized)
    basis_g = _as_float(basis_match.group(1)) if basis_match else 100.0
    if basis_g <= 0:
        basis_g = 100.0
    return LabelNutrition(
        kcal=_as_float(kcal_match.group(1)),
        protein_g=_macro(normalized, r"(?:на)?белк\w*"),
        fat_g=_macro(normalized, r"жир\w*"),
        carbs_g=_macro(normalized, r"(?:углевод\w*|улевод\w*)"),
        fiber_g=_macro(normalized, r"пищев\w*\s+волокон\w*|клетчатк\w*"),
        basis_g=basis_g,
    )


def package_grams(volume: str | None, weight_g: int | None) -> tuple[float, bool]:
    if volume:
        match = re.search(rf"{_NUMBER}\s*г", volume.lower().replace(" ", ""))
        if match:
            grams = _as_float(match.group(1))
            if grams > 0:
                return grams, False
    if weight_g and weight_g > 0:
        return float(weight_g), False
    return 100.0, True


def volume_ml(volume: str | None) -> float | None:
    if not volume:
        return None
    text = volume.lower().replace(" ", "").replace(",", ".")
    liters = re.search(r"(\d+(?:\.\d+)?)\s*л", text)
    if liters:
        ml = float(liters.group(1)) * 1000
        return ml if ml > 0 else None
    milliliters = re.search(r"(\d+(?:\.\d+)?)\s*мл", text)
    if milliliters:
        ml = float(milliliters.group(1))
        return ml if ml > 0 else None
    return None


def is_plain_water(title: str, label: LabelNutrition) -> bool:
    if label.kcal > 0 or label.protein_g > 0 or label.fat_g > 0 or label.carbs_g > 0:
        return False
    return re.search(r"(?<![а-я])вода(?![а-я])", title.lower()) is not None


def product_title(title: str | None, brand: str | None) -> str:
    name = (title or "").strip() or "Продукт"
    brand_name = (brand or "").strip()
    if brand_name and brand_name.lower() not in name.lower():
        return f"{brand_name} {name}"
    return name


def lookup_product(code: str, *, database: Path | None = None) -> CatalogProduct | None:
    path = database or product_db_path()
    if not path.is_file():
        raise FileNotFoundError(path)
    needle = f'"{code}"'
    uri = f"file:{path}?mode=ro"
    with sqlite3.connect(uri, uri=True) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            """
            SELECT title, brand, weight, volume, energy_cost
            FROM products
            WHERE gtin = ?
            LIMIT 1
            """,
            (code,),
        ).fetchone()
        if row is None:
            row = connection.execute(
                """
                SELECT title, brand, weight, volume, energy_cost
                FROM products
                WHERE instr(barcodes, ?) > 0
                LIMIT 1
                """,
                (needle,),
            ).fetchone()
        if row is None:
            row = connection.execute(
                """
                SELECT p.title, p.brand, p.weight, p.volume, p.energy_cost
                FROM chain_offers AS c
                JOIN products AS p ON p.id = c.product_id
                WHERE c.barcode = ?
                LIMIT 1
                """,
                (code,),
            ).fetchone()
    if row is None:
        return None
    return CatalogProduct(
        title=str(row["title"] or ""),
        brand=str(row["brand"] or ""),
        weight_g=int(row["weight"]) if row["weight"] else None,
        volume=str(row["volume"] or ""),
        energy_cost=str(row["energy_cost"] or ""),
    )


def _macro(text: str, name_pattern: str) -> float:
    match = re.search(rf"{name_pattern}\s*[-–—:]?\s*{_NUMBER}", text)
    if match is None:
        return 0.0
    return _as_float(match.group(1))


def _as_float(value: str) -> float:
    return float(value.replace(",", "."))
