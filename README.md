docker compose up -d --build bot# ТАРЕЛКА

Telegram-бот для учета калорий, БЖУ и нутриентов с анализом через Cursor CLI.

## Быстрый старт

1. Скопируйте `.env.example` в `.env` и заполните переменные.
2. Получите API-ключ Cursor: [cursor.com/dashboard](https://cursor.com/dashboard) → Integrations / API Keys.
3. Добавьте в `.env`:

```env
CURSOR_API_KEY=your-cursor-api-key
```

Альтернатива — OAuth-логин в контейнере (если не хотите API key):

```bash
docker compose run --rm -it ai_analyzer agent login
```

4. Запустите сервисы:

```bash
docker compose up --build
```

5. Откройте бота в Telegram и выполните `/start`, затем `/profile`.
6. Лендинг доступен на [http://localhost:8080](http://localhost:8080) (сервис `landing`).

## Если анализ фото не работает

Ошибка `Failed to reach the Cursor API` означает, что контейнер `ai_analyzer` не может достучаться до Cursor API (не проблема Telegram-бота).

1. Проверьте ключ в `.env`: `CURSOR_API_KEY` из [cursor.com/dashboard](https://cursor.com/dashboard) → Integrations.
2. Пересоберите `ai_analyzer` (в образе включён HTTP/1.1 для CLI):

```bash
docker compose up -d --build ai_analyzer
```

3. Проверьте сеть из контейнера:

```bash
docker compose exec ai_analyzer curl -I https://api2.cursor.sh
docker compose exec ai_analyzer agent -p "reply ok" --output-format text --mode ask --force
```

4. Если вы за корпоративным прокси, добавьте в `.env`:

```env
HTTPS_PROXY=http://your-proxy:port
HTTP_PROXY=http://your-proxy:port
NODE_USE_ENV_PROXY=1
```

5. Альтернатива API key — OAuth в контейнере:

```bash
docker compose run --rm -it ai_analyzer agent login
```

## Сервисы

- `bot` — Telegram-бот (aiogram)
- `ai_analyzer` — HTTP API поверх Cursor CLI (`agent -p`)
- `postgres` — хранение профилей и дневных записей
- `landing` — статический лендинг (nginx) с описанием бота и ссылкой в Telegram

## Лендинг

В `.env` укажите username бота без `@`:

```env
TELEGRAM_BOT_USERNAME=taarelka_bot
LANDING_TITLE=ТАРЕЛКА
LANDING_PORT=8080
TELEGRAM_FEEDBACK_CHAT=taarelkachat
```

Запуск только лендинга:

```bash
docker compose up -d --build landing
```

Ссылки на бота формируются как `https://t.me/${TELEGRAM_BOT_USERNAME}`.

## Чат для фидбека

1. В Telegram: **Новая группа** → назовите, например, «ТАРЕЛКА — поддержка».
2. Добавьте @taarelka_bot как администратора (по желанию).
3. **Настройки группы → Тип группы → Публичная** → задайте username, например `taarelkachat`.
4. Закрепите приветственное сообщение: что писать вопросы, баги и идеи.
5. Добавьте в `.env`:

```env
TELEGRAM_FEEDBACK_CHAT=taarelkachat
```

Можно указать invite-ссылку: `https://t.me/+XXXXXXXX`.

После этого в приветственном сообщении бота будет ссылка на чат, команда `/feedback` и кнопка в профиле. На лендинге — ссылка в меню, FAQ и футере.

## Команды бота

- `/profile` — настройка веса, роста, цели и нормы калорий
- `/today` — дневной баланс и записи за сегодня
- `/correct` — исправить последний анализ приема пищи
- `/feedback` — чат для вопросов и предложений
- Фото или текст — бот сам определит еду или активность и пересчитает баланс

## Локальная разработка

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest
```
