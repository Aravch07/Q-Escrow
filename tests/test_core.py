import copy
import json
import shutil
import sqlite3
from pathlib import Path
import pytest
from escrow.chain import LocalLedger, ETH
from escrow.crypto import canonical_json, sha256_bytes, sha256_file, sign, verify, b64, unb64
from escrow.protocol import (Party, propose, countersign, deliver, accept, export_bundle,
                             import_bundle, verify_signatures, record_from_bundle)
from escrow.reconcile import verify_offline, reconcile
from escrow.store import Store
from conftest import happy, exchange, legacy_delivery


def test_happy_path_and_evidence(world):
    a,b,_,chain,clock=world
    r=happy(a,b)
    assert r.state=='ACCEPTED'
    evidence=sha256_bytes(canonical_json(export_bundle(r)))
    assert verify_offline(r,clock[0]).outcome=='RELEASE'
    assert reconcile(a,chain)[0]['outcome']=='RELEASE'
    assert a.store.get(r.escrow_id).state=='SETTLED'
    assert chain.account(b.identity.evm_address)['claimable']==ETH
    assert chain.settlement(r.escrow_id)['evidence_hash']==evidence
    assert chain.settlement(r.escrow_id)['note']=='release'
    assert chain.claim(b.identity.evm_address)==ETH
    assert a.store.verify_log()


def test_copied_store_uses_its_own_payloads(world, tmp_path):
    a, b, _, _, _ = world
    record = happy(a, b)
    bundle = export_bundle(record)
    audit = a.store.audit()
    copied_root = tmp_path / "Desktop copy" / "alice"
    shutil.copytree(a.store.root, copied_root)
    copied_store = Store(copied_root)
    # The old workspace must have no influence on a copied delivery.
    Path(record.payload_path).write_bytes(b"old workspace changed")
    copied = copied_store.get(record.escrow_id)
    assert Path(copied.payload_path) == (copied_store.vault / record.escrow_id / "payload").resolve()
    assert export_bundle(copied) == bundle
    assert verify_offline(copied, a.now()).outcome == "RELEASE"
    assert copied_store.all()[0].payload_path == copied.payload_path
    assert copied_store.audit() == audit and copied_store.verify_log()


def test_copied_store_never_falls_back_to_old_payload(world, tmp_path):
    a, b, _, _, _ = world
    record = happy(a, b)
    copied_root = tmp_path / "copied-alice"
    shutil.copytree(a.store.root, copied_root)
    copied_store = Store(copied_root)
    (copied_store.vault / record.escrow_id / "payload").unlink()
    assert Path(record.payload_path).is_file()
    copied = copied_store.get(record.escrow_id)
    assert verify_offline(copied, a.now()).outcome == "REJECT"
    with pytest.raises(FileNotFoundError):
        export_bundle(copied)


@pytest.mark.parametrize('purpose',['buyer','seller','delivery','acceptance'])
def test_each_signature_tampered(world,purpose):
    a,b,_,_,_=world;r=happy(a,b)
    r.signatures[purpose]=b64(b'forged')
    assert verify_offline(r,a.now()).outcome=='REJECT'
    with pytest.raises(ValueError,match='signature'):
        record_from_bundle(export_bundle(r))


def test_terms_id_and_context_separation(world):
    a,b,_,_,_=world;r=happy(a,b)
    assert verify(a.identity.public_key,r.terms,r.signatures['buyer'],'buyer')
    assert not verify(a.identity.public_key,r.terms,r.signatures['buyer'],'seller')
    for purpose in ('delivery','acceptance'):
        assert not verify(a.identity.public_key,r.terms,r.signatures['buyer'],purpose)
    r.terms['amount_wei']=str(100*ETH)
    assert sha256_bytes(canonical_json(r.terms))!=r.escrow_id
    assert 'escrow_id' in verify_offline(r,a.now()).reason


