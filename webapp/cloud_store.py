"""Postgres persistence for hosted workspaces; local protocol code stays shared."""
import copy
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
from contextlib import contextmanager
from pathlib import Path

import psycopg
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from psycopg.types.json import Jsonb

from escrow.chain import LocalLedger
from escrow.crypto import b64, canonical_json, sha256_bytes, unb64
from escrow.identity import Identity
from escrow.models import Record
from escrow.protocol import Party
from .accounts import Accounts, HTTPError

SCHEMA = """
CREATE TABLE IF NOT EXISTS pqe_users(
 username TEXT PRIMARY KEY, salt TEXT NOT NULL, password TEXT NOT NULL,
 descriptor TEXT NOT NULL, key_blob TEXT NOT NULL, funds TEXT NOT NULL,
 online INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS pqe_sessions(
 token_hash TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES pqe_users(username),
 expires BIGINT NOT NULL, key_session TEXT, created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
 device TEXT NOT NULL DEFAULT 'Web browser');
CREATE INDEX IF NOT EXISTS pqe_sessions_user ON pqe_sessions(username);
CREATE TABLE IF NOT EXISTS pqe_meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS pqe_failures(bucket TEXT NOT NULL, at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS pqe_failures_bucket ON pqe_failures(bucket,at);
CREATE TABLE IF NOT EXISTS pqe_limits(bucket TEXT PRIMARY KEY, started BIGINT NOT NULL, count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS pqe_files(digest TEXT PRIMARY KEY, data BYTEA NOT NULL, size BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS pqe_records(
 owner TEXT NOT NULL REFERENCES pqe_users(username), id TEXT NOT NULL,
 body JSONB NOT NULL, file_hash TEXT REFERENCES pqe_files(digest), PRIMARY KEY(owner,id));
CREATE TABLE IF NOT EXISTS pqe_sequences(owner TEXT NOT NULL, buyer TEXT NOT NULL, next BIGINT NOT NULL, PRIMARY KEY(owner,buyer));
CREATE TABLE IF NOT EXISTS pqe_audit(owner TEXT NOT NULL, id BIGINT NOT NULL, body JSONB NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(owner,id));
CREATE TABLE IF NOT EXISTS pqe_heads(owner TEXT PRIMARY KEY, count BIGINT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pqe_ledger(id INTEGER PRIMARY KEY, state JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS pqe_profiles(username TEXT PRIMARY KEY REFERENCES pqe_users(username), display_name TEXT NOT NULL DEFAULT '', notifications_seen BIGINT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS pqe_notes(owner TEXT NOT NULL, escrow_id TEXT NOT NULL, note TEXT NOT NULL, updated_at BIGINT NOT NULL, PRIMARY KEY(owner,escrow_id));
CREATE TABLE IF NOT EXISTS pqe_uploads(id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES pqe_users(username), size BIGINT NOT NULL,
 filename TEXT NOT NULL, purpose TEXT NOT NULL, escrow_id TEXT, created_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS pqe_chunks(upload_id TEXT NOT NULL REFERENCES pqe_uploads(id) ON DELETE CASCADE,
 part INTEGER NOT NULL, data BYTEA NOT NULL, PRIMARY KEY(upload_id,part));
"""


class Row(dict):
    def __getitem__(self, key):
        return list(self.values())[key] if isinstance(key, int) else super().__getitem__(key)


def row_factory(cursor):
    names = [column.name for column in (cursor.description or [])]
    return lambda values: Row(zip(names, values))


def connect_database(url=None):
    url = url or os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
    if not url:
        raise RuntimeError("The hosted database has not been connected")
    return psycopg.connect(url, connect_timeout=15, row_factory=row_factory)


def initialize_database(connection):
    connection.execute(SCHEMA)
    connection.commit()


class AccountsSQL:
    """Small adapter for the unchanged, parameterized Accounts queries."""
    def __init__(self, connection):
        self.connection = connection

    def execute(self, statement, values=()):
        statement = statement.replace("?", "%s")
        if statement == "INSERT INTO sessions VALUES(%s,%s,%s)":
            statement = "INSERT INTO sessions(token_hash,username,expires) VALUES(%s,%s,%s)"
        for table in ("users", "sessions", "meta"):
            statement = re.sub(r"\b" + table + r"\b", "pqe_" + table, statement)
        return self.connection.execute(statement, values)


