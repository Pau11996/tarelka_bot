import os
import sqlite3

import pytest

from src.ai_analyzer.products import (
    barcode_digits,
    ean_checksum_ok,
    is_plain_water,
    lookup_product,
    normalize_retail_barcode,
    package_grams,
    parse_energy_cost,
    volume_ml,
)


def test_ean_checksum_accepts_real_codes() -> None:
    assert ean_checksum_ok("4600536004105")
    assert ean_checksum_ok("96385074")
    assert barcode_digits("4600 5360 0410 5") == "4600536004105"


def test_normalize_retail_barcode_accepts_upca_as_ean13() -> None:
    assert normalize_retail_barcode("036000291452") == "0036000291452"
    assert normalize_retail_barcode("4600 5360 0410 5") == "4600536004105"
    assert normalize_retail_barcode("4600536004106") is None


def test_ean_checksum_rejects_bad_length_and_digit() -> None:
    assert not ean_checksum_ok("4600536004106")
    assert not ean_checksum_ok("460053600410")
    assert not ean_checksum_ok("")


def test_parse_energy_cost_defaults_to_100_grams() -> None:
    label = parse_energy_cost(
        "белки - 13,0 г; жиры - 10 г; углеводы - 5 г; энергетическая ценность - 310,0 ккал"
    )

    assert label is not None
    assert label.kcal == 310
    assert label.protein_g == 13
    assert label.fat_g == 10
    assert label.carbs_g == 5
    assert label.basis_g == 100


def test_parse_energy_cost_uses_explicit_basis_and_typos() -> None:
    explicit = parse_energy_cost("в 40г- 540кДж/130ккал")
    assert explicit is not None
    assert explicit.basis_g == 40
    assert explicit.kcal == 130

    typos = parse_energy_cost("набелки - 12 г; жиры - 1 г; улеводы - 20 г; 100 ккал")
    assert typos is not None
    assert typos.protein_g == 12
    assert typos.carbs_g == 20

    glued = parse_energy_cost("в344 ккал")
    assert glued is not None
    assert glued.kcal == 344
    assert glued.basis_g == 100


def test_parse_energy_cost_reads_fiber_without_failing() -> None:
    label = parse_energy_cost(
        "Энергетическая ценность — 1340 кДж/320 ккал. "
        "набелки — 9,0 г; жиры — 2,0 г; углеводы — 66,0 г; "
        "суммарное содержание пищевых волокон - 10,2 г"
    )

    assert label is not None
    assert label.kcal == 320
    assert label.protein_g == 9
    assert label.fat_g == 2
    assert label.carbs_g == 66
    assert label.fiber_g == 10.2


def test_parse_energy_cost_returns_none_without_calories() -> None:
    assert parse_energy_cost("") is None
    assert parse_energy_cost(None) is None
    assert parse_energy_cost("белки 10 г") is None


def test_package_grams_prefers_grams_in_volume() -> None:
    assert package_grams("40 г", 200) == (40, False)
    assert package_grams("1л", 1037) == (1037, False)
    assert package_grams("", None) == (100, True)


def test_volume_ml_and_plain_water() -> None:
    assert volume_ml("1 л") == 1000
    assert volume_ml("500мл") == 500
    label = parse_energy_cost(
        "белки - 0,0 г; жиры - 0,0 г; улеводы - 0,0 г; энергетическая ценность -0,0 ккал/0,0 кДж."
    )
    assert label is not None
    assert is_plain_water("Минеральная вода Нарзан газ", label)
    assert not is_plain_water("Водка", label)


