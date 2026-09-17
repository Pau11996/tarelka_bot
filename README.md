# ТАРЕЛКА
python3 scripts/russian_tts.py -f text.txt --voice dmitry

docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build

Telegram-бот для учёта калорий, БЖУ и нутриентов. Пользователь отправляет фото, голосовое или текст — AI определяет еду или активность, пишет запись в дневник и обновляет дневной баланс.

Стек: **aiogram 3** · **FastAPI** · **PostgreSQL** · **Alembic** · лендинг на **nginx**.

## Возможности

- Анализ фото, голосовых и текста еды / активности (режим `auto`)
- Профиль: вес, рост, возраст, пол, цель, активность, норма калорий
- История веса и график в статистике
- Дневной баланс (`/today`), статистика за месяц и по дню
- Избранные блюда и активности
- Правка и удаление записей (`/correct`)
- Подписка через **Telegram Stars** (больше запросов в день)
- Лендинг с CTA в Telegram
- Админ-дашборд со статистикой пользователей и платежей

## Архитектура

```
Telegram → bot (polling) → AI_ANALYZER_URL → ai_analyzer:8000
                ↓
           PostgreSQL (внешняя БД)
landing:8080 → статика + proxy /admin/ → ai_analyzer
```

Сервисы в `docker-compose.yml`:

| Сервис | Назначение |
|--------|------------|
| `bot` | Telegram-бот, миграции Alembic при старте |
| `ai_analyzer` | HTTP API анализа (OpenAI) + admin API |
| `landing` | Статический сайт и UI админки |

PostgreSQL в compose **не входит**: укажите доступную БД в `DATABASE_URL` (отдельный контейнер, managed Postgres или локальный инстанс).

## Быстрый старт

1. Скопируйте окружение:

```bash
cp .env.example .env
```

2. Обязательно заполните:

```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_BOT_USERNAME=taarelka_bot
DATABASE_URL=postgresql+asyncpg://USER:PASSWORD@HOST:5432/DB
OPENAI_API_KEY=...
```

3. Поднимите сервисы:

```bash
docker compose up --build
```

