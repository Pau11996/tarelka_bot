"""Pick healthy packaged products that match what the user ate this week."""

from __future__ import annotations

import json
import os
import random
import re
import sqlite3
from dataclasses import dataclass
from html import escape
from pathlib import Path

from src.ai_analyzer.products import (
    is_ready_made_catalog_item,
    parse_energy_cost,
    readonly_sqlite_uri,
    ready_made_category_ids,
)
from src.bot.config import PROJECT_ROOT
from src.db.models import DayEntry, EntryType

PP_CARD_LIMIT = 5
PP_CAPTION_LIMIT = 1024
_NETWORK_NAMES = {
    "gippo": "Гиппо",
    "green": "Green",
    "euroopt": "Евроопт",
    "santa": "Санта",
}


def catalog_db_path() -> Path:
    configured = os.environ.get("PRODUCT_DB_PATH", "").strip()
    if not configured:
        return PROJECT_ROOT / "data" / "green_by_products.sqlite"
    path = Path(configured)
    if path.is_absolute():
        return path
    return PROJECT_ROOT / path
FALLBACK_NOTE = (
    "По записям за неделю точного вкуса не нашлось. "
    "Вот базовый набор полезных продуктов."
)
CATALOG_UNAVAILABLE = "Каталог продуктов сейчас недоступен."

# Stem is already normalized: lower case, ё -> е.
BUCKETS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("dairy", ("творог", "кефир", "молок", "йогурт", "сыр")),
    ("grains", ("гречк", "гречне", "овсян", "каша", "рис", "макарон")),
    ("poultry", ("куриц", "индей", "грудк")),
    ("meat", ("говяд", "свинин", "фарш")),
    ("fish", ("рыб", "лосос", "тунец", "кревет", "семг", "форел")),
    ("veg", ("овощ", "салат", "огур", "помидор", "капуст", "брокколи")),
    ("fruit", ("яблок", "банан", "ягод")),
    ("nuts", ("орех", "миндал", "кешью")),
    ("eggs", ("яйцо", "яйца", "яичн")),
)
STAPLE_STEMS: tuple[tuple[str, ...], ...] = (
    ("гречк", "гречне"),
    ("творог",),
    ("грудк",),
    ("брокколи",),
    ("яйцо", "яйца", "яичн"),
)

_catalog_cache: tuple[float, PpCatalog] | None = None


@dataclass(frozen=True)
class PpProduct:
    product_id: int
    title: str
    brand: str
    image_url: str
    title_norm: str


@dataclass(frozen=True)
class PpProductCard:
    product_id: int
    title: str
    brand: str
    barcode: str
    volume: str
    weight_g: int | None
    energy_cost: str
    description: str
    producer: str
    country: str
    categories: str
    networks: str
    image_url: str


@dataclass(frozen=True)
class PpCatalog:
    by_bucket: dict[str, tuple[PpProduct, ...]]

    def is_empty(self) -> bool:
        return not any(self.by_bucket.values())


def normalize_food_text(text: str) -> str:
    return text.lower().replace("ё", "е")


def meal_phrases(entries: list[DayEntry]) -> list[str]:
    phrases: list[str] = []
    for entry in entries:
        if entry.entry_type != EntryType.MEAL:
            continue
        if entry.title:
            phrases.append(entry.title)
        for item in entry.items or []:
            if not isinstance(item, dict):
                continue
            name = item.get("name")
            if isinstance(name, str) and name.strip():
                phrases.append(name)
    return phrases


def card_caption(product: PpProduct) -> str:
    brand = product.brand.strip()
    if brand and brand.casefold() not in product.title.casefold():
        return f"{product.title}\n{brand}"
    return product.title


def load_pp_product_card(product_id: int, *, image_url: str = "") -> PpProductCard | None:
    path = catalog_db_path()
    if not path.is_file():
        return None
    connection = sqlite3.connect(readonly_sqlite_uri(path), uri=True)
    try:
        connection.row_factory = sqlite3.Row
        product = connection.execute(
            """
            SELECT id, title, brand, gtin, barcodes, volume, weight, energy_cost,
                   description, producer, producing_country, category_ids, networks
            FROM products
            WHERE id = ?
            """,
            (product_id,),
        ).fetchone()
        if product is None or not product["title"]:
            return None
        if not image_url:
            offer = connection.execute(
                """
                SELECT image_url
                FROM chain_offers
                WHERE product_id = ?
                  AND image_url IS NOT NULL
                  AND image_url != ''
                LIMIT 1
                """,
                (product_id,),
            ).fetchone()
            image_url = str(offer["image_url"]) if offer else ""
        return PpProductCard(
            product_id=int(product["id"]),
            title=str(product["title"]),
            brand=str(product["brand"] or ""),
            barcode=_barcode(product["gtin"], product["barcodes"]),
            volume=str(product["volume"] or ""),
            weight_g=int(product["weight"]) if product["weight"] else None,
            energy_cost=str(product["energy_cost"] or ""),
            description=str(product["description"] or ""),
            producer=str(product["producer"] or ""),
            country=str(product["producing_country"] or ""),
            categories=_category_titles(connection, product["category_ids"]),
            networks=_network_names(product["networks"]),
            image_url=image_url,
        )
    finally:
        connection.close()


