from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, KeyboardButton, ReplyKeyboardMarkup

from src.bot.services.links import feedback_chat_url

MAIN_MENU_ANCHOR = "Системное сообщение, бот работает корректно"


def main_menu() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="📊 Сегодня"), KeyboardButton(text="📈 Статистика")],
            [KeyboardButton(text="⭐ Избранное")],
            [KeyboardButton(text="👤 Профиль")],
        ],
        resize_keyboard=True,
        is_persistent=True,
        input_field_placeholder="Фото или описание еды",
    )


def profile_fill_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="Заполнить", callback_data="start:begin")]]
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
            [InlineKeyboardButton(text="📅 Выбрать день", callback_data="stats:day")],
        ]
    )


def profile_card_keyboard() -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(text="Редактировать профиль", callback_data="profile:edit")],
        [InlineKeyboardButton(text="Изменить норму калорий", callback_data="profile:edit_calories")],
    ]
    url = feedback_chat_url()
    if url:
        rows.append([InlineKeyboardButton(text="💬 Вопросы и фидбек", url=url)])

    return InlineKeyboardMarkup(inline_keyboard=rows)
