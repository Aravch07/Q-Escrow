"""Real verification experiments on disposable signed records and local ledgers."""
import copy
import tempfile
from pathlib import Path

from escrow.chain import ETH, LocalLedger
from escrow.crypto import b64, unb64, sha256_bytes, sha256_file, canonical_json
from escrow.identity import Identity
from escrow.protocol import Party, propose, countersign, deliver, accept, export_bundle, import_bundle, MAX_PAYLOAD
from escrow.reconcile import verify_offline, reconcile
from escrow.store import Store


def number(options, key, default, low, high):
    value = options.get(key, default)
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f"{key} must be a whole number from {low} to {high}")
    return value


def fixture(root, now, buyer_identity=None, seller_identity=None, index=0):
    buyer = Party(buyer_identity or Identity.create("practice_buyer"), Store(root / f"buyer-{index}"), now)
    seller = Party(seller_identity or Identity.create("practice_seller"), Store(root / f"seller-{index}"), now)
    raw = b"PQ-Escrow practice delivery. These bytes are signed evidence.\n"
    record = propose(buyer, seller.identity.public(), ETH, "Signed practice delivery", now() + 3600, sha256_bytes(raw))
    import_bundle(seller, export_bundle(record))
    countersign(seller, record.escrow_id)
    record = deliver(seller, record.escrow_id, raw, "practice-delivery.txt")
    import_bundle(buyer, export_bundle(record))
    record = accept(buyer, record.escrow_id, "release")
    return buyer, seller, record


