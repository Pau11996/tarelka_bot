import logging
from pathlib import Path

from src.shared.logging_config import setup_logging


def _reset_root_logging() -> None:
    root = logging.getLogger()
    for handler in root.handlers[:]:
        root.removeHandler(handler)
        handler.close()


def test_setup_logging_writes_to_service_dir(tmp_path: Path, monkeypatch) -> None:
    _reset_root_logging()
    monkeypatch.setenv("LOG_DIR", str(tmp_path))

    log_file = setup_logging("bot")
    assert log_file == tmp_path / "bot" / "app.log"

    logging.getLogger("test.bot").info("hello bot")
    assert "hello bot" in log_file.read_text(encoding="utf-8")


def test_setup_logging_separates_services(tmp_path: Path, monkeypatch) -> None:
    _reset_root_logging()
    monkeypatch.setenv("LOG_DIR", str(tmp_path))

    bot_log = setup_logging("bot")
    _reset_root_logging()
    analyzer_log = setup_logging("ai_analyzer")

    assert bot_log == tmp_path / "bot" / "app.log"
    assert analyzer_log == tmp_path / "ai_analyzer" / "app.log"
