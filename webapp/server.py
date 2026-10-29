import json
import logging
import mimetypes
import os
import re
import socket
import tempfile
import threading
import time
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from escrow.chain import LocalLedger, ETH
from escrow.crypto import canonical_json, sha256_bytes, b64, unb64
from escrow.models import Record
from escrow.protocol import (MAX_PAYLOAD, Party, propose, countersign, deliver, accept, cancel,
                             export_bundle, import_bundle, record_from_bundle, filename)
from escrow.reconcile import verify_offline, reconcile
from escrow.store import Store
from .accounts import Accounts, HTTPError

STATIC = Path(__file__).parent / "static"


class App:
    def __init__(self, data, min_lock=3600, seed_demo=False):
        self.root = Path(data)
        self.root.mkdir(parents=True, exist_ok=True)
        self.offset = 0
        self.lock = threading.RLock()
        self.accounts = Accounts(self.root, self.now)
        with self.accounts.connect() as db:
            self.offset = int(db.execute("SELECT value FROM meta WHERE key='offset'").fetchone()[0])
        self.chain = LocalLedger(self.root / "ledger.json", min_lock=min_lock, clock=self.now)
        if seed_demo:
            for name in ("alice", "bob", "carol"):
                try:
                    self.accounts.user(name)
                except HTTPError:
                    self.accounts.register(name, "demo1234")
            alice = self.accounts.party("alice", public_only=True).identity
            if not self.chain.account(alice.evm_address)["keyHash"]:
                self.chain.deposit(alice.evm_address, alice.key_hash, 5 * ETH, max(3600, min_lock))
                self.accounts.update_funds("alice", -5 * ETH)

    def now(self):
        return int(time.time()) + self.offset

    def peer(self, party, record):
        other = "seller" if record.terms["buyer"]["name"] == party.identity.name else "buyer"
        target = self.accounts.party(record.terms[other]["name"], public_only=True)
        assert target.identity.secret_key is None
        import_bundle(target, export_bundle(record))

    def mirror(self, party):
        for r in party.store.all():
            if r.settlement or r.rejection:
                continue
            settled = self.chain.settlement(r.escrow_id)
            if settled:
                t = r.terms
                if (settled["buyer"], settled["seller"], settled["amount_wei"], settled["seq"]) != (
                        t["buyer"]["evm_address"], t["seller"]["evm_address"], t["amount_wei"], t["seq"]):
                    raise HTTPError(409, "Ledger settlement differs from local terms")
                r.settlement = settled
                party.store.put(r, "peer_settlement_observed")

    def mirror_peer_settlements(self, party, results):
        for result in results:
            if result["outcome"] not in ("RELEASE", "REFUND", "CANCELLED"):
                continue
            record = party.store.get(result["escrow_id"])
            other = "seller" if record.terms["buyer"]["name"] == party.identity.name else "buyer"
            self.mirror(self.accounts.party(record.terms[other]["name"], public_only=True))

    def notify_funding(self, party):
        for record in party.store.all():
            if record.terms["buyer"]["name"] != party.identity.name or record.settlement or record.rejection or record.cancellation:
                continue
            other = self.accounts.party(record.terms["seller"]["name"], public_only=True)
            other.store.log("buyer_funding_updated", record.escrow_id, {"state": record.state})

    def record(self, party, escrow_id):
        try:
            r = party.store.get(escrow_id)
        except ValueError:
            raise HTTPError(404, "Escrow not found for your account")
        if party.identity.descriptor() not in (r.terms["buyer"], r.terms["seller"]):
            raise HTTPError(403, "Only the buyer and seller may access this escrow")
        return r

    def detail(self, party, r, include_payload=True):
        verdict = verify_offline(r, self.now())
        t = r.terms
        onchain = self.chain.account(t["buyer"]["evm_address"])
        funding = dict(registered=onchain["keyHash"] == t["buyer"]["key_hash"],
                       key_mismatch=onchain["keyHash"] not in ("", "0" * 64, t["buyer"]["key_hash"]),
                       balance_wei=str(onchain["balance"]), shortfall_wei=str(max(0, int(t["amount_wei"]) - onchain["balance"])))
        checks = verdict.checks + [
            dict(label="Registered buyer key", ok=onchain["keyHash"] == t["buyer"]["key_hash"], detail="An escrow deposit registers the buyer key automatically" if not onchain["keyHash"] else "Compared with the local test ledger"),
            dict(label="Available balance", ok=onchain["balance"] >= int(t["amount_wei"]) or bool(r.settlement), detail="Balance is checked again at settlement; no offline reservation"),
            dict(label="Sequence number", ok=not self.chain.seq_used(t["buyer"]["evm_address"], t["seq"]) or bool(r.settlement), detail=f"Sequence {t['seq']} is consumed once"),
            dict(label="Audit chain", ok=party.store.verify_log(), detail="Local hash chain and saved head checked"),
        ]
        conflict = sum(not x.settlement and not x.rejection and x.terms["buyer"]["evm_address"] == t["buyer"]["evm_address"]
                       and x.terms["seq"] == t["seq"] for x in party.store.all()) > 1
        checks.append(dict(label="Local sequence uniqueness", ok=not conflict, detail="Pending escrows cannot share a buyer sequence"))
        seals = []
        purposes = [("buyer", "Buyer terms", "buyer"), ("seller", "Seller terms", "seller"),
                    ("delivery", "Delivery", "seller"), ("acceptance", "Decision", "buyer")]
        if r.cancellation:
            purposes.append(("cancellation", "Cancellation", r.cancellation["cancelled_by"]))
        for purpose, label, role in purposes:
            sig = r.signatures.get(purpose)
            # Per-seal verification, rather than claiming success from signature presence.
            from escrow.crypto import verify
            message = t if purpose in ("buyer", "seller") else r.delivery if purpose == "delivery" else r.cancellation if purpose == "cancellation" else r.acceptance
            ok = bool(sig and verify(unb64(t[role]["public_key"]), message, sig, purpose))
            seals.append(dict(purpose=purpose, label=label, signer=t[role]["name"], bytes=len(unb64(sig)) if sig else 0, ok=ok, present=bool(sig)))
        return dict(escrow_id=r.escrow_id, terms=t, state=r.state, role="buyer" if t["buyer"]["name"] == party.identity.name else "seller",
                    delivery=r.delivery, acceptance=r.acceptance, cancellation=r.cancellation, settlement=r.settlement, rejection=r.rejection, funding=funding,
                    verification=verdict.asdict(), checks=checks, seals=seals, now=self.now(),
                    activity=[x for x in party.store.audit() if x["escrow_id"] == r.escrow_id], bundle=export_bundle(r) if include_payload else r.bundle(include_payload=False))

    def chain_required(self, username):
        if not self.accounts.online(username):
            raise HTTPError(409, "Chain link is offline. Go online to use the ledger; peer exchange still works")

    def attack(self, party, kind, escrow_id=None, options=None):
        from .lab import run_attack
        return run_attack(self, party, kind, escrow_id, options)


