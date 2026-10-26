"""FIPS 204 ML-DSA-65 with explicit, per-purpose contexts."""
import base64
import hashlib
import json
from pathlib import Path
from dilithium_py.ml_dsa import ML_DSA_65

CONTEXTS = {
    "buyer": b"PQE-v1/terms/buyer",
    "seller": b"PQE-v1/terms/seller",
    "delivery": b"PQE-v1/delivery",
    "acceptance": b"PQE-v1/acceptance",
}


def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def b64(data):
    return base64.b64encode(data).decode("ascii")


def unb64(value):
    if not isinstance(value, str):
        raise ValueError("Expected base64 text")
    return base64.b64decode(value, validate=True)


def key_hash(public_key):
    return sha256_bytes(public_key)


def keygen():
    return ML_DSA_65.keygen()


def sign(secret_key, message, purpose):
    if secret_key is None:
        raise ValueError("Sign in again to unlock your signing key")
    return b64(ML_DSA_65.sign(secret_key, canonical_json(message), ctx=CONTEXTS[purpose]))


def verify(public_key, message, signature, purpose):
    try:
        return bool(ML_DSA_65.verify(public_key, canonical_json(message),
                                    unb64(signature), ctx=CONTEXTS[purpose]))
    except (ValueError, TypeError, IndexError, KeyError, OverflowError):
        return False
