import httpx
import pytest
from aiogram.types import BufferedInputFile

from src.bot.services.product_image import card_photo_source, load_product_photo


def test_card_photo_source_prefers_catalog_url() -> None:
    photo, fallback = card_photo_source("https://cdn.example/item.jpg", "barcode-file")

    assert photo == "https://cdn.example/item.jpg"
    assert fallback == "barcode-file"


def test_card_photo_source_keeps_uploaded_photo_without_catalog_image() -> None:
    photo, fallback = card_photo_source("ftp://cdn.example/item.jpg", "barcode-file")

    assert photo == "barcode-file"
    assert fallback is None


@pytest.mark.asyncio
async def test_load_product_photo_downloads_jpeg() -> None:
    jpeg = b"\xff\xd8\xff" + b"x" * 40

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://cdn.example/item.jpg"
        return httpx.Response(200, content=jpeg, headers={"content-type": "image/jpeg"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        photo = await load_product_photo("https://cdn.example/item.jpg", client=client)

    assert isinstance(photo, BufferedInputFile)
    assert photo.filename == "product.jpg"
    assert photo.data == jpeg


@pytest.mark.asyncio
async def test_load_product_photo_rejects_html_and_non_http() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        html = b"<html>" + b"nope" * 20 + b"</html>"
        return httpx.Response(200, content=html, headers={"content-type": "text/html"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        rejected = await load_product_photo("https://cdn.example/page", client=client)

    assert rejected is None
    assert await load_product_photo("not-a-url") is None
