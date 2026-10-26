import pytest
from escrow.chain import LocalLedger, ETH
from escrow.identity import Identity
from escrow.protocol import Party, propose, countersign, deliver, accept, export_bundle, import_bundle
from escrow.store import Store
from escrow.crypto import sha256_bytes, sign
from pathlib import Path


@pytest.fixture(scope="session")
def identities():
    return Identity.create("alice"), Identity.create("bob"), Identity.create("carol")


@pytest.fixture
def world(tmp_path, identities):
    clock = [1_800_000_000]
    parties = [Party(i, Store(tmp_path / i.name), lambda: clock[0]) for i in identities]
    chain = LocalLedger(tmp_path / "ledger.json", min_lock=60, clock=lambda: clock[0])
    chain.deposit(identities[0].evm_address, identities[0].key_hash, 5 * ETH, 3600)
    return *parties, chain, clock


def exchange(source, target, record):
    return import_bundle(target, export_bundle(record))


def happy(alice, bob, amount=ETH, expected=None, decision="release", payload=b"delivered evidence"):
    r = propose(alice, bob.identity.public(), amount, "Design delivery", alice.now() + 600, expected)
    exchange(alice, bob, r)
    r = countersign(bob, r.escrow_id)
    exchange(bob, alice, r)
    r = deliver(bob, r.escrow_id, payload, "design.txt")
    exchange(bob, alice, r)
    if decision:
        r = accept(alice, r.escrow_id, decision)
        exchange(alice, bob, r)
    return r


def legacy_delivery(seller, escrow_id, payload=b"design file content"):
    """Represent an already-signed mismatched delivery from before upload enforcement."""
    record = seller.store.get(escrow_id)
    path = seller.store.vault / escrow_id / 'payload'
    path.parent.mkdir(exist_ok=True)
    path.write_bytes(payload)
    record.payload_path = str(path.resolve())
    record.delivery = dict(escrow_id=escrow_id, sha256=sha256_bytes(payload), size=len(payload),
                           filename='legacy.txt', delivered_at=seller.now())
    record.signatures['delivery'] = sign(seller.identity.secret_key, record.delivery, 'delivery')
    seller.store.put(record, 'delivered')
    return record
