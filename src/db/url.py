from urllib.parse import urlparse


def normalize_async_database_url(url: str) -> str:
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    return url


def uses_pgbouncer(url: str) -> bool:
    parsed = urlparse(url.replace("+asyncpg", ""))
    if parsed.port == 6543:
        return True
    return "pooler" in (parsed.hostname or "")


def async_engine_kwargs(url: str) -> dict:
    if not uses_pgbouncer(url):
        return {}
    return {
        "connect_args": {"statement_cache_size": 0},
    }