def test_lookup_product_searches_gtin_barcodes_and_offers(tmp_path) -> None:
    database = tmp_path / "products.sqlite"
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TABLE products (
                id INTEGER PRIMARY KEY,
                gtin TEXT,
                barcodes TEXT,
                title TEXT,
                brand TEXT,
                weight INTEGER,
                volume TEXT,
                energy_cost TEXT
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE chain_offers (
                product_id INTEGER,
                barcode TEXT,
                image_url TEXT
            )
            """
        )
        connection.execute(
            """
            INSERT INTO products (id, gtin, barcodes, title, brand, weight, volume, energy_cost)
            VALUES (1, '4600536004105', '["4600536004105"]', 'Вода', '', 1037, '1л', '0 ккал')
            """
        )
        connection.execute(
            """
            INSERT INTO products (id, gtin, barcodes, title, brand, weight, volume, energy_cost)
            VALUES (2, '1111111111116', '["2222222222228"]', 'Сыр', 'Бренд', 200, '200 г', '300 ккал')
            """
        )
        connection.execute(
            """
            INSERT INTO products (id, gtin, barcodes, title, brand, weight, volume, energy_cost)
            VALUES (3, '', '[]', 'Хлеб', '', 400, '', '')
            """
        )
        connection.execute(
            """
            INSERT INTO chain_offers (product_id, barcode, image_url)
            VALUES
              (1, '4600536004105', 'https://cdn.example/water.webp'),
              (1, '4600536004105', 'https://cdn.example/4600536004105.jpg'),
              (3, '96385074', 'not-a-url')
            """
        )

    by_gtin = lookup_product("4600536004105", database=database)
    assert by_gtin is not None
    assert by_gtin.title == "Вода"
    assert by_gtin.weight_g == 1037
    assert by_gtin.image_url == "https://cdn.example/4600536004105.jpg"

    by_list = lookup_product("2222222222228", database=database)
    assert by_list is not None
    assert by_list.title == "Сыр"
    assert by_list.brand == "Бренд"

    by_offer = lookup_product("96385074", database=database)
    assert by_offer is not None
    assert by_offer.title == "Хлеб"

    assert lookup_product("0000000000000", database=database) is None


def test_lookup_product_reads_wal_catalog_from_readonly_directory(tmp_path) -> None:
    database = tmp_path / "products.sqlite"
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute(
            """
            CREATE TABLE products (
                id INTEGER PRIMARY KEY,
                gtin TEXT,
                barcodes TEXT,
                title TEXT,
                brand TEXT,
                weight INTEGER,
                volume TEXT,
                energy_cost TEXT
            )
            """
        )
        connection.execute(
            """
            INSERT INTO products (id, gtin, barcodes, title, brand, weight, volume, energy_cost)
            VALUES (1, '4600536004105', '[]', 'Вода', '', 1037, '1л', '0 ккал')
            """
        )
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TABLE chain_offers (
                product_id INTEGER,
                barcode TEXT,
                image_url TEXT
            )
            """
        )
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")

    os.chmod(database, 0o444)
    os.chmod(tmp_path, 0o555)
    try:
        product = lookup_product("4600536004105", database=database)
    finally:
        os.chmod(tmp_path, 0o755)
        os.chmod(database, 0o644)

    assert product is not None
    assert product.title == "Вода"


def test_lookup_product_skips_ready_made_counter(tmp_path) -> None:
    database = tmp_path / "products.sqlite"
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TABLE products (
                id INTEGER PRIMARY KEY,
                gtin TEXT,
                barcodes TEXT,
                title TEXT,
                brand TEXT,
                weight INTEGER,
                volume TEXT,
                energy_cost TEXT,
                category_ids TEXT
            )
            """
        )
        connection.execute(
            "CREATE TABLE categories (id INTEGER PRIMARY KEY, parent_id INTEGER, title TEXT)"
        )
        connection.execute(
            "CREATE TABLE chain_offers (product_id INTEGER, barcode TEXT, image_url TEXT)"
        )
        connection.executemany(
            "INSERT INTO categories (id, parent_id, title) VALUES (?, ?, ?)",
            [(397, None, "Готовая еда"), (402, 397, "Салаты"), (513, None, "Вода")],
        )
        connection.execute(
            """
            INSERT INTO products
                (id, gtin, barcodes, title, brand, weight, volume, energy_cost, category_ids)
            VALUES
                (1, '4600536004105', '[]', 'Вода', '', 1037, '1л', '0 ккал', '[513]'),
                (2, '2222222222228', '[]', 'Салат Греческий', '', 200, '200 г', '', '[402]')
            """
        )

    water = lookup_product("4600536004105", database=database)
    assert water is not None
    assert water.title == "Вода"
    assert lookup_product("2222222222228", database=database) is None


def test_lookup_product_skips_ready_made_brand(tmp_path) -> None:
    database = tmp_path / "products.sqlite"
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TABLE products (
                id INTEGER PRIMARY KEY,
                gtin TEXT,
                barcodes TEXT,
                title TEXT,
                brand TEXT,
                weight INTEGER,
                volume TEXT,
                energy_cost TEXT
            )
            """
        )
        connection.execute(
            "CREATE TABLE chain_offers (product_id INTEGER, barcode TEXT, image_url TEXT)"
        )
        connection.execute(
            """
            INSERT INTO products (id, gtin, barcodes, title, brand, weight, volume, energy_cost)
            VALUES (1, '4600536004105', '[]', 'Котлета', 'Готовим с любовью!', 300, '300 г', '')
            """
        )

    assert lookup_product("4600536004105", database=database) is None


def test_lookup_product_missing_file(tmp_path) -> None:
    with pytest.raises(FileNotFoundError):
        lookup_product("4600536004105", database=tmp_path / "missing.sqlite")
