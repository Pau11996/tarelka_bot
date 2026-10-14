from __future__ import annotations

import logging

import httpx
from aiogram.types import BufferedInputFile

logger = logging.getLogger(__name__)

_MAX_IMAGE_BYTES = 5_000_000
_MIN_IMAGE_BYTES = 32


def card_photo_source(product_image_url: str | None, uploaded_file_id: str) -> tuple[str, str | None]:
    """Prefer the catalog photo, and keep the uploaded barcode as a fallback."""
    url = (product_image_url or "").strip()
    if url.startswith(("https://", "http://")) and len(url) <= 512:
        return url, uploaded_file_id
    return uploaded_file_id, None


async def load_product_photo(
    url: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> BufferedInputFile | None:
    if not url.startswith(("https://", "http://")):
        return None
    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient(timeout=10.0, follow_redirects=True)
    content: bytes | None = None
    content_type = ""
    try:
        response = await client.get(url)
        response.raise_for_status()
        content = response.content
        content_type = response.headers.get("content-type", "")
    except httpx.HTTPError:
        logger.warning("Product image download failed: %s", url)
        return None
    finally:
        if owns_client:
            await client.aclose()
    if content is None or not _MIN_IMAGE_BYTES <= len(content) <= _MAX_IMAGE_BYTES:
        return None
    kind = _image_kind(content_type, content)
    if kind is None:
        return None
    return BufferedInputFile(content, filename=f"product.{kind}")


def _image_kind(content_type: str, content: bytes) -> str | None:
    declared = content_type.split(";", 1)[0].strip().lower()
    if declared.startswith("image/"):
        if "png" in declared:
            return "png"
        if "webp" in declared:
            return "webp"
        if "gif" in declared:
            return "gif"
        return "jpg"
    if declared and declared not in {"application/octet-stream", "binary/octet-stream"}:
        return None
    if content.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return "webp"
    if content.startswith(b"GIF8"):
        return "gif"
    return None
