import json
import re
import secrets
import time
from dataclasses import dataclass
from pathlib import Path
from .crypto import canonical_json, sha256_bytes, sha256_file, key_hash, sign, verify, unb64
from .identity import Identity, address
from .models import Record
from .store import Store

MAX_PAYLOAD = 25 * 1024 * 1024
HEX = re.compile(r"[0-9a-f]{64}")
UINT_MAX = 2**256 - 1


@dataclass
class Party:
    identity: Identity
    store: Store
    clock: object = time.time

    def now(self):
        return int(self.clock())


def filename(value):
    # Display metadata only: the storage path is always vault/<id>/payload.
    value = re.split(r"[/\\]", str(value))[-1]
    value = re.sub(r"[^\w. ()-]", "_", value, flags=re.ASCII).strip(" .")[:120]
    return value or "delivery.bin"


def _integer(value, label, minimum=0, maximum=UINT_MAX):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f"Invalid {label}")


def validate_terms(terms):
    required = {"version", "nonce", "buyer", "seller", "amount_wei", "seq", "description", "created_at", "expires_at"}
    if not isinstance(terms, dict) or not required <= terms.keys() or terms.keys() - required - {"expected_sha256"}:
        raise ValueError("Invalid terms structure")
    if terms["version"] != 1 or type(terms["version"]) is not int:
        raise ValueError("Unsupported terms version")
    if not isinstance(terms["nonce"], str) or not re.fullmatch(r"[0-9a-f]{32}", terms["nonce"]):
        raise ValueError("Invalid nonce")
    for role in ("buyer", "seller"):
        person = terms[role]
        if not isinstance(person, dict) or set(person) != {"name", "evm_address", "public_key", "key_hash"}:
            raise ValueError("Invalid party descriptor")
        if not isinstance(person["name"], str) or not 1 <= len(person["name"]) <= 80:
            raise ValueError("Invalid party name")
        if address(person["evm_address"]) != person["evm_address"]:
            raise ValueError("Party address must be lower case")
        pk = unb64(person["public_key"])
        if len(pk) != 1952 or key_hash(pk) != person["key_hash"]:
            raise ValueError(f"{role} public-key hash does not match")
    if terms["buyer"]["evm_address"] == terms["seller"]["evm_address"]:
        raise ValueError("Buyer and seller must be different")
    value = terms["amount_wei"]
    if not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]{0,77}", value) or int(value) > UINT_MAX:
        raise ValueError("Amount must be a positive uint256 wei string")
    _integer(terms["seq"], "sequence number", 1, 2**63 - 2)
    _integer(terms["created_at"], "created_at", 0, 2**53 - 1)
    _integer(terms["expires_at"], "expires_at", terms["created_at"] + 1, 2**53 - 1)
    if not isinstance(terms["description"], str) or not 1 <= len(terms["description"].strip()) <= 2000:
        raise ValueError("Describe the agreement in 1–2000 characters")
    if terms.get("expected_sha256") is not None and not HEX.fullmatch(str(terms["expected_sha256"])):
        raise ValueError("Expected SHA-256 must be 64 lower-case hexadecimal characters")


