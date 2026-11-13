"""Encryption of the vendor API key at rest, with AES-GCM.

The key that encrypts it is `LLM_SECRET_KEY` (32 bytes, base64) when set, and otherwise
derived from `SECRET_KEY`. Changing either makes the stored API key unreadable: an
administrator then enters it again.
"""

import base64
import hashlib

from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes
from django.conf import settings

_NONCE_BYTES = 12
_TAG_BYTES = 16
_VERSION = "v1"


class UndecryptableSecret(Exception):
    """The stored value was encrypted with another key, or was changed."""


def _key() -> bytes:
    if settings.LLM_SECRET_KEY:
        key = base64.b64decode(settings.LLM_SECRET_KEY)
        if len(key) != 32:
            raise ValueError("LLM_SECRET_KEY must be 32 bytes, base64-encoded")
        return key
    return hashlib.sha256(f"ezd-llm-api-key:{settings.SECRET_KEY}".encode()).digest()


def encrypt(plaintext: str) -> str:
    cipher = AES.new(_key(), AES.MODE_GCM, nonce=get_random_bytes(_NONCE_BYTES))
    ciphertext, tag = cipher.encrypt_and_digest(plaintext.encode())
    blob = base64.b64encode(cipher.nonce + tag + ciphertext).decode()
    return f"{_VERSION}:{blob}"


def decrypt(token: str) -> str:
    version, _, blob = token.partition(":")
    if version != _VERSION:
        raise UndecryptableSecret()
    raw = base64.b64decode(blob)
    nonce, tag, ciphertext = (
        raw[:_NONCE_BYTES],
        raw[_NONCE_BYTES : _NONCE_BYTES + _TAG_BYTES],
        raw[_NONCE_BYTES + _TAG_BYTES :],
    )
    cipher = AES.new(_key(), AES.MODE_GCM, nonce=nonce)
    try:
        return cipher.decrypt_and_verify(ciphertext, tag).decode()
    except ValueError as error:
        raise UndecryptableSecret() from error
