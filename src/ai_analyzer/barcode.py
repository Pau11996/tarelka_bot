from __future__ import annotations

import logging

from src.ai_analyzer.products import normalize_retail_barcode

logger = logging.getLogger(__name__)


def decode_product_barcode(image_path: str) -> str | None:
    try:
        return _decode_product_barcode(image_path)
    except Exception:
        logger.exception("Barcode decode failed for %s", image_path)
        return None


def _decode_product_barcode(image_path: str) -> str | None:
    import zxingcpp
    from PIL import Image, ImageOps

    formats = (
        zxingcpp.BarcodeFormat.EAN13
        | zxingcpp.BarcodeFormat.EAN8
        | zxingcpp.BarcodeFormat.UPCA
        | zxingcpp.BarcodeFormat.UPCE
    )
    try:
        with Image.open(image_path) as image:
            prepared = ImageOps.exif_transpose(image).convert("RGB")
            results = zxingcpp.read_barcodes(prepared, formats=formats)
    except OSError:
        return None

    chosen: str | None = None
    for result in results:
        if not result.valid:
            continue
        code = normalize_retail_barcode(result.text)
        if code is None:
            continue
        if chosen is None or (len(chosen) != 13 and len(code) == 13):
            chosen = code
    return chosen