def test_buyer_cannot_accept_altered_file(world,tmp_path):
    a,b,_,_,_=world;r=happy(a,b,decision=None)
    wrong=tmp_path/'wrong';wrong.write_bytes(b'other')
    with pytest.raises(ValueError,match='hash'):
        accept(a,r.escrow_id,'release',wrong)
    assert a.store.get(r.escrow_id).state=='DELIVERED'


def test_file_swapped_after_acceptance(world):
    a,b,_,chain,_=world;r=happy(a,b)
    Path(r.payload_path).write_bytes(b'swapped')
    assert reconcile(a,chain)[0]['outcome']=='REJECT'
    assert not chain.settlement(r.escrow_id)


def test_expected_mismatch_refunds(world):
    a,b,_,chain,_=world
    r=propose(a,b.identity.public(),ETH,'Legacy delivery',a.now()+600,'f'*64)
    exchange(a,b,r);countersign(b,r.escrow_id)
    r=legacy_delivery(b,r.escrow_id);exchange(b,a,r)
    with pytest.raises(ValueError,match='expected'):
        accept(a,r.escrow_id,'release')
    assert reconcile(a,chain)[0]['outcome']=='REFUND'
    assert chain.account(a.identity.evm_address)['balance']==5*ETH
    assert chain.seq_used(a.identity.evm_address,r.terms['seq'])


@pytest.mark.parametrize('source_kind',['bytes','path'])
def test_wrong_expected_file_never_saved_and_correct_retry_works(world,tmp_path,source_kind):
    a,b,_,chain,_=world;right=b'agreed exact bytes'
    r=propose(a,b.identity.public(),ETH,'Exact file',a.now()+600,sha256_bytes(right))
    exchange(a,b,r);countersign(b,r.escrow_id)
    before=b.store.audit();target=b.store.vault/r.escrow_id/'payload'
    source=b'wrong bytes'
    if source_kind=='path':
        source=tmp_path/'wrong.txt';source.write_bytes(b'wrong bytes')
    with pytest.raises(ValueError,match='does not match the agreed'):
        deliver(b,r.escrow_id,source,'same-name.txt')
    saved=b.store.get(r.escrow_id)
    assert saved.state=='LOCKED' and saved.delivery is None and 'delivery' not in saved.signatures
    assert not target.exists() and b.store.audit()==before
    assert chain.account(a.identity.evm_address)['balance']==5*ETH
    assert deliver(b,r.escrow_id,right,'different-name.txt').delivery['sha256']==sha256_bytes(right)


def test_hold_expiry_refund(world):
    a,b,_,chain,clock=world
    r=propose(a,b.identity,ETH,'Never delivered',clock[0]+10)
    assert reconcile(a,chain)[0]['outcome']=='HOLD'
    clock[0]+=10
    assert reconcile(a,chain)[0]['outcome']=='REFUND'
    assert chain.settlement(r.escrow_id)['note']=='refund'


def test_late_delivery_and_decision_refund(world):
    a,b,_,chain,clock=world;r=propose(a,b.identity,ETH,'Late',clock[0]+10)
    exchange(a,b,r);r=countersign(b,r.escrow_id)
    clock[0]+=11
    r=deliver(b,r.escrow_id,b'late','late.txt');exchange(b,a,r)
    assert verify_offline(r,clock[0]).outcome=='REFUND'
    assert reconcile(a,chain)[0]['outcome']=='REFUND'


def test_explicit_refund(world):
    a,b,_,chain,_=world;happy(a,b,decision='refund')
    assert reconcile(a,chain)[0]['outcome']=='REFUND'
    assert chain.account(b.identity.evm_address)['claimable']==0


def test_equivocation_refused(world):
    a,b,_,_,_=world;r=happy(a,b)
    other=copy.deepcopy(r)
    other.signatures['buyer']=sign(a.identity.secret_key,r.terms,'buyer')
    assert other.signatures['buyer']!=r.signatures['buyer']
    with pytest.raises(ValueError,match='Equivocation'):
        import_bundle(b,export_bundle(other))


def test_decision_binds_exact_delivery_signature(world):
    a,b,_,_,_=world;r=happy(a,b)
    r.signatures['delivery']=sign(b.identity.secret_key,r.delivery,'delivery')
    with pytest.raises(ValueError,match='exact delivery'):
        verify_signatures(r)


