from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, KeyboardButton, ReplyKeyboardMarkup

from src.bot.config import settings
from src.bot.services.links import channel_url, feedback_chat_url

MAIN_MENU_ANCHOR = "Системное сообщение, бот работает корректно"
TODAY_BUTTON = "📊 Сегодня"
STATS_BUTTON = "📈 Статистика"
FAVORITES_BUTTON = "⭐ Избранное"
SUBSCRIPTION_BUTTON = "💎 Подписка"
PROFILE_BUTTON = "👤 Профиль"
CONTACTS_BUTTON = "⚙️ Контакты и настройки"
LEGACY_INVITE_BUTTON = "🎁 Пригласить"
LEGACY_CONTACTS_BUTTON = "💬 Контакты"
MENU_BUTTON_TEXTS = frozenset(
    {
        TODAY_BUTTON,
        STATS_BUTTON,
        FAVORITES_BUTTON,
        SUBSCRIPTION_BUTTON,
        PROFILE_BUTTON,
        CONTACTS_BUTTON,
        LEGACY_INVITE_BUTTON,
        LEGACY_CONTACTS_BUTTON,
    }
)


def main_menu() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text=TODAY_BUTTON), KeyboardButton(text=STATS_BUTTON)],
            [KeyboardButton(text=FAVORITES_BUTTON), KeyboardButton(text=SUBSCRIPTION_BUTTON)],
            [KeyboardButton(text=PROFILE_BUTTON), KeyboardButton(text=CONTACTS_BUTTON)],
        ],
        resize_keyboard=True,
        is_persistent=True,
        input_field_placeholder="Фото, голос или описание еды",
    )


def profile_fill_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Заполнить профиль · 1 минута",
                    callback_data="start:begin",
                )
            ]
        ]
    )


def sex_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="Мужской", callback_data="sex:male"),
                InlineKeyboardButton(text="Женский", callback_data="sex:female"),
            ]
        ]
    )


def goal_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Похудение", callback_data="goal:lose")],
            [InlineKeyboardButton(text="Поддержание", callback_data="goal:maintain")],
            [InlineKeyboardButton(text="Набор массы", callback_data="goal:gain")],
        ]
    )


def activity_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Минимальная", callback_data="activity:sedentary")],
            [InlineKeyboardButton(text="Легкая", callback_data="activity:light")],
            [InlineKeyboardButton(text="Умеренная", callback_data="activity:moderate")],
            [InlineKeyboardButton(text="Высокая", callback_data="activity:active")],
            [InlineKeyboardButton(text="Очень высокая", callback_data="activity:very_active")],
        ]
    )


def correction_entries_keyboard(entries: list[tuple[int, str]]) -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(text=title[:40], callback_data=f"correct:{entry_id}")]
        for entry_id, title in entries
    ]
    return InlineKeyboardMarkup(inline_keyboard=rows)


def meal_card_keyboard(entry_id: int, *, is_favorited: bool = False) -> InlineKeyboardMarkup:
    favorite_text = "✅ В избранном" if is_favorited else "⭐ В избранное"
    favorite_callback = f"meal_favorited:{entry_id}" if is_favorited else f"meal_favorite:{entry_id}"
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="Редактировать", callback_data=f"meal_edit:{entry_id}"),
                InlineKeyboardButton(text="Удалить", callback_data=f"meal_delete:{entry_id}"),
            ],
            [InlineKeyboardButton(text=favorite_text, callback_data=favorite_callback)],
        ]
    )


def favorites_keyboard(favorites: list) -> InlineKeyboardMarkup:
    rows = [
        [
            InlineKeyboardButton(
                text=f"➕ {favorite.title[:28]}",
                callback_data=f"favorite_add:{favorite.id}",
            ),
            InlineKeyboardButton(text="🗑", callback_data=f"favorite_delete:{favorite.id}"),
        ]
        for favorite in favorites
    ]
    return InlineKeyboardMarkup(inline_keyboard=rows)


def statistics_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="📊 Общая статистика за месяц", callback_data="stats:month")],
            [InlineKeyboardButton(text="⚖️ Вес", callback_data="stats:weight")],
            [InlineKeyboardButton(text="📅 Выбрать день", callback_data="stats:day")],
        ]
    )


def subscription_keyboard(*, is_active: bool = False) -> InlineKeyboardMarkup:
    button_text = (
        f"Продлить за {settings.subscription_price_stars}⭐"
        if is_active
        else f"Оформить за {settings.subscription_price_stars}⭐"
    )
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text=button_text, callback_data="sub:buy")]]
    )


def profile_card_keyboard() -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(text="Редактировать профиль", callback_data="profile:edit")],
        [InlineKeyboardButton(text="Изменить вес", callback_data="profile:edit_weight")],
        [InlineKeyboardButton(text="Изменить норму калорий", callback_data="profile:edit_calories")],
    ]
    url = feedback_chat_url()
    if url:
        rows.append([InlineKeyboardButton(text="💬 Вопросы и фидбек", url=url)])

    return InlineKeyboardMarkup(inline_keyboard=rows)


def contacts_keyboard() -> InlineKeyboardMarkup | None:
    rows: list[list[InlineKeyboardButton]] = []
    feedback = feedback_chat_url()
    channel = channel_url()
    if feedback:
        rows.append([InlineKeyboardButton(text="💬 Написать в поддержку", url=feedback)])
    if channel:
        rows.append([InlineKeyboardButton(text="📢 Канал ТАРЕЛКА", url=channel)])
    if not rows:
        return None
    return InlineKeyboardMarkup(inline_keyboard=rows)
