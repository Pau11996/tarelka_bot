"""Pick healthy packaged products that match what the user ate this week."""

from __future__ import annotations

import random
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from src.bot.config import PROJECT_ROOT
from src.db.models import DayEntry, EntryType

PP_CARD_LIMIT = 5
CATALOG_PATH = PROJECT_ROOT / "data" / "green_by_products.sqlite"
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


def catalog_from_products(products: list[PpProduct]) -> PpCatalog:
    grouped: dict[str, list[PpProduct]] = {key: [] for key, _ in BUCKETS}
    for product in products:
        for key, stems in BUCKETS:
            if any(stem in product.title_norm for stem in stems):
                grouped[key].append(product)
    return PpCatalog(by_bucket={key: tuple(items) for key, items in grouped.items()})


def load_pp_catalog(path: Path | None = None) -> PpCatalog:
    global _catalog_cache
    catalog_path = path or CATALOG_PATH
    if not catalog_path.is_file():
        return PpCatalog(by_bucket={})
    mtime = catalog_path.stat().st_mtime
    if path is None and _catalog_cache is not None and _catalog_cache[0] == mtime:
        return _catalog_cache[1]

    connection = sqlite3.connect(f"{catalog_path.resolve().as_uri()}?mode=ro", uri=True)
    try:
        rows = connection.execute(
            """
            SELECT p.id, p.title, p.brand, o.image_url
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
    for product_id, title, brand, image_url in rows:
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
