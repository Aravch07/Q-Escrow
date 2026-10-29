"""Local SQLite state and a hash-chained audit trail (not an external trust anchor)."""
import json
import re
import sqlite3
import threading
import time
from contextlib import contextmanager
from dataclasses import asdict
from pathlib import Path
from .crypto import canonical_json, sha256_bytes
from .models import Record


class Store:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.vault = self.root / "vault"
        self.vault.mkdir(exist_ok=True)
        self.db = self.root / "records.sqlite3"
        self.lock = threading.RLock()
        with self.connect() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sequences(buyer TEXT PRIMARY KEY, next INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, body TEXT NOT NULL, hash TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS head(id INTEGER PRIMARY KEY CHECK(id=1), count INTEGER, hash TEXT);
            INSERT OR IGNORE INTO head VALUES(1,0,'');
            """)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.db, timeout=30)
        try:
            with db:
                yield db
        finally:
            db.close()

    def _append(self, db, event, escrow_id, data):
        count, prev = db.execute("SELECT count,hash FROM head WHERE id=1").fetchone()
        body = dict(id=count + 1, at=int(time.time()), event=event,
                    escrow_id=escrow_id, data=data or {}, prev_hash=prev)
        digest = sha256_bytes(canonical_json(body))
        db.execute("INSERT INTO audit VALUES(?,?,?)", (count + 1, canonical_json(body).decode(), digest))
        db.execute("UPDATE head SET count=?,hash=? WHERE id=1", (count + 1, digest))

    def log(self, event, escrow_id=None, data=None):
        with self.lock, self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self._append(db, event, escrow_id, data)

    def put(self, record, event="updated"):
        with self.lock, self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("INSERT OR REPLACE INTO records VALUES(?,?)",
                       (record.escrow_id, json.dumps(asdict(record))))
            self._append(db, event, record.escrow_id, {"state": record.state})

    def get(self, escrow_id):
        with self.connect() as db:
            row = db.execute("SELECT body FROM records WHERE id=?", (escrow_id,)).fetchone()
        if not row:
            raise ValueError("Escrow not found")
        return self._record(row[0])

    def _record(self, body):
        record = Record(**json.loads(body))
        if record.payload_path:
            if not re.fullmatch(r"[0-9a-f]{64}", record.escrow_id):
                raise ValueError("Invalid escrow ID in saved record")
            # Payloads belong to this vault, including after a folder copy or move.
            # Never fall back to a saved absolute path in another workspace.
            record.payload_path = str((self.vault / record.escrow_id / "payload").resolve())
        return record

    def all(self):
        with self.connect() as db:
            return [self._record(r[0]) for r in db.execute("SELECT body FROM records ORDER BY id")]

    def next_seq(self, buyer_key_hash):
        with self.lock, self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT next FROM sequences WHERE buyer=?", (buyer_key_hash,)).fetchone()
            seq = row[0] if row else 1
            db.execute("INSERT OR REPLACE INTO sequences VALUES(?,?)", (buyer_key_hash, seq + 1))
            return seq

    def observe_seq(self, buyer_key_hash, seq):
        with self.lock, self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("INSERT INTO sequences VALUES(?,?) ON CONFLICT(buyer) DO UPDATE SET next=MAX(next,excluded.next)",
                       (buyer_key_hash, seq + 1))

    def audit(self):
        with self.connect() as db:
            return [{**json.loads(body), "hash": digest} for body, digest in
                    db.execute("SELECT body,hash FROM audit ORDER BY id")]

    def verify_log(self):
        prev, count = "", 0
        try:
            for entry in self.audit():
                digest = entry.pop("hash")
                count += 1
                if entry["id"] != count or entry["prev_hash"] != prev:
                    return False
                if sha256_bytes(canonical_json(entry)) != digest:
                    return False
                prev = digest
            with self.connect() as db:
                return db.execute("SELECT count,hash FROM head WHERE id=1").fetchone() == (count, prev)
        except (ValueError, KeyError, TypeError):
            return False

    def updates(self, after=None):
        with self.connect() as db:
            count, digest = db.execute("SELECT count,hash FROM head WHERE id=1").fetchone()
            rows = [] if after is None else db.execute(
                "SELECT body FROM audit WHERE id>? ORDER BY id DESC LIMIT 20", (after,)).fetchall()
        events = [{k: event[k] for k in ("id", "at", "event", "escrow_id", "data")}
                  for event in (json.loads(row[0]) for row in rows)]
        return {"count": count, "revision": str(count) + ":" + digest, "events": events}
