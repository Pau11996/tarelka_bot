ANALYSIS_UNAVAILABLE = (
    "Не удалось выполнить анализ — сервис AI временно недоступен.\n"
    "Попробуйте ещё раз через минуту."
)

ANALYSIS_UNAVAILABLE_WITH_HINT = (
    f"{ANALYSIS_UNAVAILABLE}\n\n"
    "Если ошибка повторяется, проверьте настройки ai_analyzer "
    "(API=true: OPENAI_API_KEY, OPENAI_HTTP_PROXY; иначе CURSOR_API_KEY, прокси, HTTPS_PROXY)."
)
