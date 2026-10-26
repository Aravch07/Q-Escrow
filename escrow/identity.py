import json
import os
import re
import secrets
from dataclasses import dataclass
from pathlib import Path
from .crypto import b64, unb64, keygen, key_hash


def address(value):
    if not isinstance(value, str) or not re.fullmatch(r"0x[0-9a-fA-F]{40}", value):
        raise ValueError("Use a 20-byte EVM address starting with 0x")
    if value.lower() == "0x" + "0" * 40:
        raise ValueError("The zero EVM address cannot be an escrow party")
    return value.lower()


@dataclass
class Identity:
    name: str
    evm_address: str
    public_key: bytes
    secret_key: bytes | None = None

    @classmethod
    def create(cls, name, evm_address=None):
        pk, sk = keygen()
        return cls(name, address(evm_address or "0x" + secrets.token_hex(20)), pk, sk)

    @property
    def key_hash(self):
        return key_hash(self.public_key)

    def descriptor(self):
        return dict(name=self.name, evm_address=self.evm_address,
                    public_key=b64(self.public_key), key_hash=self.key_hash)

    def public(self):
        return Identity(self.name, self.evm_address, self.public_key)

    def save(self, path):
        """CLI ONLY: plaintext private identity. POSIX mode 0600; use Windows ACLs too."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump({**self.descriptor(), "secret_key": b64(self.secret_key)
                       if self.secret_key else None}, stream)
        path.chmod(0o600)

    @classmethod
    def load(cls, path):
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls(data["name"], address(data["evm_address"]), unb64(data["public_key"]),
                   unb64(data["secret_key"]) if data.get("secret_key") else None)
