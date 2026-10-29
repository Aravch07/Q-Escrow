import copy
import pytest
from escrow.chain import ETH, LocalLedger
from escrow.crypto import sign
from escrow.protocol import cancel, propose, countersign, deliver, accept, export_bundle, import_bundle, record_from_bundle
from escrow.reconcile import verify_offline, reconcile
from conftest import exchange


@pytest.mark.parametrize('role', ['buyer', 'seller'])
@pytest.mark.parametrize('stage', ['proposed', 'signed', 'delivered', 'approved'])
def test_either_party_cancels_without_expiry_or_payment(world, role, stage):
    a, b, outsider, chain, clock = world
    r = propose(a, b.identity.public(), ETH, 'Cancelable work', a.now() + 3600)
    exchange(a, b, r)
    if stage != 'proposed':
        r = countersign(b, r.escrow_id); exchange(b, a, r)
    if stage in ('delivered', 'approved'):
        r = deliver(b, r.escrow_id, b'final content'); exchange(b, a, r)
    if stage == 'approved':
        r = accept(a, r.escrow_id, 'release'); exchange(a, b, r)
    original = export_bundle(r)
    with pytest.raises(ValueError, match='Only the two parties'):
        import_bundle(outsider, original)
    outsider.store.put(r)
    with pytest.raises(ValueError, match='Only the buyer or seller'):
        cancel(outsider, r.escrow_id)
    actor, other = (a, b) if role == 'buyer' else (b, a)
    before = chain.account(a.identity.evm_address)
    r = cancel(actor, r.escrow_id); exchange(actor, other, r)
    assert r.state == 'CANCELLED' and r.cancellation['cancelled_by'] == role
    assert verify_offline(r, clock[0]).outcome == 'CANCELLED'
    assert reconcile(actor, chain, r.escrow_id)[0]['outcome'] == 'CANCELLED'
    assert chain.account(a.identity.evm_address) == before
    assert chain.account(b.identity.evm_address)['claimable'] == 0
    assert chain.seq_used(a.identity.evm_address, r.terms['seq'])
    assert chain.settlement(r.escrow_id)['outcome'] == 'CANCELLED'
    assert import_bundle(other, original).state == 'CANCELLED'
    with pytest.raises(ValueError, match='already final'):
        deliver(b, r.escrow_id, b'late upload')
    with pytest.raises(ValueError, match='already final'):
        accept(a, r.escrow_id, 'release')


def test_cancellation_signature_roundtrip_and_tampering(world):
    a, b, outsider, _, clock = world
    r = propose(a, b.identity.public(), ETH, 'Signed cancellation', a.now() + 600)
    exchange(a, b, r)
    r = cancel(b, r.escrow_id)
    bundle = export_bundle(r)
    assert record_from_bundle(bundle)[0].cancellation == r.cancellation
    for field, value in [('cancelled_by', 'buyer'), ('escrow_id', 'a' * 64), ('cancelled_at', a.now() + 1)]:
        bad = copy.deepcopy(bundle); bad['cancellation'][field] = value
        with pytest.raises(ValueError): record_from_bundle(bad)
    bad = copy.deepcopy(bundle); del bad['cancellation']
    with pytest.raises(ValueError): record_from_bundle(bad)
    r.cancellation['cancelled_at'] += 1
    r.signatures['cancellation'] = sign(b.identity.secret_key, r.cancellation, 'cancellation')
    assert verify_offline(r, clock[0]).outcome == 'REJECT'


def test_unfunded_proposal_can_be_cancelled(world, tmp_path):
    a, b, _, _, _ = world
    chain = LocalLedger(tmp_path / 'empty-ledger.json', min_lock=60, clock=a.clock)
    r = propose(a, b.identity.public(), ETH, 'No deposit yet', a.now() + 600)
    cancel(a, r.escrow_id)
    assert reconcile(a, chain, r.escrow_id)[0]['outcome'] == 'CANCELLED'
    assert chain.account(a.identity.evm_address)['balance'] == 0


def test_settled_payment_cannot_be_cancelled(world):
    from conftest import happy
    a, b, _, chain, _ = world
    r = happy(a, b); reconcile(a, chain)
    with pytest.raises(ValueError, match='already final'): cancel(a, r.escrow_id)
    # A separately signed cancellation cannot overwrite a settled recipient copy.
    r = cancel(b, r.escrow_id)
    with pytest.raises(ValueError, match='settled agreement'): import_bundle(a, export_bundle(r))
