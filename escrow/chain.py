"""Portable JSON test ledger. File locking serializes independent local processes."""
import json
import os
import re
import time
from abc import ABC, abstractmethod
from contextlib import contextmanager
from pathlib import Path
from .identity import address

ETH = 10**18


class Chain(ABC):
    @abstractmethod
    def account(self, addr): ...
    @abstractmethod
    def settlement(self, escrow_id): ...
    @abstractmethod
    def seq_used(self, buyer, seq): ...
    @abstractmethod
    def deposit(self, addr, key_hash, amount, lock_seconds): ...
    @abstractmethod
    def withdraw(self, addr, amount): ...
    @abstractmethod
    def claim(self, addr): ...
    @abstractmethod
    def settle(self, escrow_id, buyer, seller, amount, seq, buyer_key_hash, release, evidence_hash): ...


def uint(value, positive=False):
    if type(value) is not int or not (1 if positive else 0) <= value < 2**256:
        raise ValueError("Invalid uint256 amount or sequence")


def digest(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value) or value == "0" * 64:
        raise ValueError("Expected a nonzero SHA-256 digest")


class LocalLedger(Chain):
    def __init__(self, path, min_lock=3600, clock=time.time, owner="local-relayer", relayer=None):
        uint(min_lock)
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.clock = clock
        self.relayer = relayer or owner
        with self._file_lock():
            if not self.path.exists():
                self._write(dict(accounts={}, claimable={}, settlements={}, seq_used={},
                                 min_lock=min_lock, owner=owner, relayers=[owner],
                                 deposited=0, withdrawn=0, claimed=0))

    @contextmanager
    def _file_lock(self):
        lockpath = self.path.with_suffix(self.path.suffix + ".lock")
        with lockpath.open("a+b") as stream:
            stream.seek(0, os.SEEK_END)
            if stream.tell() == 0:
                stream.write(b"0")
                stream.flush()
            stream.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
            else:
                import fcntl
                fcntl.flock(stream, fcntl.LOCK_EX)
            try:
                yield
            finally:
                stream.seek(0)
                if os.name == "nt":
                    msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(stream, fcntl.LOCK_UN)

    def _write(self, data):
        temporary = self.path.with_suffix(".tmp")
        with temporary.open("w", encoding="utf-8") as stream:
            json.dump(data, stream, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, self.path)

    @contextmanager
    def transaction(self):
        with self._file_lock():
            data = json.loads(self.path.read_text(encoding="utf-8"))
            yield data
            self._write(data)

    def snapshot(self):
        with self._file_lock():
            return json.loads(self.path.read_text(encoding="utf-8"))

    def account(self, addr):
        addr = address(addr)
        d = self.snapshot()
        return {**d["accounts"].get(addr, dict(balance=0, lockedUntil=0, keyHash="")),
                "claimable": d["claimable"].get(addr, 0)}

    def settlement(self, escrow_id):
        return self.snapshot()["settlements"].get(escrow_id)

    def seq_used(self, buyer, seq):
        return str(seq) in self.snapshot()["seq_used"].get(address(buyer), [])

    def set_relayer(self, caller, relayer, allowed):
        with self.transaction() as d:
            if caller != d["owner"]:
                raise ValueError("Only the owner can set relayers")
            if allowed and relayer not in d["relayers"]:
                d["relayers"].append(relayer)
            elif not allowed and relayer in d["relayers"]:
                d["relayers"].remove(relayer)

    def deposit(self, addr, key_hash, amount, lock_seconds):
        addr = address(addr)
        uint(amount, True)
        uint(lock_seconds, True)
        digest(key_hash)
        with self.transaction() as d:
            if lock_seconds < d["min_lock"]:
                raise ValueError("Deposit lock is below the minimum")
            a = d["accounts"].setdefault(addr, dict(balance=0, lockedUntil=0, keyHash=key_hash))
            if a["keyHash"] != key_hash:
                raise ValueError("A different buyer key is already registered")
            uint(a["balance"] + amount)
            uint(int(self.clock()) + lock_seconds)
            a["balance"] += amount
            a["lockedUntil"] = max(a["lockedUntil"], int(self.clock()) + lock_seconds)
            d["deposited"] += amount
        return self.account(addr)

    def withdraw(self, addr, amount):
        addr = address(addr)
        uint(amount, True)
        with self.transaction() as d:
            a = d["accounts"].get(addr)
            if not a or int(self.clock()) < a["lockedUntil"]:
                raise ValueError("Funds are time-locked")
            if a["balance"] < amount:
                raise ValueError("Insufficient escrow balance")
            a["balance"] -= amount
            d["withdrawn"] += amount
        return amount

    def claim(self, addr):
        addr = address(addr)
        with self.transaction() as d:
            amount = d["claimable"].get(addr, 0)
            if not amount:
                raise ValueError("No earnings to claim")
            d["claimable"][addr] = 0
            d["claimed"] += amount
        return amount

    def settle(self, escrow_id, buyer, seller, amount, seq, buyer_key_hash, release, evidence_hash):
        buyer, seller = address(buyer), address(seller)
        digest(escrow_id)
        digest(evidence_hash)
        digest(buyer_key_hash)
        uint(amount, True)
        uint(seq, True)
        if type(release) is not bool or buyer == seller:
            raise ValueError("Invalid settlement parties or outcome")
        with self.transaction() as d:
            if self.relayer not in d["relayers"]:
                raise ValueError("Only an authorized relayer can settle")
            if escrow_id in d["settlements"]:
                raise ValueError("Replay: escrow already settled")
            if str(seq) in d["seq_used"].get(buyer, []):
                raise ValueError("Double spend: sequence already used")
            a = d["accounts"].get(buyer)
            if not a or a["keyHash"] != buyer_key_hash:
                raise ValueError("Buyer key not registered or mismatched")
            if release:
                if a["balance"] < amount:
                    raise ValueError("Insufficient escrow balance")
                uint(d["claimable"].get(seller, 0) + amount)
                a["balance"] -= amount
                d["claimable"][seller] = d["claimable"].get(seller, 0) + amount
            result = dict(escrow_id=escrow_id, buyer=buyer, seller=seller, amount_wei=str(amount),
                          seq=seq, buyer_key_hash=buyer_key_hash, release=release,
                          outcome="RELEASE" if release else "REFUND", note="release" if release else "refund",
                          evidence_hash=evidence_hash, settled_at=int(self.clock()))
            d["settlements"][escrow_id] = result
            d["seq_used"].setdefault(buyer, []).append(str(seq))
        return result
