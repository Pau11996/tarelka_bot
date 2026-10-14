from __future__ import annotations

import random
import sqlite3
from datetime import date

from src.bot.keyboards.menus import week_menu_keyboard
from src.bot.services.links import HELP_TEXT
from src.bot.config import PROJECT_ROOT
from src.bot.services.pp_picks import (
    PpProduct,
    PpProductCard,
    card_caption,
    catalog_db_path,
    catalog_favorite_nutrition,
    catalog_from_products,
    format_pp_card,
    load_pp_catalog,
    load_pp_product_card,
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


def test_format_pp_card_lists_catalog_fields() -> None:
    card = PpProductCard(
        product_id=1027,
        title="Творог Мягкий Савушкин продукт 5%",
        brand="Савушкин",
        barcode="4810268019630",
        volume="125г",
        weight_g=130,
        energy_cost="белки - 8,5 г; жиры - 5,0 г; углеводы - 1,6 г; 85,4 ккал",
        description="творог (молоко), сливки <след яиц>",
        producer='ОАО"Савушкин продукт"',
        country="Республика Беларусь",
        categories="Творог",
        networks="Гиппо, Green",
        image_url="https://img.example/1027.jpg",
    )

    text = format_pp_card(card)

    assert "Название: Творог Мягкий Савушкин продукт 5%" in text
    assert "Бренд: Савушкин" in text
    assert "Штрихкод: 4810268019630" in text
    assert "Фасовка: 125 г, вес 130 г" in text
    assert "КБЖУ: белки 8,5 г, жиры 5,0 г, углеводы 1,6 г, 85,4 ккал" in text
    assert "Состав: творог (молоко), сливки &lt;след яиц&gt;" in text
    assert "Производитель: ОАО&quot;Савушкин продукт&quot;, Республика Беларусь" in text
    assert "Категория: Творог" in text
    assert "Сети: Гиппо, Green" in text
    nutrition = catalog_favorite_nutrition(card)
    assert nutrition["calories"] == 85.4
    assert nutrition["items"][0]["quantity"] == "100 г"


def test_load_pp_product_card_reads_catalog_row(monkeypatch, tmp_path) -> None:
    database = tmp_path / "products.sqlite"
    connection = sqlite3.connect(database)
    connection.execute(
        """
        CREATE TABLE products (
            id INTEGER PRIMARY KEY,
            title TEXT,
            brand TEXT,
            gtin TEXT,
            barcodes TEXT,
            volume TEXT,
            weight INTEGER,
            energy_cost TEXT,
            description TEXT,
            producer TEXT,
            producing_country TEXT,
            category_ids TEXT,
            networks TEXT
        )
        """
    )
    connection.execute(
        "CREATE TABLE categories (id INTEGER PRIMARY KEY, title TEXT)"
    )
    connection.execute("CREATE TABLE chain_offers (product_id INTEGER, image_url TEXT)")
    connection.execute("INSERT INTO categories VALUES (1, 'Творог')")
    connection.execute(
        """
        INSERT INTO products VALUES (
            7, 'Творог 5%', 'Савушкин', '4810268019630', '[]', '125г', 130,
            '85 ккал', 'молоко', 'Савушкин', 'Беларусь', '[1]', 'gippo,green'
        )
        """
    )
    connection.execute("INSERT INTO chain_offers VALUES (7, 'https://img.example/7.jpg')")
    connection.commit()
    connection.close()
    monkeypatch.setenv("PRODUCT_DB_PATH", str(database))

    card = load_pp_product_card(7)

    assert card is not None
    assert card.barcode == "4810268019630"
    assert card.categories == "Творог"
    assert card.networks == "Гиппо, Green"
    assert card.image_url == "https://img.example/7.jpg"


def test_catalog_db_path_follows_product_db_env(monkeypatch, tmp_path) -> None:
    absolute = tmp_path / "catalog.sqlite"
    monkeypatch.setenv("PRODUCT_DB_PATH", str(absolute))
    assert catalog_db_path() == absolute

    monkeypatch.setenv("PRODUCT_DB_PATH", "data/green_by_products.sqlite")
    assert catalog_db_path() == PROJECT_ROOT / "data" / "green_by_products.sqlite"


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


def test_load_catalog_skips_ready_made_counter(tmp_path) -> None:
    database = tmp_path / "products.sqlite"
    connection = sqlite3.connect(database)
    connection.execute(
        """
        CREATE TABLE products (
            id INTEGER PRIMARY KEY,
            title TEXT,
            brand TEXT,
            is_pp INTEGER,
            category_ids TEXT
        )
        """
    )
    connection.execute(
        "CREATE TABLE categories (id INTEGER PRIMARY KEY, parent_id INTEGER, title TEXT)"
    )
    connection.execute("CREATE TABLE chain_offers (product_id INTEGER, image_url TEXT)")
    connection.executemany(
        "INSERT INTO categories (id, parent_id, title) VALUES (?, ?, ?)",
        [(397, None, "Готовая еда"), (402, 397, "Салаты")],
    )
    connection.executemany(
        "INSERT INTO products VALUES (?, ?, ?, ?, ?)",
        [
            (1, "Гречка ядрица", "", 1, "[1247]"),
            (2, "Салат Греческий", "", 1, "[402]"),
        ],
    )
    connection.executemany(
        "INSERT INTO chain_offers VALUES (?, ?)",
        [
            (1, "https://img.example/buckwheat.jpg"),
            (2, "https://img.example/salad.jpg"),
        ],
    )
    connection.commit()
    connection.close()

    catalog = load_pp_catalog(database)
    titles = [product.title for products in catalog.by_bucket.values() for product in products]
    assert titles == ["Гречка ядрица"]


def test_load_catalog_skips_ready_made_brand(tmp_path) -> None:
    database = tmp_path / "products.sqlite"
    connection = sqlite3.connect(database)
    connection.execute(
        "CREATE TABLE products (id INTEGER PRIMARY KEY, title TEXT, brand TEXT, is_pp INTEGER)"
    )
    connection.execute("CREATE TABLE chain_offers (product_id INTEGER, image_url TEXT)")
    connection.executemany(
        "INSERT INTO products VALUES (?, ?, ?, ?)",
        [
            (1, "Гречка ядрица", "", 1),
            (2, "Котлета куриная", "Готовим с любовью!", 1),
        ],
    )
    connection.executemany(
        "INSERT INTO chain_offers VALUES (?, ?)",
        [
            (1, "https://img.example/buckwheat.jpg"),
            (2, "https://img.example/cutlet.jpg"),
        ],
    )
    connection.commit()
    connection.close()

    catalog = load_pp_catalog(database)
    titles = [product.title for products in catalog.by_bucket.values() for product in products]
    assert titles == ["Гречка ядрица"]
