from __future__ import annotations

APP_LOGIN_PREFIX = "app_"
LOGIN_EXPIRED = (
    "Ссылка для входа устарела или уже использована. Запросите новую в приложении."
)


def app_login_code(start_args: str | None) -> str | None:
    if not start_args or not start_args.startswith(APP_LOGIN_PREFIX):
        return None
    code = start_args[len(APP_LOGIN_PREFIX) :]
    if not code:
        return None
    return code