def run_attack(app, party, kind, escrow_id=None, options=None):
    if kind not in ("file", "signature", "price", "replay", "double-spend"):
        raise ValueError("Choose file, signature, price, replay or double-spend")
    if options is None:
        options = {}
    if not isinstance(options, dict):
        raise ValueError("Attack settings must be an object")
    # Freeze time within each experiment so comparisons use the same instant.
    instant = app.now()
    now = lambda: instant
    with tempfile.TemporaryDirectory(prefix="pqe-lab-") as tmp:
        root = Path(tmp)
        if kind in ("file", "signature", "price"):
            if escrow_id:
                original = app.record(party, escrow_id)
                if not original.delivery or not original.payload_path:
                    raise ValueError("Choose an agreement with a delivered file, or use the practice example")
                record = copy.deepcopy(original)
                path = root / "selected-payload"
                path.write_bytes(Path(original.payload_path).read_bytes())
                record.payload_path = str(path)
                source = f"Your agreement: {record.terms['description']}"
            else:
                _, _, record = fixture(root, now)
                path = Path(record.payload_path)
                source = "Signed practice example"
            baseline = verify_offline(record, instant)
            if baseline.outcome == "REJECT":
                raise ValueError("The original evidence already fails verification. Choose another agreement or the practice example")
            changes = []
            if kind == "file":
                raw = bytearray(path.read_bytes())
                offset = number(options, "offset", 0, 0, MAX_PAYLOAD - 1)
                if raw and offset >= len(raw):
                    raise ValueError(f"Byte position must be between 0 and {len(raw) - 1} for this file")
                if not raw and offset:
                    raise ValueError("Use byte position 0 for an empty file")
                before = sha256_bytes(raw)
                old_byte = f"{raw[offset]:02x}" if raw else "empty"
                if raw:
                    raw[offset] ^= 1
                else:
                    raw.append(1)
                path.write_bytes(raw)
                changes = [dict(label=f"Byte {offset} (hex)", before=old_byte, after=f"{raw[offset]:02x}"),
                           dict(label="File SHA-256", before=before, after=sha256_file(path))]
                mutation = f"Flipped one bit at byte {offset}; the signed receipt was left unchanged."
            elif kind == "signature":
                raw = bytearray(unb64(record.signatures["delivery"]))
                position = number(options, "signature_byte", len(raw) - 1, 0, len(raw) - 1)
                before = sha256_bytes(raw)
                raw[position] ^= 1
                record.signatures["delivery"] = b64(raw)
                changes = [dict(label="Delivery signature SHA-256", before=before, after=sha256_bytes(raw))]
                mutation = f"Changed byte {position} of the delivery signature without the signing key."
            else:
                multiplier = number(options, "multiplier", 100, 2, 1000)
                before = record.terms["amount_wei"]
                record.terms["amount_wei"] = str(int(before) * multiplier)
                changes = [dict(label="Price in wei", before=before, after=record.terms["amount_wei"]),
                           dict(label="Terms SHA-256", before=record.escrow_id, after=sha256_bytes(canonical_json(record.terms)))]
                mutation = f"Multiplied the price by {multiplier} while keeping the original signatures and agreement ID."
            verdict = verify_offline(record, instant)
            blocked = verdict.outcome == "REJECT"
            return dict(kind=kind, blocked=blocked, check=verdict.reason, outcome=verdict.outcome, isolated=True,
                        source=source, changes=changes, before_checks=baseline.checks, after_checks=verdict.checks,
                        steps=[dict(title="Copy the original", detail=f"Original verdict: {baseline.outcome}. Real records stay untouched.", ok=True),
                               dict(title="Change the copy", detail=mutation, ok=True),
                               dict(title="Run the real verifier", detail=verdict.reason, ok=blocked)])

        # Ledger attacks use fully signed practice records and disposable accounts.
        count = number(options, "attempts" if kind == "replay" else "copies", 2, 2, 5 if kind == "replay" else 4)
        buyer, seller, record = fixture(root, now)
        ledger = LocalLedger(root / "ledger.json", min_lock=1, clock=now)
        ledger.deposit(buyer.identity.evm_address, buyer.identity.key_hash, 5 * ETH, 60)
        baseline = verify_offline(record, instant)
        before_balance = ledger.account(buyer.identity.evm_address)["balance"]
        result = reconcile(buyer, ledger)[0]
        if result["outcome"] != "RELEASE":
            raise ValueError("Practice setup could not settle its valid first payment")
        steps = [dict(title="Original payment accepted", detail="Valid signatures released 1 test ETH on the practice ledger.", ok=True)]
        refused = []
        if kind == "replay":
            settlement = ledger.settlement(record.escrow_id)
            for index in range(2, count + 1):
                try:
                    ledger.settle(settlement["escrow_id"], settlement["buyer"], settlement["seller"],
                                  int(settlement["amount_wei"]), settlement["seq"], settlement["buyer_key_hash"], True,
                                  settlement["evidence_hash"])
                except ValueError as exc:
                    refused.append(str(exc))
                    steps.append(dict(title=f"Attempt {index} blocked", detail=str(exc), ok=True))
                else:
                    steps.append(dict(title=f"Attempt {index} accepted unexpectedly", detail="The duplicate payment was not stopped.", ok=False))
            changes = [dict(label="Settlement attempts", before="1 valid payment", after=f"{count} submissions of the same agreement"),
                       dict(label="Seller earnings (wei)", before=str(ETH), after=str(ledger.account(seller.identity.evm_address)["claimable"]))]
            guard = "Single-use agreement ID"
        else:
            for index in range(2, count + 1):
                clone, _, cloned_record = fixture(root, now, buyer.identity, seller.identity, index)
                # Separate stores start at the same buyer sequence, like copied wallets.
                if cloned_record.terms["seq"] != record.terms["seq"]:
                    raise ValueError("Practice copies must share the same sequence")
                rejected = reconcile(clone, ledger)[0]
                ok = rejected["outcome"] == "REJECT"
                if ok:
                    refused.append(rejected["reason"])
                steps.append(dict(title=f"Device {index} {'blocked' if ok else 'accepted unexpectedly'}", detail=rejected["reason"], ok=ok))
            changes = [dict(label="Signed devices", before="1 device", after=f"{count} devices reuse sequence {record.terms['seq']}"),
                       dict(label="Buyer balance (wei)", before=str(before_balance), after=str(ledger.account(buyer.identity.evm_address)["balance"]))]
            guard = "Single-use buyer sequence"
        blocked = len(refused) == count - 1
        reason = refused[-1] if refused else "An extra payment was accepted unexpectedly"
        return dict(kind=kind, blocked=blocked, check=reason, outcome="REJECT" if blocked else "RELEASE", isolated=True,
                    source="Signed practice accounts and disposable ledger", changes=changes,
                    before_checks=baseline.checks,
                    after_checks=[dict(label=guard, ok=not blocked, detail=reason),
                                  dict(label="Only one payment credited", ok=ledger.account(seller.identity.evm_address)["claimable"] == ETH,
                                       detail="Seller has exactly 1 test ETH in practice earnings")], steps=steps)