def test_stale_bundle_cannot_regress(world):
    a,b,_,_,_=world;r=happy(a,b);stale=copy.deepcopy(export_bundle(r))
    stale['acceptance']=None;stale['signatures'].pop('acceptance')
    assert import_bundle(a,stale).state=='ACCEPTED'


def test_safe_payload_path(world):
    a,b,_,_,_=world;r=happy(a,b)
    r.delivery['filename']='../../outside.txt'
    r.signatures['delivery']=sign(b.identity.secret_key,r.delivery,'delivery')
    r.acceptance=None;r.signatures.pop('acceptance')
    # A fresh recipient has no previously signed delivery to conflict with.
    p=Party(a.identity,Store(a.store.root.parent/'fresh'),a.clock)
    imported=import_bundle(p,export_bundle(r))
    assert Path(imported.payload_path)==(p.store.vault/r.escrow_id/'payload').resolve()
    assert not (p.store.root.parent/'outside.txt').exists()


def test_cloned_wallet_double_spend(world,tmp_path):
    a,b,_,chain,_=world
    clone=Party(a.identity,Store(tmp_path/'clone'),a.clock)
    peer=Party(b.identity,Store(tmp_path/'peer'),b.clock)
    first=happy(a,b);second=happy(clone,peer)
    assert first.terms['seq']==second.terms['seq']
    assert reconcile(a,chain)[0]['outcome']=='RELEASE'
    result=reconcile(clone,chain)[0]
    assert result['outcome']=='REJECT' and 'sequence already used' in result['reason']


def test_local_same_seq_both_rejected(world,tmp_path):
    a,b,_,chain,_=world
    clone=Party(a.identity,Store(tmp_path/'clone'),a.clock)
    first=propose(a,b.identity,ETH,'First',a.now()+60)
    second=propose(clone,b.identity,ETH,'Second',a.now()+60)
    import_bundle(a,export_bundle(second))
    results=reconcile(a,chain)
    assert len(results)==2 and all(x['outcome']=='REJECT' and 'same-seq' in x['reason'] for x in results)
    assert not chain.settlement(first.escrow_id)


def test_deterministic_balance_consumption(world):
    a,b,_,chain,_=world
    first=happy(a,b,amount=4*ETH);second=happy(a,b,amount=2*ETH)
    results=reconcile(a,chain)
    assert [x['escrow_id'] for x in results]==[first.escrow_id,second.escrow_id]
    assert [x['outcome'] for x in results]==['RELEASE','HOLD']
    assert 'Insufficient' in results[1]['reason']


def test_unregistered_and_wrong_key(world,tmp_path):
    a,b,_,_,_=world;happy(a,b)
    chain=LocalLedger(tmp_path/'empty.json',min_lock=1,clock=a.clock)
    assert 'not registered' in reconcile(a,chain)[0]['reason']
    with pytest.raises(ValueError,match='different buyer key'):
        world[3].deposit(a.identity.evm_address,'f'*64,1,60)


def test_missing_deposit_is_retryable_without_new_signatures(world, tmp_path):
    a, b, _, _, _ = world
    r = happy(a, b)
    signatures = copy.deepcopy(r.signatures)
    chain = LocalLedger(tmp_path/'unfunded.json', min_lock=60, clock=a.clock)
    result = reconcile(a, chain)[0]
    assert result['outcome'] == 'HOLD' and 'not registered yet' in result['reason']
    assert a.store.get(r.escrow_id).rejection is None
    assert a.store.get(r.escrow_id).state == 'ACCEPTED'
    chain.deposit(a.identity.evm_address, a.identity.key_hash, ETH, 60)
    assert reconcile(a, chain)[0]['outcome'] == 'RELEASE'
    assert a.store.get(r.escrow_id).signatures == signatures
    assert chain.account(b.identity.evm_address)['claimable'] == ETH