class CloudAccounts(Accounts):
    def __init__(self, root, clock, connection, session_key, device="Web browser"):
        self.root, self.clock, self.connection = Path(root), clock, connection
        self.lock, self.keys, self.failures, self.stores = threading.RLock(), {}, {}, {}
        self.session_key, self.device = session_key, device[:160]

    @contextmanager
    def connect(self):
        yield AccountsSQL(self.connection)

    def register(self, username, password):
        self.validate(username, password)
        if self.connection.execute("SELECT 1 FROM pqe_users WHERE username=%s", (username,)).fetchone():
            raise HTTPError(409, "That username is taken; choose another")
        result = super().register(username, password)
        self.connection.execute("INSERT INTO pqe_profiles(username) VALUES(%s)", (username,))
        return result

    def login(self, username, password, remote):
        if not isinstance(username, str) or not isinstance(password, str):
            raise HTTPError(400, "Enter your username and password")
        now = int(time.time())
        buckets = [hmac.digest(self.session_key, value.encode(), "sha256").hex()
                   for value in ("user/" + username, "address/" + remote)]
        self.connection.execute("DELETE FROM pqe_failures WHERE at<%s", (now - 60,))
        for bucket in buckets:
            count = self.connection.execute("SELECT COUNT(*) FROM pqe_failures WHERE bucket=%s", (bucket,)).fetchone()[0]
            if count >= 5:
                raise HTTPError(429, "Too many failed logins; wait one minute and try again")
        try:
            token, name = super().login(username, password, remote)
        except HTTPError as exc:
            if exc.status == 401:
                for bucket in buckets:
                    self.connection.execute("INSERT INTO pqe_failures VALUES(%s,%s)", (bucket, now))
            raise
        nonce = secrets.token_bytes(12)
        encrypted = AESGCM(self.session_key).encrypt(nonce, self.keys[name], token.encode())
        self.connection.execute("UPDATE pqe_sessions SET key_session=%s,device=%s WHERE token_hash=%s",
                                (b64(nonce + encrypted), self.device, sha256_bytes(token.encode())))
        self.connection.execute("DELETE FROM pqe_failures WHERE bucket=ANY(%s)", (buckets,))
        return token, name

    def authenticate(self, token, allow_locked=False):
        name = super().authenticate(token, allow_locked=True)
        row = self.connection.execute("SELECT key_session FROM pqe_sessions WHERE token_hash=%s", (sha256_bytes(token.encode()),)).fetchone()
        if not row or not row[0]:
            raise HTTPError(401, "Sign in again to unlock your signing key")
        try:
            encrypted = unb64(row[0])
            self.keys[name] = AESGCM(self.session_key).decrypt(encrypted[:12], encrypted[12:], token.encode())
        except Exception:
            raise HTTPError(401, "Sign in again to unlock your signing key") from None
        return name

    def party(self, username, public_only=False):
        u = self.user(username)
        descriptor = json.loads(u["descriptor"])
        identity = Identity(descriptor["name"], descriptor["evm_address"], unb64(descriptor["public_key"]),
                            None if public_only else self.keys.get(username))
        if username not in self.stores:
            self.stores[username] = CloudStore(self.root / "users" / username, username, self.connection)
        return Party(identity, self.stores[username], self.clock)


