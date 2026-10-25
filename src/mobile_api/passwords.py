"""Versioned, salted password hashes using Python's OpenSSL-backed PBKDF2."""

import base64
import hashlib
import hmac
import secrets

ITERATIONS = 600_000


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS)
    return "$".join((
        "pbkdf2_sha256", str(ITERATIONS),
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(digest).decode("ascii"),
    ))


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, rounds, salt, expected = encoded.split("$")
        if algorithm != "pbkdf2_sha256" or not 1 <= int(rounds) <= 2_000_000:
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"),
            base64.b64decode(salt, validate=True), int(rounds),
        )
        return hmac.compare_digest(digest, base64.b64decode(expected, validate=True))
    except (ValueError, TypeError):
        return False


# Unknown addresses still perform the same expensive verification as existing accounts.
DUMMY_HASH = hash_password(secrets.token_urlsafe(32))
