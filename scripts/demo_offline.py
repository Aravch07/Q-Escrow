"""All six stages and a cloned-wallet sequence attack, using no network."""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from escrow.chain import LocalLedger, ETH
from escrow.identity import Identity
from escrow.protocol import Party, propose, countersign, deliver, accept, export_bundle, import_bundle
from escrow.reconcile import reconcile
from escrow.store import Store


def main():
    with tempfile.TemporaryDirectory(prefix="pq-escrow-demo-") as tmp:
        root = Path(tmp)
        now = lambda: 1_800_000_000
        alice = Party(Identity.create("Alice"), Store(root / "alice"), now)
        bob = Party(Identity.create("Bob"), Store(root / "bob"), now)
        # Same identity and initial counter, as if copied before either device spent.
        clone = Party(alice.identity, Store(root / "cloned-wallet"), now)
        ledger = LocalLedger(root / "ledger.json", min_lock=60, clock=now)
        ledger.deposit(alice.identity.evm_address, alice.identity.key_hash, ETH, 3600)
        print("1. Create escrow: buyer drafts terms backed by 1 test ETH.")
        r = propose(alice, bob.identity.public(), ETH, "Offline design delivery", now() + 600)
        import_bundle(bob, export_bundle(r))
        print("2. Authenticate: seller verifies and countersigns ML-DSA-65 terms.")
        r = countersign(bob, r.escrow_id)
        import_bundle(alice, export_bundle(r))
        print("3. Deliver and hash: seller signs the file receipt.")
        r = deliver(bob, r.escrow_id, b"Agreed artwork, carried over an offline peer link.", "artwork.txt")
        import_bundle(alice, export_bundle(r))
        print("4. Operate offline: buyer re-hashes received file and signs release.")
        r = accept(alice, r.escrow_id, "release")
        import_bundle(bob, export_bundle(r))
        print("5. Verify and reconcile: every signature, receipt binding and byte is checked.")
        result = reconcile(alice, ledger)[0]
        assert result["outcome"] == "RELEASE", result
        print("6. Blockchain settlement: LocalLedger applies the EVM contract rules.")
        print("   Evidence hash:", ledger.settlement(r.escrow_id)["evidence_hash"])
        # A second independent seller copy avoids conflating on-chain and local conflicts.
        bob_clone = Party(bob.identity, Store(root / "bob-peer-copy"), now)
        attack = propose(clone, bob.identity.public(), ETH, "Cloned wallet second promise", now() + 600)
        assert attack.terms["seq"] == r.terms["seq"]
        import_bundle(bob_clone, export_bundle(attack))
        attack = countersign(bob_clone, attack.escrow_id)
        attack = deliver(bob_clone, attack.escrow_id, b"Second delivery", "clone.txt")
        import_bundle(clone, export_bundle(attack))
        accept(clone, attack.escrow_id, "release")
        blocked = reconcile(clone, ledger)[0]
        assert blocked["outcome"] == "REJECT" and "sequence already used" in blocked["reason"]
        assert ledger.account(bob.identity.evm_address)["claimable"] == ETH
        assert alice.store.verify_log() and bob.store.verify_log()
        print("Double spend BLOCKED:", blocked["reason"])
        print("Bob claimable: 1 ETH")


if __name__ == "__main__":
    main()
