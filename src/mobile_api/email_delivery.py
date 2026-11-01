"""SMTP delivery with verified TLS; email codes never enter application logs."""
import asyncio
import smtplib
import ssl
from email.message import EmailMessage

from src.bot.config import settings


def recovery_email_configured() -> bool:
    return bool(settings.smtp_host and settings.smtp_from)


def _send_message(email: str, subject: str, content: str) -> None:
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.smtp_from
    message["To"] = email
    message.set_content(content)
    context = ssl.create_default_context()
    smtp_class = smtplib.SMTP_SSL if settings.smtp_security == "ssl" else smtplib.SMTP
    kwargs = {"context": context} if settings.smtp_security == "ssl" else {}
    with smtp_class(settings.smtp_host, settings.smtp_port, timeout=15, **kwargs) as smtp:
        if settings.smtp_security == "starttls":
            smtp.starttls(context=context)
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password.get_secret_value())
        smtp.send_message(message)


def _send_reset_code(email: str, code: str) -> None:
    _send_message(email, "Код восстановления пароля — ТАРЕЛКА",
        f"Ваш код восстановления пароля: {code}\n\n"
        "Введите его в приложении ТАРЕЛКА и задайте новый пароль. "
        "Код действует 10 минут и подходит только для одного восстановления.\n\n"
        "Если вы не запрашивали смену пароля, просто проигнорируйте это письмо. "
        "Ваш пароль останется прежним. Никому не сообщайте код.\n"
    )


async def send_reset_code(email: str, code: str) -> None:
    await asyncio.to_thread(_send_reset_code, email, code)


async def send_registration_code(email: str, code: str) -> None:
    await asyncio.to_thread(_send_message, email, "Подтвердите почту — ТАРЕЛКА",
        f"Ваш код подтверждения почты: {code}\n\n"
        "Введите его в приложении ТАРЕЛКА, чтобы завершить регистрацию. "
        "Код действует 10 минут и подходит только для одной регистрации.\n\n"
        "Если вы не регистрировались в ТАРЕЛКЕ, проигнорируйте это письмо. "
        "Аккаунт без подтверждения не будет создан. Никому не сообщайте код.\n")
