ANALYSIS_UNAVAILABLE = (
    "Не удалось выполнить анализ — сервис AI временно недоступен.\n"
    "Попробуйте ещё раз через минуту."
)

ANALYSIS_UNAVAILABLE_WITH_HINT = (
    f"{ANALYSIS_UNAVAILABLE}\n\n"
    "Если ошибка повторяется, проверьте доступ контейнера ai_analyzer к Cursor API "
    "(CURSOR_API_KEY, прокси, HTTPS_PROXY)."
)
