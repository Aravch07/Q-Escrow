"""Relayer policy. Offline verification never changes a record or contacts a chain."""
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path
from .crypto import canonical_json, sha256_bytes, sha256_file
from .protocol import verify_signatures, export_bundle, record_from_bundle


@dataclass
class Verdict:
    outcome: str
    reason: str
    checks: list = field(default_factory=list)

    def asdict(self):
        return asdict(self)


def verify_offline(record, now):
    checks = []

    def check(label, ok, detail):
        checks.append(dict(label=label, ok=ok, detail=detail))

    try:
        verify_signatures(record)
        check("Structure and signature contexts", True, "Every present signature and embedded key hash verifies")
    except (ValueError, TypeError, KeyError, OverflowError) as exc:
        check("Structure and signature contexts", False, str(exc))
        return Verdict("REJECT", str(exc), checks)
    t, d, a = record.terms, record.delivery, record.acceptance
    if record.cancellation:
        c = record.cancellation
        if c["cancelled_at"] > now:
            return Verdict("REJECT", "Cancellation is dated in the future", checks)
        check("Signed cancellation", True, "Cancelled by the " + c["cancelled_by"])
        return Verdict("CANCELLED", "Agreement cancelled by the " + c["cancelled_by"], checks)
    if t["created_at"] > now or (d and d["delivered_at"] > now) or (a and a["accepted_at"] > now):
        check("Clock", False, "Signed artifact is dated in the future")
        return Verdict("REJECT", "Signed artifact is dated in the future", checks)
    if not d:
        expired = now >= t["expires_at"]
        check("Delivery deadline", True, "No delivery; expired" if expired else "Waiting for delivery before expiry")
        return Verdict("REFUND" if expired else "HOLD", "No delivery before expiry" if expired else "Waiting for delivery", checks)
    try:
        ok = bool(record.payload_path and Path(record.payload_path).is_file()
                  and Path(record.payload_path).stat().st_size == d["size"]
                  and sha256_file(record.payload_path) == d["sha256"])
    except OSError:
        ok = False
    check("Payload integrity", ok, "Stored file hash matches the signed receipt" if ok else "Stored payload hash or size differs from receipt")
    if not ok:
        return Verdict("REJECT", "Stored payload hash or size differs from signed receipt", checks)
    expected = not t.get("expected_sha256") or t["expected_sha256"] == d["sha256"]
    check("Expected SHA-256", expected, "Expected content matches or was unspecified" if expected else "Delivery differs from agreed expected hash")
    if not expected:
        return Verdict("REFUND", "Expected SHA-256 mismatch", checks)
    timely = d["delivered_at"] < t["expires_at"]
    check("Delivery deadline", timely, "Delivered before expiry" if timely else "Delivered at or after expiry")
    if not timely:
        return Verdict("REFUND", "Delivery after expiry", checks)
    if not a:
        return Verdict("REFUND" if now >= t["expires_at"] else "HOLD",
                       "No decision before expiry" if now >= t["expires_at"] else "Waiting for buyer decision", checks)
    if a["decision"] == "refund" or a["accepted_at"] >= t["expires_at"]:
        return Verdict("REFUND", "Buyer requested refund" if a["decision"] == "refund" else "Decision after expiry", checks)
    check("Decision binds exact receipt", True, "Buyer signed the receipt hash and delivery-signature hash")
    return Verdict("RELEASE", "Buyer accepted verified delivery", checks)


def reconcile(party, chain, escrow_id=None):
    """Strict core replay behavior; the website separately mirrors confirmed peer settlements."""
    with party.store.lock:
        all_pending = [r for r in party.store.all() if not r.settlement and not r.rejection]
        pending = [r for r in all_pending if escrow_id is None or r.escrow_id == escrow_id]
        counts = Counter((r.terms["buyer"]["evm_address"], r.terms["seq"]) for r in all_pending)
        results = []
        for r in sorted(pending, key=lambda r: (r.terms["buyer"]["evm_address"], r.terms["seq"], r.escrow_id)):
            t = r.terms
            verdict = verify_offline(r, party.now())
            if counts[(t["buyer"]["evm_address"], t["seq"])] > 1:
                verdict = Verdict("REJECT", "Local same-seq conflict: both escrows require manual review", verdict.checks)
            elif verdict.outcome != "REJECT":
                if chain.settlement(r.escrow_id):
                    verdict = Verdict("REJECT", "Replay: escrow already settled", verdict.checks)
                elif chain.seq_used(t["buyer"]["evm_address"], t["seq"]):
                    verdict = Verdict("REJECT", "Double spend: sequence already used", verdict.checks)
                else:
                    account = chain.account(t["buyer"]["evm_address"])
                    if account["keyHash"] != t["buyer"]["key_hash"] and not (r.cancellation and account["keyHash"] in ("", "0" * 64)):
                        verdict = Verdict("REJECT", "Buyer key not registered or mismatched", verdict.checks)
                    elif verdict.outcome == "RELEASE" and account["balance"] < int(t["amount_wei"]):
                        verdict = Verdict("REJECT", "Insufficient escrow balance", verdict.checks)
            if verdict.outcome in ("RELEASE", "REFUND", "CANCELLED"):
                try:
                    bundle = export_bundle(r)
                    # Verify the exact byte snapshot committed to the evidence hash.
                    # A file changed between the earlier streaming check and export
                    # must not become unverified settlement evidence.
                    record_from_bundle(bundle)
                    evidence = sha256_bytes(canonical_json(bundle))
                    if r.cancellation and hasattr(chain, "cancel"):
                        r.settlement = chain.cancel(r.escrow_id, t["buyer"]["evm_address"], t["seller"]["evm_address"],
                                                    int(t["amount_wei"]), t["seq"], t["buyer"]["key_hash"], evidence)
                    else:
                        r.settlement = chain.settle(r.escrow_id, t["buyer"]["evm_address"], t["seller"]["evm_address"],
                                                int(t["amount_wei"]), t["seq"], t["buyer"]["key_hash"],
                                                verdict.outcome == "RELEASE", evidence)
                    party.store.put(r, "settled_" + r.settlement["note"])
                except ValueError as exc:
                    verdict = Verdict("REJECT", str(exc), verdict.checks)
            if verdict.outcome == "REJECT":
                r.rejection = verdict.reason
                party.store.put(r, "rejected")
            elif verdict.outcome == "HOLD":
                party.store.log("reconcile_hold", r.escrow_id, {"reason": verdict.reason})
            results.append({"escrow_id": r.escrow_id, **verdict.asdict()})
        return results
