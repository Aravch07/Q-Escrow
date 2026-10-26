"""Demo key envelope: scrypt + SHAKE-256 stream + HMAC-SHA256, encrypt then MAC.

This custom construction is deliberately explicit to meet the no-extra-dependency
constraint. It is not an audited general-purpose encryption format.
"""
import hashlib
import hmac
import secrets
from escrow.crypto import b64, unb64, canonical_json


def derive(password, salt, length=32):
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1,
                          dklen=length, maxmem=64 * 1024 * 1024)


def password_hash(password, salt):
    return derive(password, b"PQE-password-v1/" + salt)


def seal(secret, password):
    salt, nonce = secrets.token_bytes(16), secrets.token_bytes(32)
    keys = derive(password, b"PQE-key-envelope-v1/" + salt, 64)
    stream = hashlib.shake_256(b"PQE-stream-v1/" + keys[:32] + nonce).digest(len(secret))
    cipher = bytes(a ^ b for a, b in zip(secret, stream))
    envelope = dict(version=1, salt=b64(salt), nonce=b64(nonce), ciphertext=b64(cipher))
    envelope["tag"] = b64(hmac.digest(keys[32:], canonical_json(envelope), "sha256"))
    return envelope


def unseal(envelope, password):
    if set(envelope) != {"version", "salt", "nonce", "ciphertext", "tag"} or envelope["version"] != 1:
        raise ValueError("Unsupported encrypted key envelope")
    salt, nonce, cipher = (unb64(envelope[k]) for k in ("salt", "nonce", "ciphertext"))
    if len(salt) != 16 or len(nonce) != 32 or len(cipher) != 4032:
        raise ValueError("Invalid encrypted signing key")
    keys = derive(password, b"PQE-key-envelope-v1/" + salt, 64)
    authenticated = {k: v for k, v in envelope.items() if k != "tag"}
    expected = hmac.digest(keys[32:], canonical_json(authenticated), "sha256")
    if not hmac.compare_digest(expected, unb64(envelope["tag"])):
        raise ValueError("Encrypted signing key authentication failed")
    # The tag is checked BEFORE the keystream is produced or plaintext is recovered.
    stream = hashlib.shake_256(b"PQE-stream-v1/" + keys[:32] + nonce).digest(len(cipher))
    return bytes(a ^ b for a, b in zip(cipher, stream))
