import sqlite3

import pytest

from src.ai_analyzer.products import (
    barcode_digits,
    ean_checksum_ok,
    is_plain_water,
    lookup_product,
    package_grams,
    parse_energy_cost,
    volume_ml,
)


def test_ean_checksum_accepts_real_codes() -> None:
    assert ean_checksum_ok("4600536004105")
    assert ean_checksum_ok("96385074")
    assert barcode_digits("4600 5360 0410 5") == "4600536004105"


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
                barcode TEXT
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
            "INSERT INTO chain_offers (product_id, barcode) VALUES (3, '96385074')"
        )

    by_gtin = lookup_product("4600536004105", database=database)
    assert by_gtin is not None
    assert by_gtin.title == "Вода"
    assert by_gtin.weight_g == 1037

    by_list = lookup_product("2222222222228", database=database)
    assert by_list is not None
    assert by_list.title == "Сыр"
    assert by_list.brand == "Бренд"

    by_offer = lookup_product("96385074", database=database)
    assert by_offer is not None
    assert by_offer.title == "Хлеб"

    assert lookup_product("0000000000000", database=database) is None


def test_lookup_product_missing_file(tmp_path) -> None:
    with pytest.raises(FileNotFoundError):
        lookup_product("4600536004105", database=tmp_path / "missing.sqlite")