def verify_signatures(record):
    """Strict structure plus every present signature. Raises before any import is persisted."""
    t, s = record.terms, record.signatures
    validate_terms(t)
    if sha256_bytes(canonical_json(t)) != record.escrow_id:
        raise ValueError("Terms do not match escrow_id")
    if not isinstance(s, dict) or set(s) - {"buyer", "seller", "delivery", "acceptance"} or not s.get("buyer"):
        raise ValueError("Buyer terms signature is required")
    for purpose, role in (("buyer", "buyer"), ("seller", "seller")):
        if purpose in s and not verify(unb64(t[role]["public_key"]), t, s[purpose], purpose):
            raise ValueError(f"Invalid {purpose} terms signature")
    d = record.delivery
    if bool(d is not None) != bool(s.get("delivery")):
        raise ValueError("Delivery and its signature must occur together")
    if d is not None:
        if not s.get("seller") or not isinstance(d, dict) or set(d) != {"escrow_id", "sha256", "size", "filename", "delivered_at"}:
            raise ValueError("Invalid delivery structure or missing seller terms signature")
        if d["escrow_id"] != record.escrow_id or not isinstance(d["sha256"], str) or not HEX.fullmatch(d["sha256"]):
            raise ValueError("Delivery references the wrong escrow or hash")
        _integer(d["size"], "delivery size", 0, MAX_PAYLOAD)
        _integer(d["delivered_at"], "delivered_at", t["created_at"], 2**53 - 1)
        if not isinstance(d["filename"], str) or not 1 <= len(d["filename"]) <= 255:
            raise ValueError("Invalid delivery filename")
        if not verify(unb64(t["seller"]["public_key"]), d, s["delivery"], "delivery"):
            raise ValueError("Invalid delivery signature")
    a = record.acceptance
    if bool(a is not None) != bool(s.get("acceptance")):
        raise ValueError("Decision and its signature must occur together")
    if a is not None:
        if not d or not isinstance(a, dict) or set(a) != {"escrow_id", "decision", "sha256", "delivery_signature_sha256", "accepted_at"}:
            raise ValueError("Invalid acceptance structure")
        if a["escrow_id"] != record.escrow_id or a["decision"] not in ("release", "refund"):
            raise ValueError("Invalid acceptance decision or escrow")
        if a["sha256"] != d["sha256"] or a["delivery_signature_sha256"] != sha256_bytes(unb64(s["delivery"])):
            raise ValueError("Acceptance does not bind to this exact delivery signature and hash")
        _integer(a["accepted_at"], "accepted_at", d["delivered_at"], 2**53 - 1)
        if not verify(unb64(t["buyer"]["public_key"]), a, s["acceptance"], "acceptance"):
            raise ValueError("Invalid acceptance signature")
    return True


def _role(party, record, role):
    expected = record.terms[role]
    if party.identity.descriptor() != expected:
        raise ValueError(f"Only the {role} can perform this action")
    if record.settlement or record.rejection:
        raise ValueError("This escrow is already final")
    verify_signatures(record)


def propose(party, seller, amount_wei, description, expires_at, expected_sha256=None):
    terms = dict(version=1, nonce=secrets.token_hex(16), buyer=party.identity.descriptor(),
                 seller=seller.descriptor() if isinstance(seller, Identity) else seller,
                 amount_wei=str(amount_wei), seq=party.store.next_seq(party.identity.key_hash),
                 description=description, created_at=party.now(), expires_at=expires_at)
    if expected_sha256:
        terms["expected_sha256"] = expected_sha256
    validate_terms(terms)
    record = Record(sha256_bytes(canonical_json(terms)), terms)
    record.signatures["buyer"] = sign(party.identity.secret_key, terms, "buyer")
    party.store.put(record, "proposed")
    return record


def countersign(party, escrow_id):
    with party.store.lock:
        r = party.store.get(escrow_id)
        _role(party, r, "seller")
        if r.state != "PROPOSED" or party.now() >= r.terms["expires_at"]:
            raise ValueError("Countersign only a proposed, unexpired escrow")
        r.signatures["seller"] = sign(party.identity.secret_key, r.terms, "seller")
        party.store.put(r, "countersigned")
        return r


def _payload_path(store, escrow_id):
    if not isinstance(escrow_id, str) or not HEX.fullmatch(escrow_id):
        raise ValueError("Invalid escrow ID")
    folder = store.vault / escrow_id
    folder.mkdir(exist_ok=True)
    return folder / "payload"


def deliver(party, escrow_id, source, display_name=None):
    with party.store.lock:
        r = party.store.get(escrow_id)
        _role(party, r, "seller")
        if r.state != "LOCKED":
            raise ValueError("Delivery requires countersigned terms and cannot be replaced")
        raw = source if isinstance(source, bytes) else Path(source).read_bytes()
        if len(raw) > MAX_PAYLOAD:
            raise ValueError("File exceeds the 25 MB upload limit")
        digest = sha256_bytes(raw)
        if r.terms.get("expected_sha256") and digest != r.terms["expected_sha256"]:
            raise ValueError("File does not match the agreed SHA-256 fingerprint. Choose the agreed file; no delivery was saved")
        path = _payload_path(party.store, escrow_id)
        path.write_bytes(raw)
        r.payload_path = str(path.resolve())
        r.delivery = dict(escrow_id=escrow_id, sha256=digest, size=len(raw),
                          filename=filename(display_name or (Path(source).name if not isinstance(source, bytes) else "delivery.bin")),
                          delivered_at=party.now())
        r.signatures["delivery"] = sign(party.identity.secret_key, r.delivery, "delivery")
        party.store.put(r, "delivered")
        return r