class CloudStore:
    def __init__(self, root, owner, connection):
        self.root, self.owner, self.connection = Path(root), owner, connection
        self.lock = threading.RLock()
        self.vault = self.root / "vault"
        self.vault.mkdir(parents=True, exist_ok=True)
        connection.execute("INSERT INTO pqe_heads VALUES(%s,0,'') ON CONFLICT DO NOTHING", (owner,))

    def _append(self, event, escrow_id, data):
        count, previous = self.connection.execute("SELECT count,hash FROM pqe_heads WHERE owner=%s FOR UPDATE", (self.owner,)).fetchone().values()
        body = dict(id=count + 1, at=int(time.time()), event=event, escrow_id=escrow_id, data=data or {}, prev_hash=previous)
        digest = sha256_bytes(canonical_json(body))
        self.connection.execute("INSERT INTO pqe_audit VALUES(%s,%s,%s,%s)", (self.owner, count + 1, Jsonb(body), digest))
        self.connection.execute("UPDATE pqe_heads SET count=%s,hash=%s WHERE owner=%s", (count + 1, digest, self.owner))

    def log(self, event, escrow_id=None, data=None):
        self._append(event, escrow_id, data)

    def put(self, record, event="updated"):
        from dataclasses import asdict
        body, digest = asdict(record), None
        if record.payload_path:
            data = Path(record.payload_path).read_bytes()
            digest = sha256_bytes(data)
            self.connection.execute("INSERT INTO pqe_files VALUES(%s,%s,%s) ON CONFLICT DO NOTHING", (digest, data, len(data)))
            body["payload_path"] = "vault/" + record.escrow_id + "/payload"
        self.connection.execute("INSERT INTO pqe_records VALUES(%s,%s,%s,%s) ON CONFLICT(owner,id) DO UPDATE SET body=excluded.body,file_hash=excluded.file_hash",
                                (self.owner, record.escrow_id, Jsonb(body), digest))
        self._append(event, record.escrow_id, {"state": record.state})

    def _record(self, row):
        record = Record(**copy.deepcopy(row["body"]))
        if row["file_hash"]:
            target = self.vault / record.escrow_id / "payload"
            if not target.is_file():
                data = self.connection.execute("SELECT data FROM pqe_files WHERE digest=%s", (row["file_hash"],)).fetchone()
                if not data:
                    raise ValueError("The saved delivery is missing")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(bytes(data[0]))
            record.payload_path = str(target)
        return record

    def get(self, escrow_id):
        row = self.connection.execute("SELECT body,file_hash FROM pqe_records WHERE owner=%s AND id=%s", (self.owner, escrow_id)).fetchone()
        if not row:
            raise ValueError("Escrow not found")
        return self._record(row)

    def all(self):
        rows = self.connection.execute("SELECT body,file_hash FROM pqe_records WHERE owner=%s ORDER BY id", (self.owner,)).fetchall()
        return [self._record(row) for row in rows]

    def next_seq(self, buyer_key_hash):
        row = self.connection.execute("INSERT INTO pqe_sequences VALUES(%s,%s,2) ON CONFLICT(owner,buyer) DO UPDATE SET next=pqe_sequences.next+1 RETURNING next-1", (self.owner, buyer_key_hash)).fetchone()
        return row[0]

    def observe_seq(self, buyer_key_hash, seq):
        self.connection.execute("INSERT INTO pqe_sequences VALUES(%s,%s,%s) ON CONFLICT(owner,buyer) DO UPDATE SET next=GREATEST(pqe_sequences.next,excluded.next)", (self.owner, buyer_key_hash, seq + 1))

    def audit(self):
        return [{**row["body"], "hash": row["hash"]} for row in self.connection.execute("SELECT body,hash FROM pqe_audit WHERE owner=%s ORDER BY id", (self.owner,))]

    def updates(self, after=None):
        row = self.connection.execute("SELECT count,hash FROM pqe_heads WHERE owner=%s", (self.owner,)).fetchone()
        events = [] if after is None else [r[0] for r in self.connection.execute(
            "SELECT body FROM pqe_audit WHERE owner=%s AND id>%s AND id<=%s ORDER BY id DESC LIMIT 20", (self.owner, after, row[0]))]
        return {"count": row[0], "revision": str(row[0]) + ":" + row[1], "events": events}

    def verify_log(self):
        previous, count = "", 0
        for entry in self.audit():
            digest = entry.pop("hash")
            count += 1
            if entry["id"] != count or entry["prev_hash"] != previous or sha256_bytes(canonical_json(entry)) != digest:
                return False
            previous = digest
        row = self.connection.execute("SELECT count,hash FROM pqe_heads WHERE owner=%s", (self.owner,)).fetchone()
        return (row[0], row[1]) == (count, previous)


class CloudLedger(LocalLedger):
    def __init__(self, connection, clock, min_lock=60):
        self.connection, self.clock, self.relayer = connection, clock, "cloud-relayer"
        initial = dict(accounts={}, claimable={}, settlements={}, seq_used={}, min_lock=min_lock,
                       owner=self.relayer, relayers=[self.relayer], deposited=0, withdrawn=0, claimed=0)
        connection.execute("INSERT INTO pqe_ledger VALUES(1,%s) ON CONFLICT DO NOTHING", (Jsonb(initial),))

    def snapshot(self):
        return copy.deepcopy(self.connection.execute("SELECT state FROM pqe_ledger WHERE id=1").fetchone()[0])

    @contextmanager
    def transaction(self):
        state = copy.deepcopy(self.connection.execute("SELECT state FROM pqe_ledger WHERE id=1 FOR UPDATE").fetchone()[0])
        yield state
        self.connection.execute("UPDATE pqe_ledger SET state=%s WHERE id=1", (Jsonb(state),))