4. В Telegram: `/start` → заполните профиль → отправьте фото, голосовое или описание еды.
5. Лендинг: [http://localhost:8080](http://localhost:8080)  
   Админка: [http://localhost:8080/admin.html](http://localhost:8080/admin.html)

### AI-бэкенд

Анализ идёт через **OpenAI API**.

```env
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4o-mini
```

Если сервер в неподдерживаемом регионе:

```env
OPENAI_HTTP_PROXY=http://proxy.example.com:8080
```

Для **голосового ввода** используется офлайн **Vosk** (русская модель в образе `ai_analyzer`). Нужны `ffmpeg` и модель по пути `VOSK_MODEL_PATH` (по умолчанию `/opt/vosk/model`).
## Команды и меню

| Команда / кнопка | Что делает |
|------------------|------------|
| `/start` | Онбординг; deep-link `?start=premium` открывает экран подписки |
| `/profile` · «👤 Профиль» | Вес, рост, цель, норма ккал; правка веса |
| `/today` · «📊 Сегодня» | Дневной баланс и записи |
| `/stats` · «📈 Статистика» | Месяц, график веса, день |
| `/favorites` · «⭐ Избранное» | Быстрое добавление сохранённых блюд/активностей |
| `/correct` | Исправить или удалить запись |
| `/premium` · «💎 Подписка» | Статус и покупка Stars |
| `/paysupport` | Контакты по оплате и возвратам |
| `/feedback` | Чат поддержки |
| Фото, голос или текст | Автоопределение еды/активности и пересчёт баланса |

## Подписка (Telegram Stars)

Оплата встроенными Stars (`currency=XTR`), без внешних платёжек.

Значения по умолчанию (можно переопределить в `.env`):

| Переменная | По умолчанию | Смысл |
|------------|--------------|--------|
| `DAILY_REQUEST_LIMIT` | `6` | Лимит AI-запросов без подписки |
| `SUBSCRIPTION_DAILY_REQUEST_LIMIT` | `30` | Лимит с подпиской |
| `SUBSCRIPTION_PRICE_STARS` | `150` | Цена в Stars |
| `SUBSCRIPTION_DURATION_DAYS` | `30` | Срок |
| `SUBSCRIPTION_REMINDER_DAYS_BEFORE` | `2` | Напоминание до окончания |

Deep-link на экран подписки:

```text
https://t.me/<TELEGRAM_BOT_USERNAME>?start=premium
```

Для корректных ссылок в напоминаниях и сообщениях о лимите задайте `TELEGRAM_BOT_USERNAME` (без `@`).

## База данных

Бот при старте выполняет `alembic upgrade head`.

Пример `DATABASE_URL`:

```env
# хост postgres в вашей сети / на VPS
DATABASE_URL=postgresql+asyncpg://wellhealth:wellhealth@postgres:5432/wellhealth

# локальная разработка без Docker-сети
DATABASE_URL=postgresql+asyncpg://wellhealth:wellhealth@localhost:5432/wellhealth
```

Нужны миграции из `migrations/versions/` (включая подписку и историю веса).

## Лендинг

```env
TELEGRAM_BOT_USERNAME=taarelka_bot
LANDING_TITLE=ТАРЕЛКА
LANDING_PORT=8080
TELEGRAM_FEEDBACK_CHAT=taarelkachat
```

Только лендинг:

```bash
docker compose up -d --build landing
```

Ссылки на бота: `https://t.me/${TELEGRAM_BOT_USERNAME}`.

## Админка

UI: `/admin.html` на лендинге. API проксируется на `ai_analyzer` по `/admin/`.

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=...          # смените дефолт
ADMIN_TOKEN_SECRET=...      # длинный случайный секрет
```

Метрики: пользователи, активные подписки, Stars, динамика.

Не оставляйте пароль `admin` в проде и не открывайте админку без HTTPS/ограничения доступа.

## Чат поддержки

1. Создайте публичную группу или канал с username, либо invite-ссылку.
2. В `.env`:

```env
TELEGRAM_FEEDBACK_CHAT=taarelkachat
# или
TELEGRAM_FEEDBACK_CHAT=https://t.me/+XXXXXXXX
```

После этого ссылка появится в `/start`, `/feedback`, профиле и на лендинге. Та же ссылка используется в `/paysupport`.

## Переменные окружения

Полный шаблон — `.env.example`. Кратко обязательное и частое:

| Переменная | Обязательно | Описание |
|------------|-------------|----------|
| `TELEGRAM_BOT_TOKEN` | да | Токен BotFather |
| `TELEGRAM_BOT_USERNAME` | да* | Username без `@` (*для deep-link и лендинга) |
| `DATABASE_URL` | да | Async Postgres URL (`postgresql+asyncpg://...`) |
| `OPENAI_API_KEY` | да | Ключ OpenAI |
| `AI_ANALYZER_URL` | нет | По умолчанию `http://ai_analyzer:8000` в Docker |
| `DEFAULT_TIMEZONE` | нет | `Europe/Moscow` |
| `MESSAGE_CLEANUP_TTL_SECONDS` | нет | TTL служебных сообщений (`7200`) |
| `TELEGRAM_FEEDBACK_CHAT` | нет | Username чата или invite URL |
| `ADMIN_*` | для админки | Логин, пароль, секрет токена |

## Если анализ фото не работает

Ошибка региона или таймаут OpenAI значит, что `ai_analyzer` не достучался до API.

1. Проверьте `OPENAI_API_KEY` в `.env`.
2. Пересоберите анализатор:

```bash
docker compose up -d --build ai_analyzer
```

3. Если сервер в неподдерживаемом регионе, задайте прокси:

```env
OPENAI_HTTP_PROXY=http://your-proxy:port
```

## Локальная разработка

Нужны Python 3.12+ и доступный PostgreSQL.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
# поправьте DATABASE_URL на localhost и токены
alembic upgrade head
pytest
```

Запуск без Docker (в двух терминалах):

```bash
uvicorn src.ai_analyzer.server:app --host 0.0.0.0 --port 8000
python -m src.bot.main
```

## Деплой

Ручной деплой на VPS (как в CI):

```bash
./scripts/deploy.sh
```

Скрипт делает `git reset --hard origin/master` и `docker compose up -d --build`.  
В GitHub Actions job автодеплоя сейчас выключен; тесты (`pytest`) гоняются на push/PR в `master`.

## Структура репозитория

```text
src/bot/           # Telegram-бот, handlers, сервисы
src/ai_analyzer/   # FastAPI: анализ + admin API
src/db/            # модели, repository, session
src/shared/        # схемы и логирование
migrations/        # Alembic
landing/           # nginx + статика + admin UI
tests/             # pytest
scripts/deploy.sh  # ручной деплой
```
