from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.bot.config import settings
from src.db.url import async_engine_kwargs

engine = create_async_engine(
    settings.database_url,
    echo=False,
    **async_engine_kwargs(settings.database_url),
)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        yield session