class Handler(BaseHTTPRequestHandler):
    server_version = "PQEscrow/1.0"
    sys_version = ""

    @property
    def app(self):
        return self.server.app

    def log_message(self, fmt, *args):
        # Never log credentials, bodies, cookies, or signed key material.
        logging.getLogger("pqescrow.http").info("%s %s", self.command, urlsplit(self.path).path)

    def send(self, status, data, content_type="application/json; charset=utf-8", headers=None):
        raw = data if isinstance(data, bytes) else canonical_json(data)
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        try:
            self.end_headers()
            self.wfile.write(raw)
        except ConnectionError:
            # Navigation or a closed tab can disconnect before the response.
            pass

    def token(self):
        try:
            cookie = SimpleCookie(self.headers.get("Cookie", ""))
            return cookie["pqe_session"].value if "pqe_session" in cookie else ""
        except Exception:
            return ""

    def cookie(self, token, clear=False):
        return {"Set-Cookie": f"pqe_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={0 if clear else 43200}"}

    def body(self, limit=1024 * 1024, raw=False):
        if self.headers.get("Transfer-Encoding"):
            raise HTTPError(400, "Chunked requests are not supported")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise HTTPError(400, "Invalid content length")
        if length > limit and length <= limit + 1024 * 1024:
            # Drain a small over-limit body without buffering it, so Windows clients
            # can finish sending and read the JSON 413 instead of seeing a reset.
            remaining = length
            while remaining:
                block = self.rfile.read(min(65536, remaining))
                if not block:
                    break
                remaining -= len(block)
        if length < 0 or length > limit:
            raise HTTPError(413, "Upload exceeds the allowed size (files: 25 MB)")
        content = self.rfile.read(length)
        if len(content) != length:
            raise HTTPError(400, "Incomplete request body")
        if raw:
            return content
        try:
            data = json.loads(content or b"{}")
            if not isinstance(data, dict):
                raise ValueError()
            return data
        except (ValueError, UnicodeDecodeError):
            raise HTTPError(400, "Send a valid JSON object")

    def do_GET(self):
        self.dispatch(False)

    def do_POST(self):
        self.dispatch(True)

    def dispatch(self, post):
        try:
            path = urlsplit(self.path).path.rstrip("/") or "/"
            if post and self.headers.get("X-Requested-With") != "PQEscrow":
                raise HTTPError(403, "Missing CSRF header X-Requested-With: PQEscrow")
            origin = self.headers.get("Origin")
            if post and origin and origin != "http://" + self.headers.get("Host", ""):
                raise HTTPError(403, "Cross-origin requests are not allowed")
            if not path.startswith("/api/"):
                if post:
                    raise HTTPError(404, "Endpoint not found")
                assets = {"/": ("index.html", "text/html; charset=utf-8"),
                          "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                          "/hosted.js": ("hosted.js", "text/javascript; charset=utf-8"),
                          "/experience.js": ("experience.js", "text/javascript; charset=utf-8"),
                          "/analytics.js": ("analytics.js", "text/javascript; charset=utf-8"),
                          "/showcase.js": ("showcase.js", "text/javascript; charset=utf-8"),
                          "/live.js": ("live.js", "text/javascript; charset=utf-8"),
                          "/future.css": ("future.css", "text/css; charset=utf-8"),
                          "/style.css": ("style.css", "text/css; charset=utf-8")}
                if path.startswith("/assets/"):
                    asset = (STATIC / path.lstrip("/")).resolve()
                    if not asset.is_relative_to((STATIC / "assets").resolve()) or not asset.is_file():
                        raise HTTPError(404, "Asset not found")
                    return self.send(200, asset.read_bytes(), mimetypes.guess_type(asset.name)[0] or "application/octet-stream")
                if path not in assets:
                    raise HTTPError(404, "Page not found")
                file, mime = assets[path]
                return self.send(200, (STATIC / file).read_bytes(), mime)
            with self.app.lock:
                return self.api(path[5:], post)
        except ConnectionError:
            pass
        except HTTPError as exc:
            self.send(exc.status, {"error": exc.message})
        except (ValueError, KeyError, TypeError, OverflowError, OSError) as exc:
            self.send(400, {"error": str(exc) or "Invalid request; check the fields and try again"})
        except Exception:
            logging.exception("Request failed")
            self.send(500, {"error": "The request could not be completed; check the server log"})

    def api(self, route, post):
        a = self.app.accounts
        if route == "config" and not post:
            return self.send(200, {"hosted": False, "demo": True, "max_file_size": MAX_PAYLOAD,
                                   "preview": os.environ.get("PQE_DESIGN_PREVIEW") == "1"})
        if route in ("register", "login") and post:
            data = self.body()
            if route == "register":
                return self.send(201, {"user": a.register(data.get("username"), data.get("password"))})
            token, username = a.login(data.get("username"), data.get("password"), self.client_address[0])
            return self.send(200, {"username": username}, headers=self.cookie(token))
        if route == "logout" and post:
            self.body()
            a.logout(self.token())
            return self.send(200, {"ok": True}, headers=self.cookie("", True))
        username = a.authenticate(self.token())
        party = a.party(username)
        if a.online(username):
            self.app.mirror(party)
        if route == "me" and not post:
            return self.send(200, dict(identity=party.identity.descriptor(), online=a.online(username),
                                       now=self.app.now(), unlocked=party.identity.secret_key is not None,
                                       demo=True, min_lock=self.app.chain.snapshot()["min_lock"], updates=party.store.updates()))
        if route == "updates" and not post:
            after = dict(item.split("=", 1) for item in urlsplit(self.path).query.split("&") if "=" in item).get("after")
            if after is not None and (not after.isdecimal() or len(after) > 16):
                raise HTTPError(400, "Invalid update cursor")
            return self.send(200, party.store.updates(int(after) if after is not None else None))
        if route == "password" and post:
            data = self.body()
            a.change_password(username, data.get("old_password"), data.get("new_password"))
            return self.send(200, {"ok": True, "message": "Password changed. Sign in again on each device"}, headers=self.cookie("", True))
        if route == "online" and post:
            data = self.body()
            if type(data.get("online")) is not bool:
                raise HTTPError(400, "online must be true or false")
            a.online(username, data["online"])
            return self.send(200, {"online": data["online"]})
        if route == "users" and not post:
            return self.send(200, {"users": a.users()})
        if route == "wallet" and not post:
            account = self.app.chain.account(party.identity.evm_address)
            account["balance"] = str(account["balance"])
            account["claimable"] = str(account["claimable"])
            return self.send(200, {"funds": a.user(username)["funds"], "account": account, "now": self.app.now()})
        if route in ("wallet/deposit", "withdraw", "claim") and post:
            self.app.chain_required(username)
            data = self.body()
            if route == "claim":
                amount = self.app.chain.claim(party.identity.evm_address)
                a.update_funds(username, amount)
            else:
                value = data.get("amount_wei", "")
                if not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]{0,77}", value):
                    raise HTTPError(400, "Enter a positive whole wei amount")
                amount = int(value)
                if route == "wallet/deposit":
                    if int(a.user(username)["funds"]) < amount:
                        raise HTTPError(400, "Insufficient test funds")
                    lock = data.get("lock_seconds", self.app.chain.snapshot()["min_lock"])
                    self.app.chain.deposit(party.identity.evm_address, party.identity.key_hash, amount, lock)
                    a.update_funds(username, -amount)
                else:
                    self.app.chain.withdraw(party.identity.evm_address, amount)
                    a.update_funds(username, amount)
            party.store.log(route.replace("/", "_"), data={"amount_wei": str(amount)})
            if route in ("wallet/deposit", "withdraw"):
                self.app.notify_funding(party)
            return self.send(200, {"ok": True, "amount_wei": str(amount)})
        if route == "escrows":
            if not post:
                return self.send(200, {"escrows": [self.app.detail(party, r) for r in party.store.all()]})
            data = self.body()
            seller = a.party(data.get("seller"), public_only=True).identity
            expiry = data.get("expires_at", self.app.now() + 3600)
            r = propose(party, seller, data.get("amount_wei"), data.get("description"), expiry, data.get("expected_sha256"))
            self.app.peer(party, r)
            return self.send(201, self.app.detail(party, r))
        match = re.fullmatch(r"escrows/([0-9a-f]{64})(?:/([a-z-]+))?", route)
        if match:
            escrow_id, action = match.groups()
            r = self.app.record(party, escrow_id)
            if not post:
                if not action:
                    return self.send(200, self.app.detail(party, r))
                if action == "bundle":
                    return self.send(200, export_bundle(r), headers={"Content-Disposition": f'attachment; filename="{escrow_id}.json"'})
                if action == "download":
                    if not r.delivery or not r.payload_path:
                        raise HTTPError(404, "No delivered file yet")
                    return self.send(200, Path(r.payload_path).read_bytes(), "application/octet-stream",
                                     {"Content-Disposition": f'attachment; filename="{filename(r.delivery["filename"])}"'})
            elif action == "cancel":
                self.app.chain_required(username)
                self.body()
                if r.cancellation and r.settlement:
                    return self.send(200, self.app.detail(party, r))
                if r.settlement or r.rejection:
                    raise HTTPError(409, "This agreement is already final and cannot be cancelled")
                r = cancel(party, escrow_id)
                self.app.peer(party, r)
                results = reconcile(party, self.app.chain, escrow_id=escrow_id)
                if not results or results[0]["outcome"] != "CANCELLED":
                    raise HTTPError(409, results[0]["reason"] if results else "Cancellation could not be recorded")
                self.app.mirror_peer_settlements(party, results)
                return self.send(200, self.app.detail(party, party.store.get(escrow_id)))
            elif action in ("countersign", "deliver", "accept"):
                if action == "deliver":
                    raw = self.body(MAX_PAYLOAD, raw=True)
                    r = deliver(party, escrow_id, raw, unquote(self.headers.get("X-Filename", "delivery.bin")))
                else:
                    data = self.body()
                    r = countersign(party, escrow_id) if action == "countersign" else accept(party, escrow_id, data.get("decision"))
                self.app.peer(party, r)
                return self.send(200, self.app.detail(party, r))
        if route == "verify-bundle" and post:
            data = self.body(36 * 1024 * 1024)
            bundle = data.get("bundle", data)
            with tempfile.TemporaryDirectory(prefix="pqe-verify-") as tmp:
                r, raw = record_from_bundle(bundle)
                if raw is not None:
                    path = Path(tmp) / "payload"
                    path.write_bytes(raw)
                    r.payload_path = str(path)
                v = verify_offline(r, self.app.now())
            return self.send(200, v.asdict())
        if route == "verify-file" and post:
            raw = self.body(MAX_PAYLOAD, raw=True)
            return self.send(200, dict(sha256=sha256_bytes(raw), size=len(raw)))
        if route == "reconcile" and post:
            self.app.chain_required(username)
            target = self.body().get("escrow_id")
            if target is not None:
                if not isinstance(target, str) or not re.fullmatch(r"[0-9a-f]{64}", target):
                    raise HTTPError(400, "Invalid agreement ID")
                self.app.record(party, target)
            self.app.mirror(party)
            results = reconcile(party, self.app.chain, escrow_id=target)
            self.app.mirror_peer_settlements(party, results)
            return self.send(200, {"results": results})
        if route == "chain" and not post:
            snapshot = self.app.chain.snapshot()
            for account in snapshot["accounts"].values():
                account["balance"] = str(account["balance"])
            snapshot["claimable"] = {key: str(value) for key, value in snapshot["claimable"].items()}
            for key in ("deposited", "withdrawn", "claimed"):
                snapshot[key] = str(snapshot[key])
            return self.send(200, snapshot)
        if route == "audit" and not post:
            return self.send(200, {"valid": party.store.verify_log(), "entries": party.store.audit()})
        if route == "lab/time" and post:
            data = self.body()
            seconds = data.get("seconds")
            if type(seconds) is not int or not 1 <= seconds <= 7 * 86400:
                raise HTTPError(400, "Move forward by 1 to 604800 whole seconds")
            self.app.offset += seconds
            with a.connect() as db:
                db.execute("UPDATE meta SET value=? WHERE key='offset'", (str(self.app.offset),))
            party.store.log("demo_clock_advanced", data={"seconds": seconds})
            a.cleanup()
            return self.send(200, {"now": self.app.now(), "message": "Demo clock advanced for all accounts"})
        if route in ("lab/attack", "lab/replay", "lab/double-spend") and post:
            data = self.body()
            kind = data.get("kind") if route == "lab/attack" else route[4:]
            return self.send(200, self.app.attack(party, kind, data.get("escrow_id"), data.get("options")))
        raise HTTPError(404, "Endpoint not found")


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = os.name != "nt"

    def server_bind(self):
        if os.name == "nt":
            # Windows SO_REUSEADDR permits two processes to share a listener.
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

    def __init__(self, address, app):
        self.app = app
        super().__init__(address, Handler)

    def service_actions(self):
        # Expired sessions also drop unlocked keys when no new HTTP request arrives.
        with self.app.lock:
            self.app.accounts.cleanup()
