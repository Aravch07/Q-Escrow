"""Optional web3.py adapter. No web3 import is made by the core or website."""
import json
from pathlib import Path
from .chain import Chain

ARTIFACT = Path(__file__).resolve().parents[1] / "build" / "PQEscrow.json"


class Web3Chain(Chain):
    def __init__(self, web3, contract, relayer):
        self.web3, self.contract, self.relayer = web3, contract, relayer

    @classmethod
    def deploy(cls, web3, owner=None, min_lock=3600, artifact=ARTIFACT):
        owner = owner or web3.eth.accounts[0]
        spec = json.loads(Path(artifact).read_text())
        factory = web3.eth.contract(abi=spec["abi"], bytecode=spec["bytecode"])
        tx = factory.constructor(min_lock).transact({"from": owner})
        receipt = web3.eth.wait_for_transaction_receipt(tx)
        if receipt.status != 1:
            raise ValueError("Contract deployment failed")
        return cls(web3, web3.eth.contract(address=receipt.contractAddress, abi=spec["abi"]), owner)

    def _addr(self, addr):
        return self.web3.to_checksum_address(addr)

    def _tx(self, function, sender, value=0):
        try:
            receipt = self.web3.eth.wait_for_transaction_receipt(function.transact({"from": self._addr(sender), "value": value}))
            if receipt.status != 1:
                raise ValueError("EVM transaction reverted")
            return receipt
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError(f"EVM transaction rejected: {exc}") from exc

    def account(self, addr):
        addr = self._addr(addr)
        balance, until, key = self.contract.functions.accounts(addr).call()
        return dict(balance=balance, lockedUntil=until,
                    keyHash=bytes(key).hex() if any(key) else "",
                    claimable=self.contract.functions.claimable(addr).call())

    def settlement(self, escrow_id):
        key = bytes.fromhex(escrow_id)
        if not self.contract.functions.isSettled(key).call():
            return None
        buyer, seller, amount, seq, buyer_key, release, evidence, at = self.contract.functions.settlements(key).call()
        return dict(escrow_id=escrow_id, buyer=buyer.lower(), seller=seller.lower(), amount_wei=str(amount),
                    seq=seq, buyer_key_hash=bytes(buyer_key).hex(), release=release,
                    outcome="RELEASE" if release else "REFUND", note="release" if release else "refund",
                    evidence_hash=bytes(evidence).hex(), settled_at=at)

    def seq_used(self, buyer, seq):
        return self.contract.functions.seqUsed(self._addr(buyer), seq).call()

    def deposit(self, addr, key_hash, amount, lock_seconds):
        self._tx(self.contract.functions.deposit(bytes.fromhex(key_hash), lock_seconds), addr, amount)
        return self.account(addr)

    def withdraw(self, addr, amount):
        self._tx(self.contract.functions.withdraw(amount), addr)
        return amount

    def claim(self, addr):
        amount = self.account(addr)["claimable"]
        self._tx(self.contract.functions.claim(), addr)
        return amount

    def settle(self, escrow_id, buyer, seller, amount, seq, buyer_key_hash, release, evidence_hash):
        self._tx(self.contract.functions.settle(bytes.fromhex(escrow_id), self._addr(buyer), self._addr(seller),
                 amount, seq, bytes.fromhex(buyer_key_hash), release, bytes.fromhex(evidence_hash)), self.relayer)
        return self.settlement(escrow_id)
