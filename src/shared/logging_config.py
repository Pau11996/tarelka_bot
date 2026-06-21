from __future__ import annotations

import logging
import os
from pathlib import Path

LOG_FORMAT = "%(asctime)s %(levelname)s [%(name)s] %(message)s"
LOG_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"
DEFAULT_LOG_DIR = Path("/opt/logs")


def setup_logging(service: str, *, level: int = logging.INFO) -> Path | None:
    log_dir = Path(os.environ.get("LOG_DIR", DEFAULT_LOG_DIR)) / service
    formatter = logging.Formatter(LOG_FORMAT, datefmt=LOG_DATE_FORMAT)

    root = logging.getLogger()
    if root.handlers:
        return log_dir / "app.log" if log_dir.exists() else None

    root.setLevel(level)

    console = logging.StreamHandler()
    console.setFormatter(formatter)
    root.addHandler(console)

    log_file: Path | None = None
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        log_file = log_dir / "app.log"
        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setFormatter(formatter)
        root.addHandler(file_handler)
    except OSError:
        logging.getLogger(__name__).warning(
            "Could not write logs to %s, using console only",
            log_dir,
        )

    return log_file