def format_pp_card(card: PpProductCard) -> str:
    description = " ".join(card.description.split())
    text = _pp_card_text(card, description)
    while len(text) > PP_CAPTION_LIMIT and len(description) > 80:
        description = description[: max(80, len(description) - 160)].rstrip() + "…"
        text = _pp_card_text(card, description)
    if len(text) > PP_CAPTION_LIMIT:
        text = text[: PP_CAPTION_LIMIT - 1].rstrip() + "…"
    return text


def catalog_favorite_nutrition(card: PpProductCard) -> dict:
    """Same КБЖУ as on the card, so a favorite matches the shown label."""
    label = parse_energy_cost(card.energy_cost)
    if label is None:
        return {
            "calories": 0.0,
            "protein_g": 0.0,
            "fat_g": 0.0,
            "carbs_g": 0.0,
            "micronutrients": None,
            "items": None,
        }
    quantity = f"{label.basis_g:.0f} г"
    return {
        "calories": round(label.kcal, 1),
        "protein_g": round(label.protein_g, 1),
        "fat_g": round(label.fat_g, 1),
        "carbs_g": round(label.carbs_g, 1),
        "micronutrients": {"fiber_g": round(label.fiber_g, 1), "sugar_g": 0.0},
        "items": [
            {
                "name": card.title,
                "quantity": quantity,
                "calories": round(label.kcal, 1),
                "protein_g": round(label.protein_g, 1),
                "fat_g": round(label.fat_g, 1),
                "carbs_g": round(label.carbs_g, 1),
            }
        ],
    }


def _pp_card_text(card: PpProductCard, description: str) -> str:
    lines = [f"Название: {escape(card.title)}"]
    if card.brand.strip():
        lines.append(f"Бренд: {escape(card.brand.strip())}")
    if card.barcode:
        lines.append(f"Штрихкод: {escape(card.barcode)}")
    pack = _pack_line(card.volume, card.weight_g)
    if pack:
        lines.append(f"Фасовка: {escape(pack)}")
    nutrition = _nutrition_line(card.energy_cost)
    if nutrition:
        lines.append(f"КБЖУ: {escape(nutrition)}")
    if description:
        lines.append(f"Состав: {escape(description)}")
    producer = _producer_line(card.producer, card.country)
    if producer:
        lines.append(f"Производитель: {escape(producer)}")
    if card.categories:
        lines.append(f"Категория: {escape(card.categories)}")
    if card.networks:
        lines.append(f"Сети: {escape(card.networks)}")
    return "\n".join(lines)


def _pack_line(volume: str, weight_g: int | None) -> str:
    parts: list[str] = []
    text = volume.strip()
    if text:
        parts.append(_space_unit(text))
    if weight_g:
        parts.append(f"вес {weight_g} г")
    return ", ".join(parts)


def _space_unit(text: str) -> str:
    if " " in text:
        return text
    return re.sub(r"(\d)([^\d\s])", r"\1 \2", text, count=1)


def _nutrition_line(energy_cost: str) -> str:
    label = parse_energy_cost(energy_cost)
    if label is None:
        return " ".join(energy_cost.split())
    line = (
        f"белки {_ru_number(label.protein_g)} г, "
        f"жиры {_ru_number(label.fat_g)} г, "
        f"углеводы {_ru_number(label.carbs_g)} г, "
        f"{_ru_number(label.kcal)} ккал"
    )
    if label.basis_g != 100:
        line += f" на {_ru_number(label.basis_g)} г"
    return line


def _ru_number(value: float) -> str:
    return f"{value:.1f}".replace(".", ",")


def _producer_line(producer: str, country: str) -> str:
    name = " ".join(producer.split())
    place = " ".join(country.split())
    if name and place and place.casefold() not in name.casefold():
        return f"{name}, {place}"
    return name or place


def _network_names(raw: str | None) -> str:
    names: list[str] = []
    for part in str(raw or "").split(","):
        code = part.strip()
        if not code:
            continue
        names.append(_NETWORK_NAMES.get(code.casefold(), code))
    return ", ".join(names)


def _barcode(gtin: str | None, barcodes: str | None) -> str:
    code = str(gtin or "").strip()
    if code:
        return code
    try:
        values = json.loads(barcodes or "[]")
    except json.JSONDecodeError:
        return ""
    if isinstance(values, list) and values:
        return str(values[0])
    return ""


