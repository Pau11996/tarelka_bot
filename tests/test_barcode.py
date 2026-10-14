from pathlib import Path

import zxingcpp
from PIL import Image

from src.ai_analyzer.barcode import decode_product_barcode
from src.shared.schemas import meal_slot_from_text


def _write_barcode(path: Path, fmt: zxingcpp.BarcodeFormat, text: str) -> None:
    bitmap = zxingcpp.write_barcode(fmt, text, width=320, height=140, quiet_zone=30)
    height, width = bitmap.shape
    Image.frombytes("L", (width, height), memoryview(bitmap).tobytes()).save(path, format="JPEG", quality=95)


def test_decode_product_barcode_reads_ean13_jpeg(tmp_path: Path) -> None:
    path = tmp_path / "ean.jpg"
    _write_barcode(path, zxingcpp.BarcodeFormat.EAN13, "4600536004105")

    assert decode_product_barcode(str(path)) == "4600536004105"


def test_decode_product_barcode_reads_upca_as_ean13(tmp_path: Path) -> None:
    path = tmp_path / "upc.jpg"
    _write_barcode(path, zxingcpp.BarcodeFormat.UPCA, "036000291452")

    assert decode_product_barcode(str(path)) == "0036000291452"


def test_decode_product_barcode_ignores_qr_and_blank_photos(tmp_path: Path) -> None:
    qr_path = tmp_path / "qr.jpg"
    _write_barcode(qr_path, zxingcpp.BarcodeFormat.QRCode, "4600536004105")
    blank_path = tmp_path / "blank.jpg"
    Image.new("RGB", (80, 80), "white").save(blank_path, format="JPEG")

    assert decode_product_barcode(str(qr_path)) is None
    assert decode_product_barcode(str(blank_path)) is None
    assert decode_product_barcode(str(tmp_path / "missing.jpg")) is None


def test_meal_slot_from_text_prefers_the_longer_phrase() -> None:
    assert meal_slot_from_text("на завтрак") == "breakfast"
    assert meal_slot_from_text("Поздний ужин дома") == "late_dinner"
    assert meal_slot_from_text("просто творог") is None