def accept(party, escrow_id, decision, received_file=None):
    with party.store.lock:
        r = party.store.get(escrow_id)
        _role(party, r, "buyer")
        if r.state != "DELIVERED" or decision not in ("release", "refund"):
            raise ValueError("A delivered escrow and release or refund decision are required")
        if decision == "release":
            if party.now() >= r.terms["expires_at"] or r.delivery["delivered_at"] >= r.terms["expires_at"]:
                raise ValueError("This escrow has expired; request a refund")
            path = received_file or r.payload_path
            if not path or sha256_file(path) != r.delivery["sha256"]:
                raise ValueError("Received file hash differs from the signed delivery receipt")
            if r.terms.get("expected_sha256") and sha256_file(path) != r.terms["expected_sha256"]:
                raise ValueError("Received file differs from the expected SHA-256; request a refund")
        r.acceptance = dict(escrow_id=escrow_id, decision=decision, sha256=r.delivery["sha256"],
                            delivery_signature_sha256=sha256_bytes(unb64(r.signatures["delivery"])),
                            accepted_at=party.now())
        r.signatures["acceptance"] = sign(party.identity.secret_key, r.acceptance, "acceptance")
        party.store.put(r, "decision_" + decision)
        return r


def export_bundle(record):
    return record.bundle()


def record_from_bundle(bundle):
    if isinstance(bundle, (bytes, str)):
        bundle = json.loads(bundle)
    if not isinstance(bundle, dict) or set(bundle) != {"format", "escrow_id", "terms", "signatures", "delivery", "acceptance", "payload"}:
        raise ValueError("Invalid signed bundle structure")
    if bundle["format"] != "PQE-v1":
        raise ValueError("Unsupported bundle format")
    r = Record(bundle["escrow_id"], bundle["terms"], dict(bundle["signatures"]), bundle["delivery"], bundle["acceptance"])
    verify_signatures(r)
    payload = unb64(bundle["payload"]) if bundle["payload"] is not None else None
    if r.delivery:
        if payload is None or len(payload) != r.delivery["size"] or sha256_bytes(payload) != r.delivery["sha256"]:
            raise ValueError("Payload hash or size differs from signed delivery receipt")
    elif payload is not None:
        raise ValueError("Payload without a signed delivery receipt")
    return r, payload


def import_bundle(party, bundle):
    r, raw = record_from_bundle(bundle)
    if party.identity.descriptor() not in (r.terms["buyer"], r.terms["seller"]):
        raise ValueError("Only the two parties can import this escrow")
    with party.store.lock:
        try:
            old = party.store.get(r.escrow_id)
        except ValueError:
            old = None
        if old:
            for purpose, signature in old.signatures.items():
                if purpose in r.signatures and signature != r.signatures[purpose]:
                    raise ValueError(f"Equivocation: conflicting {purpose} signature")
            if old.terms != r.terms:
                raise ValueError("Conflicting terms")
            for field in ("delivery", "acceptance"):
                before, after = getattr(old, field), getattr(r, field)
                if before is not None and after is not None and before != after:
                    raise ValueError(f"Equivocation: conflicting {field}")
                if after is None:
                    setattr(r, field, before)
            r.signatures = {**old.signatures, **r.signatures}
            r.payload_path, r.settlement, r.rejection = old.payload_path, old.settlement, old.rejection
        if raw is not None:
            path = _payload_path(party.store, r.escrow_id)
            path.write_bytes(raw)
            r.payload_path = str(path.resolve())
        verify_signatures(r)
        party.store.observe_seq(r.terms["buyer"]["key_hash"], r.terms["seq"])
        party.store.put(r, "bundle_imported")
        return r
