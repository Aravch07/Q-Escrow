import hmac
import json
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from escrow.crypto import b64, unb64, sha256_bytes
from escrow.identity import Identity
from escrow.protocol import Party
from escrow.store import Store
from .security import password_hash, seal, unseal

SESSION_SECONDS = 12 * 3600


class HTTPError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class Accounts:
    def __init__(self, root, clock):
        self.root, self.clock = Path(root), clock
        self.root.mkdir(parents=True, exist_ok=True)
        self.db = self.root / "accounts.sqlite3"
        self.lock = threading.RLock()
        self.keys = {}
        self.failures = {}
        self.stores = {}
        with self.connect() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS users(username TEXT PRIMARY KEY, salt TEXT, password TEXT,
              descriptor TEXT, key_blob TEXT, funds TEXT, online INTEGER DEFAULT 1);
            CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, username TEXT, expires INTEGER);
            CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
            INSERT OR IGNORE INTO meta VALUES('offset','0');
            """)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.db, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def user(self, username):
        with self.connect() as db:
            row = db.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        if not row:
            raise HTTPError(404, "Account not found")
        return dict(row)

    def users(self):
        with self.connect() as db:
            return [json.loads(r[0]) for r in db.execute("SELECT descriptor FROM users ORDER BY username")]

    def validate(self, username, password):
        if not isinstance(username, str) or not re.fullmatch(r"[a-z0-9_]{3,20}", username):
            raise HTTPError(400, "Username must be 3–20 lower-case letters, numbers or underscores")
        if not isinstance(password, str) or not 8 <= len(password) <= 1024:
            raise HTTPError(400, "Password must contain 8–1024 characters")

    def register(self, username, password):
        self.validate(username, password)
        with self.lock:
            with self.connect() as db:
                if db.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
                    raise HTTPError(409, "That username is taken; choose another")
            identity = Identity.create(username)
            salt = secrets.token_bytes(16)
            envelope = seal(identity.secret_key, password)
            with self.connect() as db:
                db.execute("INSERT INTO users VALUES(?,?,?,?,?,?,1)",
                           (username, b64(salt), b64(password_hash(password, salt)),
                            json.dumps(identity.descriptor()), json.dumps(envelope), str(10 * 10**18)))
            self.party(username, public_only=True).store.log("account_created")
            return identity.descriptor()

    def cleanup(self):
        with self.connect() as db:
            db.execute("DELETE FROM sessions WHERE expires<=?", (int(self.clock()),))
            active = {r[0] for r in db.execute("SELECT DISTINCT username FROM sessions")}
        for username in list(self.keys):
            if username not in active:
                del self.keys[username]

    def login(self, username, password, remote):
        if not isinstance(username, str) or not isinstance(password, str) or len(password) > 1024:
            raise HTTPError(400, "Enter your username and password")
        with self.lock:
            now = time.monotonic()
            buckets = [("user", username), ("address", remote)]
            for key in buckets:
                self.failures[key] = [t for t in self.failures.get(key, []) if now - t < 60]
                if len(self.failures[key]) >= 5:
                    raise HTTPError(429, "Too many failed logins; wait one minute and try again")
            try:
                u = self.user(username)
            except HTTPError:
                u = None
            candidate = password_hash(password, unb64(u["salt"]) if u else b"\0" * 16)
            if not u or not hmac.compare_digest(candidate, unb64(u["password"])):
                for key in buckets:
                    self.failures[key].append(now)
                raise HTTPError(401, "Username or password is incorrect")
            if u["key_blob"]:
                secret = unseal(json.loads(u["key_blob"]), password)
            else:
                # Supported legacy layout: users/<username>/identity.json.
                legacy = self.root / "users" / username / "identity.json"
                if not legacy.is_file():
                    raise HTTPError(401, "Signing key is missing; restore the account backup")
                old = Identity.load(legacy)
                if old.descriptor() != json.loads(u["descriptor"]) or not old.secret_key:
                    raise HTTPError(401, "Legacy signing key does not match this account")
                secret = old.secret_key
                with self.connect() as db:
                    db.execute("UPDATE users SET key_blob=? WHERE username=?", (json.dumps(seal(secret, password)), username))
                legacy.unlink()
            self.cleanup()
            token = secrets.token_hex(32)
            with self.connect() as db:
                db.execute("INSERT INTO sessions VALUES(?,?,?)", (sha256_bytes(token.encode()), username, int(self.clock()) + SESSION_SECONDS))
            self.keys[username] = secret
            for key in buckets:
                self.failures.pop(key, None)
            return token, username

    def authenticate(self, token, allow_locked=False):
        with self.lock:
            self.cleanup()
            with self.connect() as db:
                row = db.execute("SELECT username FROM sessions WHERE token_hash=?", (sha256_bytes(token.encode()),)).fetchone()
            if not row:
                raise HTTPError(401, "Sign in to continue")
            username = row[0]
            if username not in self.keys and not allow_locked:
                raise HTTPError(401, "Sign in again to unlock your signing key")
            return username

    def logout(self, token):
        with self.lock, self.connect() as db:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (sha256_bytes(token.encode()),))
        self.cleanup()

    def change_password(self, username, old_password, new_password):
        self.validate(username, new_password)
        with self.lock:
            u = self.user(username)
            if not isinstance(old_password, str) or not hmac.compare_digest(password_hash(old_password, unb64(u["salt"])), unb64(u["password"])):
                raise HTTPError(401, "Current password is incorrect")
            secret = self.keys.get(username)
            if secret is None:
                raise HTTPError(401, "Sign in again to unlock your signing key")
            salt = secrets.token_bytes(16)
            with self.connect() as db:
                db.execute("UPDATE users SET salt=?,password=?,key_blob=? WHERE username=?",
                           (b64(salt), b64(password_hash(new_password, salt)), json.dumps(seal(secret, new_password)), username))
                db.execute("DELETE FROM sessions WHERE username=?", (username,))
            self.keys.pop(username, None)

    def party(self, username, public_only=False):
        u = self.user(username)
        d = json.loads(u["descriptor"])
        identity = Identity(d["name"], d["evm_address"], unb64(d["public_key"]),
                            None if public_only else self.keys.get(username))
        if username not in self.stores:
            self.stores[username] = Store(self.root / "users" / username)
        return Party(identity, self.stores[username], self.clock)

    def update_funds(self, username, delta):
        with self.connect() as db:
            funds = int(db.execute("SELECT funds FROM users WHERE username=?", (username,)).fetchone()[0])
            if funds + delta < 0:
                raise HTTPError(400, "Insufficient test funds")
            db.execute("UPDATE users SET funds=? WHERE username=?", (str(funds + delta), username))

    def online(self, username, value=None):
        with self.connect() as db:
            if value is not None:
                db.execute("UPDATE users SET online=? WHERE username=?", (int(value), username))
        return bool(self.user(username)["online"])
