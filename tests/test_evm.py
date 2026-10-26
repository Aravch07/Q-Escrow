from pathlib import Path
import pytest
from escrow.chain import ETH
from escrow.chain_web3 import Web3Chain, ARTIFACT


@pytest.fixture
def evm():
    try:
        web3=pytest.importorskip('web3',reason='Optional web3 is not installed')
    except OSError as exc:
        if 'Application Control policy has blocked' in str(exc):
            pytest.skip('Windows Application Control blocks optional crypto extension: '+str(exc))
        raise
    tester=pytest.importorskip('eth_tester',reason='Optional eth-tester is not installed')
    pytest.importorskip('eth',reason='Optional PyEVM backend is not installed')
    if not ARTIFACT.is_file(): pytest.skip('Compiled contract artifact is missing')
    backend=tester.PyEVMBackend()
    eth_tester=tester.EthereumTester(backend=backend)
    w3=web3.Web3(web3.EthereumTesterProvider(eth_tester))
    chain=Web3Chain.deploy(w3,min_lock=60)
    return w3,chain,eth_tester


def funded(evm):
    w3,chain,_=evm;buyer,seller=w3.eth.accounts[1:3]
    chain.deposit(buyer,'a'*64,2*ETH,3600)
    return buyer,seller


def test_real_evm_release_claim_and_evidence(evm):
    w3,chain,_=evm;buyer,seller=funded(evm)
    s=chain.settle('1'*64,buyer,seller,ETH,1,'a'*64,True,'b'*64)
    assert s['evidence_hash']=='b'*64 and s['note']=='release'
    assert chain.account(buyer)['balance']==ETH
    assert chain.account(seller)['claimable']==ETH
    before=w3.eth.get_balance(seller)
    receipt=chain._tx(chain.contract.functions.claim(),seller)
    gas=receipt.gasUsed*receipt.effectiveGasPrice
    assert w3.eth.get_balance(seller)==before+ETH-gas


def test_real_evm_replay_and_sequence(evm):
    _,chain,_=evm;buyer,seller=funded(evm)
    chain.settle('1'*64,buyer,seller,ETH,1,'a'*64,True,'b'*64)
    with pytest.raises(ValueError):chain.settle('1'*64,buyer,seller,ETH,2,'a'*64,True,'b'*64)
    with pytest.raises(ValueError):chain.settle('2'*64,buyer,seller,ETH,1,'a'*64,True,'b'*64)


def test_real_evm_only_relayer(evm):
    _,chain,_=evm;buyer,seller=funded(evm)
    chain.relayer=seller
    with pytest.raises(ValueError):chain.settle('1'*64,buyer,seller,ETH,1,'a'*64,True,'b'*64)


def test_real_evm_wrong_key_and_insufficient(evm):
    _,chain,_=evm;buyer,seller=funded(evm)
    with pytest.raises(ValueError):chain.settle('1'*64,buyer,seller,ETH,1,'c'*64,True,'b'*64)
    with pytest.raises(ValueError):chain.settle('1'*64,buyer,seller,3*ETH,1,'a'*64,True,'b'*64)


def test_real_evm_deposit_and_withdraw_lock(evm):
    _,chain,tester=evm;buyer,_=funded(evm)
    with pytest.raises(ValueError):chain.withdraw(buyer,ETH)
    with pytest.raises(ValueError):chain.deposit(buyer,'a'*64,1,59)
    with pytest.raises(ValueError):chain.deposit(buyer,'c'*64,1,60)
    tester.time_travel(chain.account(buyer)['lockedUntil']+1)
    tester.mine_block()
    assert chain.withdraw(buyer,ETH)==ETH


def test_real_evm_refund_does_not_require_balance(evm):
    _,chain,_=evm;buyer,seller=funded(evm)
    s=chain.settle('1'*64,buyer,seller,10*ETH,1,'a'*64,False,'b'*64)
    assert s['note']=='refund' and chain.seq_used(buyer,1)
    assert chain.account(buyer)['balance']==2*ETH


def test_real_evm_reconcile_adapter(evm,tmp_path):
    _,chain,tester=evm
    from escrow.identity import Identity
    from escrow.protocol import Party
    from escrow.store import Store
    from escrow.reconcile import reconcile
    from conftest import happy
    addresses=chain.web3.eth.accounts
    now=lambda:tester.get_block_by_number('latest')['timestamp']
    a=Party(Identity.create('alice',addresses[1]),Store(tmp_path/'a'),now)
    b=Party(Identity.create('bob',addresses[2]),Store(tmp_path/'b'),now)
    chain.deposit(a.identity.evm_address,a.identity.key_hash,ETH,3600)
    happy(a,b)
    assert reconcile(a,chain)[0]['outcome']=='RELEASE'