def _category_titles(connection: sqlite3.Connection, raw: str | None) -> str:
    try:
        values = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return ""
    if isinstance(values, int):
        values = [values]
    if not isinstance(values, list) or not values:
        return ""
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "categories" not in tables:
        return ""
    titles: list[str] = []
    for value in values:
        row = connection.execute("SELECT title FROM categories WHERE id = ?", (int(value),)).fetchone()
        if row and row[0]:
            titles.append(str(row[0]))
    return ", ".join(titles)


def catalog_from_products(products: list[PpProduct]) -> PpCatalog:
    grouped: dict[str, list[PpProduct]] = {key: [] for key, _ in BUCKETS}
    for product in products:
        for key, stems in BUCKETS:
            if any(stem in product.title_norm for stem in stems):
                grouped[key].append(product)
    return PpCatalog(by_bucket={key: tuple(items) for key, items in grouped.items()})


def load_pp_catalog(path: Path | None = None) -> PpCatalog:
    global _catalog_cache
    catalog_path = path or catalog_db_path()
    if not catalog_path.is_file():
        return PpCatalog(by_bucket={})
    mtime = catalog_path.stat().st_mtime
    if path is None and _catalog_cache is not None and _catalog_cache[0] == mtime:
        return _catalog_cache[1]

    connection = sqlite3.connect(readonly_sqlite_uri(catalog_path), uri=True)
    try:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(products)")}
        ready_ids = ready_made_category_ids(connection)
        category_column = ", p.category_ids" if "category_ids" in columns else ""
        rows = connection.execute(
            f"""
            SELECT p.id, p.title, p.brand, o.image_url{category_column}
            FROM products p
            JOIN chain_offers o ON o.product_id = p.id
            WHERE p.is_pp = 1
              AND o.image_url IS NOT NULL
              AND o.image_url != ''
            """
        ).fetchall()
    finally:
        connection.close()

    seen: dict[int, PpProduct] = {}
    for row in rows:
        product_id, title, brand, image_url = row[:4]
        category_ids = row[4] if len(row) > 4 else None
        if is_ready_made_catalog_item(
            title=title,
            brand=brand,
            category_ids=category_ids,
            ready_ids=ready_ids,
        ):
            continue
        if product_id in seen or not title or not image_url:
            continue
        seen[product_id] = PpProduct(
            product_id=int(product_id),
            title=str(title),
            brand=str(brand or ""),
            image_url=str(image_url),
            title_norm=normalize_food_text(str(title)),
        )
    catalog = catalog_from_products(list(seen.values()))
    if path is None:
        _catalog_cache = (mtime, catalog)
    return catalog


def _active_buckets(phrases: list[str]) -> list[str]:
    blob = normalize_food_text(" ".join(phrases))
    return [key for key, stems in BUCKETS if any(stem in blob for stem in stems)]


def _take(
    pool: list[PpProduct],
    *,
    seen_ids: set[int],
    logged: set[str],
    rng: random.Random,
) -> PpProduct | None:
    choices = [
        product
        for product in pool
        if product.product_id not in seen_ids and product.title_norm not in logged
    ]
    if not choices:
        return None
    product = rng.choice(choices)
    seen_ids.add(product.product_id)
    return product


def pick_pp_cards(
    catalog: PpCatalog,
    phrases: list[str],
    *,
    limit: int = PP_CARD_LIMIT,
    rng: random.Random | None = None,
) -> tuple[list[PpProduct], bool]:
    """Return up to `limit` cards and whether the staple set was used."""
    picker = rng or random.Random()
    logged = {normalize_food_text(phrase) for phrase in phrases if phrase.strip()}
    seen_ids: set[int] = set()
    chosen: list[PpProduct] = []
    active = _active_buckets(phrases)

    if active:
        order = list(active)
        picker.shuffle(order)
        while len(chosen) < limit:
            added = False
            for key in order:
                if len(chosen) >= limit:
                    break
                product = _take(
                    list(catalog.by_bucket.get(key, ())),
                    seen_ids=seen_ids,
                    logged=logged,
                    rng=picker,
                )
                if product is None:
                    continue
                chosen.append(product)
                added = True
            if not added:
                break
        if chosen:
            return chosen, False

    for stems in STAPLE_STEMS:
        if len(chosen) >= limit:
            break
        pool = [
            product
            for products in catalog.by_bucket.values()
            for product in products
            if any(stem in product.title_norm for stem in stems)
        ]
        leading = [
            product
            for product in pool
            if any(stem in product.title_norm[:24] for stem in stems)
        ]
        product = _take(leading or pool, seen_ids=seen_ids, logged=logged, rng=picker)
        if product is not None:
            chosen.append(product)
    return chosen, True
