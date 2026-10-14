from __future__ import annotations

import json
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
# Culinary counter in the Green catalog: ready meals, not packaged groceries.
READY_MADE_CATEGORY_ROOTS = (
    397,  # Готовая еда
    908,  # Осталось только разогреть
    1831,  # Готовые пиццы
    1876,  # Готовые изделия
)
READY_MADE_BRANDS = frozenset(
    {
        "green kitchen",
        "готовим с любовью",
        "food&go",
        "петруха готово",
    }
)
_READY_MADE_TITLE_MARKERS = (
    "изделие кулинарное",
    "изделия кулинарные",
)


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
    image_url: str | None = None


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


def normalize_retail_barcode(value: object) -> str | None:
    digits = barcode_digits(value)
    if ean_checksum_ok(digits):
        return digits
    # UPC-A is an EAN-13 with a leading zero.
    if len(digits) == 12 and ean_checksum_ok(f"0{digits}"):
        return f"0{digits}"
    return None


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


def readonly_sqlite_uri(path: Path) -> str:
    # The catalog is WAL. mode=ro still tries to create a -shm file, which fails
    # when Docker mounts ./data read-only. immutable=1 reads the main file only.
    return f"{path.resolve().as_uri()}?mode=ro&immutable=1"


def lookup_product(code: str, *, database: Path | None = None) -> CatalogProduct | None:
    path = database or product_db_path()
    if not path.is_file():
        raise FileNotFoundError(path)
    needle = f'"{code}"'
    uri = readonly_sqlite_uri(path)
    with sqlite3.connect(uri, uri=True) as connection:
        connection.row_factory = sqlite3.Row
        columns = {row[1] for row in connection.execute("PRAGMA table_info(products)")}
        ready_ids = ready_made_category_ids(connection) if "category_ids" in columns else frozenset()
        selected = _product_select_list(columns)
        row = connection.execute(
            f"""
            SELECT {selected}
            FROM products
            WHERE gtin = ?
            LIMIT 1
            """,
            (code,),
        ).fetchone()
        if row is None:
            row = connection.execute(
                f"""
                SELECT {selected}
                FROM products
                WHERE instr(barcodes, ?) > 0
                LIMIT 1
                """,
                (needle,),
            ).fetchone()
        if row is None:
            aliased = _product_select_list(columns, alias="p")
            row = connection.execute(
                f"""
                SELECT {aliased}
                FROM chain_offers AS c
                JOIN products AS p ON p.id = c.product_id
                WHERE c.barcode = ?
                LIMIT 1
                """,
                (code,),
            ).fetchone()
        if row is None or is_ready_made_catalog_item(
            title=row["title"],
            brand=row["brand"],
            category_ids=row["category_ids"] if "category_ids" in row.keys() else None,
            ready_ids=ready_ids,
        ):
            return None
        return CatalogProduct(
            title=str(row["title"] or ""),
            brand=str(row["brand"] or ""),
            weight_g=int(row["weight"]) if row["weight"] else None,
            volume=str(row["volume"] or ""),
            energy_cost=str(row["energy_cost"] or ""),
            image_url=_product_image_url(connection, int(row["id"]), code),
        )


def ready_made_category_ids(connection: sqlite3.Connection) -> frozenset[int]:
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "categories" not in tables:
        return frozenset()
    placeholders = ",".join("?" * len(READY_MADE_CATEGORY_ROOTS))
    rows = connection.execute(
        f"""
        WITH RECURSIVE tree(id) AS (
            SELECT id FROM categories WHERE id IN ({placeholders})
            UNION
            SELECT child.id
            FROM categories AS child
            JOIN tree ON child.parent_id = tree.id
        )
        SELECT id FROM tree
        """,
        READY_MADE_CATEGORY_ROOTS,
    ).fetchall()
    return frozenset(int(row[0]) for row in rows)


def is_ready_made_catalog_item(
    *,
    title: str | None,
    brand: str | None,
    category_ids: str | None,
    ready_ids: frozenset[int],
) -> bool:
    brand_key = (brand or "").casefold().replace("ё", "е").strip(" !.")
    if brand_key in READY_MADE_BRANDS:
        return True
    title_key = (title or "").casefold().replace("ё", "е")
    if any(marker in title_key for marker in _READY_MADE_TITLE_MARKERS):
        return True
    return is_ready_made_product(category_ids, ready_ids)


def is_ready_made_product(category_ids: str | None, ready_ids: frozenset[int]) -> bool:
    if not ready_ids or not category_ids or category_ids in {"", "[]"}:
        return False
    try:
        values = json.loads(category_ids)
    except json.JSONDecodeError:
        return False
    if isinstance(values, int):
        values = [values]
    return any(int(value) in ready_ids for value in values)


def _product_select_list(columns: set[str], alias: str = "") -> str:
    names = ["id", "title", "brand", "weight", "volume", "energy_cost"]
    if "category_ids" in columns:
        names.append("category_ids")
    prefix = f"{alias}." if alias else ""
    return ", ".join(f"{prefix}{name}" for name in names)


def _product_image_url(connection: sqlite3.Connection, product_id: int, code: str) -> str | None:
    row = connection.execute(
        """
        SELECT image_url
        FROM chain_offers
        WHERE product_id = ?
          AND image_url IS NOT NULL
          AND image_url != ''
        ORDER BY
          CASE WHEN instr(image_url, ?) > 0 THEN 0 ELSE 1 END,
          CASE
            WHEN lower(image_url) LIKE '%.jpg%'
              OR lower(image_url) LIKE '%.jpeg%'
              OR lower(image_url) LIKE '%.png%'
            THEN 0 ELSE 1
          END
        LIMIT 1
        """,
        (product_id, code),
    ).fetchone()
    if row is None:
        return None
    url = str(row["image_url"]).strip()
    if url.startswith("https://") or url.startswith("http://"):
        return url
    return None


def _macro(text: str, name_pattern: str) -> float:
    match = re.search(rf"(?:{name_pattern})\s*[-–—:]?\s*{_NUMBER}", text)
    if match is None:
        return 0.0
    return _as_float(match.group(1))


def _as_float(value: str) -> float:
    return float(value.replace(",", "."))