def test_insufficient_funds_retry_and_real_key_mismatch(world, tmp_path):
    a, b, _, chain, _ = world
    r = happy(a, b, amount=6*ETH)
    assert reconcile(a, chain)[0]['outcome'] == 'HOLD'
    assert a.store.get(r.escrow_id).rejection is None
    chain.deposit(a.identity.evm_address, a.identity.key_hash, ETH, 60)
    assert reconcile(a, chain)[0]['outcome'] == 'RELEASE'
    r = happy(a, b)
    wrong = LocalLedger(tmp_path/'wrong-key.json', min_lock=60, clock=a.clock)
    wrong.deposit(a.identity.evm_address, 'f'*64, ETH, 60)
    result = reconcile(a, wrong)[0]
    assert result['outcome'] == 'REJECT' and 'mismatched' in result['reason']
    assert not wrong.settlement(r.escrow_id)


def test_deposit_lock_and_minimum(world):
    a,_,_,chain,clock=world
    with pytest.raises(ValueError,match='minimum'):
        chain.deposit(a.identity.evm_address,a.identity.key_hash,1,59)
    with pytest.raises(ValueError,match='time-locked'):
        chain.withdraw(a.identity.evm_address,1)
    clock[0]+=3600
    assert chain.withdraw(a.identity.evm_address,ETH)==ETH
    assert chain.account(a.identity.evm_address)['balance']==4*ETH


def test_relayer_and_replay(world):
    a,b,_,chain,_=world;r=happy(a,b)
    chain.relayer='intruder'
    with pytest.raises(ValueError,match='relayer'):
        chain.settle(r.escrow_id,a.identity.evm_address,b.identity.evm_address,ETH,1,a.identity.key_hash,True,'a'*64)
    chain.relayer='local-relayer';reconcile(a,chain)
    assert 'Replay' in reconcile(b,chain)[0]['reason']


@pytest.mark.parametrize('attack',['body','delete'])
def test_audit_tampering(world,attack):
    a,b,_,_,_=world;happy(a,b)
    assert a.store.verify_log()
    with sqlite3.connect(a.store.db) as db:
        if attack=='body': db.execute("UPDATE audit SET body='{}' WHERE id=1")
        else: db.execute('DELETE FROM audit WHERE id=(SELECT MAX(id) FROM audit)')
    assert not a.store.verify_log()


@pytest.mark.parametrize('field,value',[('amount_wei','0'),('seq',True),('expected_sha256','bad'),('version',2)])
def test_bad_structure(world,field,value):
    a,b,_,_,_=world;r=happy(a,b);r.terms[field]=value
    assert verify_offline(r,a.now()).outcome=='REJECT'


def test_role_and_state_enforced(world):
    a,b,c,_,_=world;r=happy(a,b)
    for party in (b,c):
        with pytest.raises(ValueError): accept(party,r.escrow_id,'release')
    with pytest.raises(ValueError): deliver(b,r.escrow_id,b'replacement')


def test_payload_changed_during_evidence_capture_is_rejected(world,monkeypatch):
    import importlib
    module=importlib.import_module('escrow.reconcile')
    a,b,_,chain,_=world;r=happy(a,b)
    original=module.export_bundle
    def changed(record):
        Path(record.payload_path).write_bytes(b'changed between verification and evidence capture')
        return original(record)
    monkeypatch.setattr(module,'export_bundle',changed)
    assert reconcile(a,chain)[0]['outcome']=='REJECT'
    assert not chain.settlement(r.escrow_id)


def test_ledger_bounds_match_uint256(world,tmp_path):
    from escrow.identity import address
    a,_,_,chain,_=world
    with pytest.raises(ValueError): address('0x'+'0'*40)
    with pytest.raises(ValueError): LocalLedger(tmp_path/'invalid.json',min_lock=-1)
    with pytest.raises(ValueError): chain.deposit(a.identity.evm_address,a.identity.key_hash,2**256,60)
    with pytest.raises(ValueError): chain.deposit(a.identity.evm_address,a.identity.key_hash,1,2**256-1)
    assert chain.account(a.identity.evm_address)['balance']==5*ETH
