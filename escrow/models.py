from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Record:
    escrow_id: str
    terms: dict
    signatures: dict = field(default_factory=dict)
    delivery: dict | None = None
    acceptance: dict | None = None
    payload_path: str | None = None
    settlement: dict | None = None
    rejection: str | None = None

    @property
    def state(self):
        if self.rejection:
            return "REJECTED"
        if self.settlement:
            return "SETTLED"
        if self.acceptance and self.signatures.get("acceptance"):
            return "ACCEPTED"
        if self.delivery and self.signatures.get("delivery"):
            return "DELIVERED"
        if self.signatures.get("seller"):
            return "LOCKED"
        return "PROPOSED"

    def bundle(self, include_payload=True):
        from .crypto import b64
        data = dict(format="PQE-v1", escrow_id=self.escrow_id, terms=self.terms,
                    signatures=self.signatures, delivery=self.delivery, acceptance=self.acceptance)
        if include_payload:
            data["payload"] = b64(Path(self.payload_path).read_bytes()) if self.payload_path else None
        return data
