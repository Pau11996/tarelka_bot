from src.ai_analyzer.openai_runner import format_openai_error


def test_format_openai_error_for_unsupported_region() -> None:
    message = format_openai_error(
        RuntimeError(
            "Error code: 403 - {'error': {'code': 'unsupported_country_region_territory'}}"
        )
    )
    assert "региона сервера" in message
    assert "OPENAI_HTTP_PROXY" in message


def test_format_openai_error_for_temperature() -> None:
    message = format_openai_error(
        RuntimeError(
            "Error code: 400 - {'error': {'param': 'temperature', 'code': 'unsupported_value'}}"
        )
    )
    assert "OPENAI_TEMPERATURE" in message
