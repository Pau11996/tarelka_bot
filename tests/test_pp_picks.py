from __future__ import annotations

import random
import sqlite3
from datetime import date

from src.bot.keyboards.menus import week_menu_keyboard
from src.bot.services.links import HELP_TEXT
from src.bot.services.pp_picks import (
    PpProduct,
    card_caption,
    catalog_from_products,
    load_pp_catalog,
    meal_phrases,
    pick_pp_cards,
)
from src.db.models import DayEntry, EntryType


def _product(product_id: int, title: str, brand: str = "") -> PpProduct:
    return PpProduct(
        product_id=product_id,
        title=title,
        brand=brand,
        image_url=f"https://img.example/{product_id}.jpg",
        title_norm=title.lower().replace("ё", "е"),
    )


def _catalog():
    return catalog_from_products(
        [
            _product(1, "Творог Савушкин 5%", "Савушкин"),
            _product(2, "Кефир 1%"),
            _product(3, "Филе грудки индейки"),
            _product(4, "Гречка ядрица"),
            _product(5, "Брокколи свежая"),
            _product(6, "Яйцо куриное С1"),
            _product(7, "Чипсы картофельные"),
            _product(8, "Йогурт греческий 2%"),
            _product(9, "Карамель в пластиковом яйце с игрушкой"),
        ]
    )


def _meal(title: str, items: list[dict] | None = None) -> DayEntry:
    return DayEntry(
        user_id=1,
        entry_date=date(2026, 10, 12),
        entry_type=EntryType.MEAL,
        title=title,
        calories=100,
        items=items,
    )


def test_week_menu_offers_habits_and_pp() -> None:
    labels = [
        button.text
        for row in week_menu_keyboard().inline_keyboard
        for button in row
    ]
    callbacks = [
        button.callback_data
        for row in week_menu_keyboard().inline_keyboard
        for button in row
    ]
    assert labels == [
        "AI анализ пищевых привычек за неделю",
        "Подбор ПП продуктов под ваш рацион",
        "Аналитика активности",
    ]
    assert callbacks == ["coach:habits", "coach:pp", "coach:activity"]
    assert "подбор ПП-продуктов" in HELP_TEXT
    assert "аналитика активности" in HELP_TEXT


def test_meal_phrases_skip_activity_and_keep_item_names() -> None:
    activity = DayEntry(
        user_id=1,
        entry_date=date(2026, 10, 12),
        entry_type=EntryType.ACTIVITY,
        title="пробежка",
        calories=100,
    )
    phrases = meal_phrases(
        [
            activity,
            _meal("обед", [{"name": "гречневая каша"}, {"name": "  "}]),
        ]
    )
    assert phrases == ["обед", "гречневая каша"]


def test_picks_follow_dairy_and_poultry_from_the_week() -> None:
    cards, used_staples = pick_pp_cards(
        _catalog(),
        ["творог 5%", "куриная грудка"],
        rng=random.Random(1),
    )
    titles = " ".join(card.title.lower() for card in cards)
    assert used_staples is False
    assert "творог" in titles or "кефир" in titles
    assert "грудк" in titles
    assert "чипс" not in titles
    assert 1 < len(cards) <= 5


def test_exact_logged_title_is_not_offered_again() -> None:
    cards, used_staples = pick_pp_cards(
        _catalog(),
        ["Творог Савушкин 5%"],
        rng=random.Random(2),
    )
    titles = [card.title for card in cards]
    assert used_staples is False
    assert "Творог Савушкин 5%" not in titles
    assert "Кефир 1%" in titles


def test_empty_week_uses_staple_products() -> None:
    cards, used_staples = pick_pp_cards(_catalog(), [], rng=random.Random(0))
    titles = " ".join(card.title.lower() for card in cards)
    assert used_staples is True
    assert len(cards) == 5
    assert "греч" in titles
    assert "творог" in titles
    assert "грудк" in titles
    assert "брокколи" in titles
    assert "яйцо" in titles
    assert "чипс" not in titles
    assert "греческий" not in titles
    assert "игруш" not in titles


def test_caption_adds_brand_once() -> None:
    branded = _product(1, "Творог 5%", "Савушкин")
    assert card_caption(branded) == "Творог 5%\nСавушкин"
    already = _product(2, "Творог Савушкин 5%", "Савушкин")
    assert card_caption(already) == "Творог Савушкин 5%"


def test_load_catalog_keeps_only_pp_products_with_photos(tmp_path) -> None:
    database = tmp_path / "products.sqlite"
    connection = sqlite3.connect(database)
    connection.execute(
        "CREATE TABLE products (id INTEGER PRIMARY KEY, title TEXT, brand TEXT, is_pp INTEGER)"
    )
    connection.execute(
        "CREATE TABLE chain_offers (product_id INTEGER, image_url TEXT)"
    )
    connection.executemany(
        "INSERT INTO products VALUES (?, ?, ?, ?)",
        [
            (1, "Гречка ядрица", "Мельница", 1),
            (2, "Колбаса варёная", "", 0),
            (3, "Творог 5%", "", 1),
        ],
    )
    connection.executemany(
        "INSERT INTO chain_offers VALUES (?, ?)",
        [
            (1, "https://img.example/buckwheat.jpg"),
            (1, "https://img.example/buckwheat-2.jpg"),
            (2, "https://img.example/sausage.jpg"),
            (3, ""),
        ],
    )
    connection.commit()
    connection.close()

    catalog = load_pp_catalog(database)
    titles = [product.title for products in catalog.by_bucket.values() for product in products]
    assert titles == ["Гречка ядрица"]
    assert catalog.by_bucket["grains"][0].image_url == "https://img.example/buckwheat.jpg"
    assert catalog.by_bucket["grains"][0].brand == "Мельница"
