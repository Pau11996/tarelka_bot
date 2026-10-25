"""SMTP delivery with verified TLS; recovery secrets never enter application logs."""
import asyncio
import smtplib
import ssl
from email.message import EmailMessage

from src.bot.config import settings


def recovery_email_configured() -> bool:
    return bool(settings.smtp_host and settings.smtp_from)


def _send_reset_code(email: str, code: str) -> None:
    message = EmailMessage()
    message["Subject"] = "Код восстановления пароля — ТАРЕЛКА"
    message["From"] = settings.smtp_from
    message["To"] = email
    message.set_content(
        f"Ваш код восстановления пароля: {code}\n\n"
        "Введите его в приложении ТАРЕЛКА и задайте новый пароль. "
        "Код действует 10 минут и подходит только для одного восстановления.\n\n"
        "Если вы не запрашивали смену пароля, просто проигнорируйте это письмо. "
        "Ваш пароль останется прежним. Никому не сообщайте код.\n"
    )
    context = ssl.create_default_context()
    smtp_class = smtplib.SMTP_SSL if settings.smtp_security == "ssl" else smtplib.SMTP
    kwargs = {"context": context} if settings.smtp_security == "ssl" else {}
    with smtp_class(settings.smtp_host, settings.smtp_port, timeout=15, **kwargs) as smtp:
        if settings.smtp_security == "starttls":
            smtp.starttls(context=context)
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password.get_secret_value())
        smtp.send_message(message)


async def send_reset_code(email: str, code: str) -> None:
    await asyncio.to_thread(_send_reset_code, email, code)
