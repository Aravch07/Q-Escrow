"""Transactional hosted API. Every request reconstructs its own signing context."""
import csv
import hashlib
import hmac
import io
import json
import logging
import os
import re
import secrets
import tempfile
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import unquote

from flask import Flask, Response, jsonify, request, send_from_directory
from psycopg.types.json import Jsonb
from werkzeug.exceptions import RequestEntityTooLarge

from escrow.crypto import b64, canonical_json, sha256_bytes, unb64
from escrow.protocol import MAX_PAYLOAD, deliver, filename, record_from_bundle
from escrow.reconcile import verify_offline
from .accounts import HTTPError
from .cloud_store import CloudAccounts, CloudLedger, connect_database, initialize_database
from .server import App, Handler, STATIC

CHUNK = 1024 * 1024
WRITE_LOCK = 7348261901


class CloudApp(App):
    def __init__(self, root, connection, key):
        self.root, self.offset, self.lock = Path(root), 0, threading.RLock()
        self.accounts = CloudAccounts(root, self.now, connection, key, request.headers.get("User-Agent", "Web browser"))
        self.chain = CloudLedger(connection, self.now)

    def detail(self, party, record, include_payload=False):
        return super().detail(party, record, include_payload=False)


class CloudHandler(Handler):
    def __init__(self, app):
        self.server = SimpleNamespace(app=app)
        self.headers = request.headers
        self.client_address = (request.headers.get("X-Real-IP", request.remote_addr or "unknown"), 0)
        self.path = request.path

    def token(self):
        return request.cookies.get("pqe_session", "")

    def cookie(self, token, clear=False):
        secure = "; Secure" if request.is_secure or os.environ.get("VERCEL") else ""
        return {"Set-Cookie": f"pqe_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={0 if clear else 43200}{secure}"}

    def body(self, limit=1024 * 1024, raw=False):
        if request.content_length is not None and request.content_length > limit:
            raise HTTPError(413, "This request is too large. Use the file chooser to upload in parts.")
        content = request.get_data()
        if len(content) > limit:
            raise HTTPError(413, "This request is too large")
        if raw:
            return content
        try:
            data = json.loads(content or b"{}")
            if not isinstance(data, dict):
                raise ValueError()
            return data
        except (ValueError, UnicodeDecodeError):
            raise HTTPError(400, "Send a valid JSON object")

    def send(self, status, data, content_type="application/json; charset=utf-8", headers=None):
        raw = data if isinstance(data, bytes) else canonical_json(data)
        return Response(raw, status=status, content_type=content_type, headers=headers)

    @property
    def connection(self):
        return self.app.accounts.connection

    def authenticated(self):
        name = self.app.accounts.authenticate(self.token())
        return name, self.app.accounts.party(name)

    def saved(self, name, escrow_id):
        row = self.connection.execute("SELECT body,file_hash FROM pqe_records WHERE owner=%s AND id=%s", (name, escrow_id)).fetchone()
        if not row:
            raise HTTPError(404, "Agreement not found for your account")
        return row

    def upload(self, owner, upload_id, purpose=None, escrow_id=None):
        row = self.connection.execute("SELECT * FROM pqe_uploads WHERE id=%s AND owner=%s", (upload_id, owner)).fetchone()
        if not row or row["created_at"] < int(time.time()) - 3600:
            raise HTTPError(404, "This upload expired. Choose the file again.")
        if purpose and row["purpose"] != purpose or escrow_id and row["escrow_id"] != escrow_id:
            raise HTTPError(400, "The upload belongs to a different action")
        parts = self.connection.execute("SELECT part,data FROM pqe_chunks WHERE upload_id=%s ORDER BY part", (upload_id,)).fetchall()
        expected = max(1, (row["size"] + CHUNK - 1) // CHUNK)
        if len(parts) != expected or [p["part"] for p in parts] != list(range(expected)):
            raise HTTPError(409, "The file is still uploading. Wait for it to finish.")
        raw = b"".join(bytes(p["data"]) for p in parts)
        if len(raw) != row["size"]:
            raise HTTPError(409, "The upload is incomplete. Choose the file again.")
        return row, raw

    def api(self, route, post):
        a, conn = self.app.accounts, self.connection
        if route == "register" and post:
            data = self.body()
            display = data.get("display_name", "")
            if not isinstance(display, str) or len(display) > 80:
                raise HTTPError(400, "Use a display name of up to 80 characters")
            result = super().api(route, post)
            conn.execute("UPDATE pqe_profiles SET display_name=%s WHERE username=%s", (display.strip(), data["username"]))
            return result
        if route in ("login", "logout"):
            return super().api(route, post)
        name, party = self.authenticated()
        if route == "me" and not post:
            result = super().api(route, post)
            data = json.loads(result.get_data())
            profile = conn.execute("SELECT display_name FROM pqe_profiles WHERE username=%s", (name,)).fetchone()
            data.update(hosted=True, demo=False, display_name=profile[0] if profile else "", max_file_size=MAX_PAYLOAD, chunk_size=CHUNK)
            return self.send(200, data)
        if route == "profile":
            if post:
                display = self.body().get("display_name", "")
                if not isinstance(display, str) or len(display) > 80:
                    raise HTTPError(400, "Use a display name of up to 80 characters")
                conn.execute("UPDATE pqe_profiles SET display_name=%s WHERE username=%s", (display.strip(), name))
                return self.send(200, {"ok": True})
            return self.send(200, dict(conn.execute("SELECT display_name FROM pqe_profiles WHERE username=%s", (name,)).fetchone()))
        if route == "sessions" and not post:
            rows = conn.execute("SELECT token_hash,created_at,expires,device FROM pqe_sessions WHERE username=%s AND expires>%s ORDER BY created_at DESC", (name, self.app.now())).fetchall()
            current = sha256_bytes(self.token().encode())
            return self.send(200, {"sessions": [dict(id=r["token_hash"], created_at=r["created_at"], expires=r["expires"], device=r["device"], current=r["token_hash"] == current) for r in rows]})
        if route == "sessions/revoke" and post:
            target = self.body().get("session_id")
            current = sha256_bytes(self.token().encode())
            if target == "others":
                conn.execute("DELETE FROM pqe_sessions WHERE username=%s AND token_hash<>%s", (name, current))
            elif isinstance(target, str) and re.fullmatch(r"[0-9a-f]{64}", target):
                conn.execute("DELETE FROM pqe_sessions WHERE username=%s AND token_hash=%s", (name, target))
            else:
                raise HTTPError(400, "Choose a session to sign out")
            return self.send(200, {"ok": True})
        if route == "notifications":
            if post:
                self.body()
                conn.execute("UPDATE pqe_profiles SET notifications_seen=%s WHERE username=%s", (self.app.now(), name))
                return self.send(200, {"ok": True})
            seen = conn.execute("SELECT notifications_seen FROM pqe_profiles WHERE username=%s", (name,)).fetchone()[0]
            rows = conn.execute("SELECT body FROM pqe_audit WHERE owner=%s ORDER BY id DESC LIMIT 40", (name,)).fetchall()
            events = [dict(id=r[0]["id"], event=r[0]["event"], at=r[0]["at"], escrow_id=r[0]["escrow_id"], unread=r[0]["at"] > seen) for r in rows]
            return self.send(200, {"events": events, "unread": sum(e["unread"] for e in events)})
        if route == "export" and not post:
            buffer = io.StringIO(newline="")
            writer = csv.writer(buffer)
            writer.writerow(["Agreement", "Description", "Buyer", "Seller", "Amount (wei)", "State", "Deadline (UTC epoch)"])
            for r in party.store.all():
                cells = [r.escrow_id, r.terms["description"], r.terms["buyer"]["name"], r.terms["seller"]["name"], r.terms["amount_wei"], r.state, r.terms["expires_at"]]
                writer.writerow(["'" + str(v) if str(v).startswith(("=", "+", "-", "@", "\t", "\r")) else v for v in cells])
            return self.send(200, buffer.getvalue().encode(), "text/csv; charset=utf-8", {"Content-Disposition": 'attachment; filename="pq-escrow-agreements.csv"'})
        note = re.fullmatch(r"escrows/([0-9a-f]{64})/notes", route)
        if note:
            self.saved(name, note[1])
            if post:
                value = self.body().get("note", "")
                if not isinstance(value, str) or len(value) > 4000:
                    raise HTTPError(400, "Keep your private note under 4,000 characters")
                conn.execute("INSERT INTO pqe_notes VALUES(%s,%s,%s,%s) ON CONFLICT(owner,escrow_id) DO UPDATE SET note=excluded.note,updated_at=excluded.updated_at", (name, note[1], value, self.app.now()))
                return self.send(200, {"ok": True})
            row = conn.execute("SELECT note,updated_at FROM pqe_notes WHERE owner=%s AND escrow_id=%s", (name, note[1])).fetchone()
            return self.send(200, dict(row) if row else {"note": "", "updated_at": None})
        if route == "uploads/start" and post:
            data = self.body()
            size, purpose, escrow_id = data.get("size"), data.get("purpose"), data.get("escrow_id")
            limit = 36 * 1024 * 1024 if purpose == "verify" else MAX_PAYLOAD
            if type(size) is not int or not 0 <= size <= limit or purpose not in ("delivery", "verify"):
                raise HTTPError(400, "Choose a supported file within the size limit")
            if purpose == "delivery":
                record = self.saved(name, escrow_id)["body"]
                if record["terms"]["seller"]["name"] != name:
                    raise HTTPError(403, "Only the seller can upload the delivery")
                if record["delivery"] or record["acceptance"] or record["settlement"] or record.get("cancellation"):
                    raise HTTPError(409, "This agreement already has a delivery or decision")
            conn.execute("DELETE FROM pqe_uploads WHERE created_at<%s", (self.app.now() - 3600,))
            active = conn.execute("SELECT COUNT(*),COALESCE(SUM(size),0) FROM pqe_uploads WHERE owner=%s", (name,)).fetchone()
            if active[0] >= 5 or active[1] + size > 100 * 1024 * 1024:
                raise HTTPError(429, "Finish your current uploads or try again in an hour")
            total = conn.execute("SELECT (SELECT COALESCE(SUM(size),0) FROM pqe_files)+(SELECT COALESCE(SUM(size),0) FROM pqe_uploads)").fetchone()[0]
            if total + size > 600 * 1024 * 1024:
                raise HTTPError(413, "The shared test workspace has reached its storage allowance. Please try a smaller file later.")
            used = conn.execute("SELECT COALESCE(SUM(f.size),0) FROM pqe_files f WHERE f.digest IN (SELECT file_hash FROM pqe_records WHERE owner=%s)", (name,)).fetchone()[0]
            if used + size > 150 * 1024 * 1024:
                raise HTTPError(413, "Your workspace has reached its 150 MB delivery allowance")
            upload_id = secrets.token_hex(16)
            conn.execute("INSERT INTO pqe_uploads VALUES(%s,%s,%s,%s,%s,%s,%s)", (upload_id, name, size, filename(data.get("filename", "delivery.bin")), purpose, escrow_id, self.app.now()))
            return self.send(201, {"upload_id": upload_id, "chunk_size": CHUNK})
        chunk = re.fullmatch(r"uploads/([0-9a-f]{32})/(\d+)", route)
        if chunk and post:
            row = conn.execute("SELECT * FROM pqe_uploads WHERE id=%s AND owner=%s", (chunk[1], name)).fetchone()
            if not row or row["created_at"] < self.app.now() - 3600:
                raise HTTPError(404, "Upload not found or expired")
            part = int(chunk[2]); count = max(1, (row["size"] + CHUNK - 1) // CHUNK)
            if not 0 <= part < count:
                raise HTTPError(400, "Invalid file part")
            raw = self.body(CHUNK, raw=True)
            if len(raw) != min(CHUNK, max(0, row["size"] - part * CHUNK)):
                raise HTTPError(400, "This file part is incomplete")
            old = conn.execute("SELECT data FROM pqe_chunks WHERE upload_id=%s AND part=%s", (chunk[1], part)).fetchone()
            if old and bytes(old[0]) != raw:
                raise HTTPError(409, "This file part already contains different bytes")
            conn.execute("INSERT INTO pqe_chunks VALUES(%s,%s,%s) ON CONFLICT DO NOTHING", (chunk[1], part, raw))
            return self.send(200, {"ok": True, "part": part})
        finish = re.fullmatch(r"escrows/([0-9a-f]{64})/deliver-upload", route)
        if finish and post:
            data = self.body(); row, raw = self.upload(name, data.get("upload_id"), "delivery", finish[1])
            result = deliver(party, finish[1], raw, row["filename"])
            self.app.peer(party, result)
            conn.execute("DELETE FROM pqe_uploads WHERE id=%s", (row["id"],))
            return self.send(200, self.app.detail(party, result))
        if route == "verify-upload" and post:
            row, raw = self.upload(name, self.body().get("upload_id"), "verify")
            try:
                bundle = json.loads(raw)
                record, payload = record_from_bundle(bundle)
            except (ValueError, UnicodeDecodeError, TypeError, KeyError) as exc:
                raise HTTPError(400, "Invalid signed bundle: " + str(exc))
            if payload is not None:
                target = self.app.root / "verify-payload"; target.write_bytes(payload); record.payload_path = str(target)
            verdict = verify_offline(record, self.app.now()).asdict()
            conn.execute("DELETE FROM pqe_uploads WHERE id=%s", (row["id"],))
            return self.send(200, verdict)
        artifact = re.fullmatch(r"escrows/([0-9a-f]{64})/(artifact|payload)", route)
        if artifact and not post:
            row = self.saved(name, artifact[1]); body = row["body"]; receipt = body.get("delivery")
            if artifact[2] == "payload":
                offset = request.args.get("offset", "0")
                if not receipt or not offset.isdecimal() or int(offset) > receipt["size"]:
                    raise HTTPError(400, "Invalid file offset")
                raw = conn.execute("SELECT substring(data FROM %s FOR %s) FROM pqe_files WHERE digest=%s", (int(offset) + 1, CHUNK, row["file_hash"])).fetchone()
                if not raw:
                    raise HTTPError(404, "Delivery file missing")
                return self.send(200, bytes(raw[0]), "application/octet-stream")
            return self.send(200, {"bundle": {"format": "PQE-v1", **{k: body[k] for k in ("escrow_id", "terms", "signatures", "delivery", "acceptance")}, **({"cancellation": body["cancellation"]} if body.get("cancellation") else {})},
                                   "file": {"size": receipt["size"], "sha256": receipt["sha256"], "filename": receipt["filename"]} if receipt else None})
        if route == "lab/time":
            raise HTTPError(403, "The shared live clock cannot be changed. Attack lab experiments use isolated practice copies.")
        if route == "escrows" and post:
            count = conn.execute("SELECT COUNT(*) FROM pqe_records WHERE owner=%s", (name,)).fetchone()[0]
            if count >= 100:
                raise HTTPError(400, "This workspace has reached its 100 agreement allowance")
        return super().api(route, post)


def create_app(database_url=None, session_key=None):
    app = Flask(__name__, static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = 3 * 1024 * 1024
    initialized, schema_lock = [False], threading.Lock()

    def key():
        value = session_key or os.environ.get("PQE_SESSION_KEY", "")
        if isinstance(value, bytes) and len(value) == 32:
            return value
        try:
            decoded = unb64(value)
            if len(decoded) == 32:
                return decoded
        except Exception:
            pass
        raise RuntimeError("The hosted session key has not been configured")

    @app.after_request
    def headers(response):
        response.headers.update({"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin",
            "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"})
        if request.is_secure or os.environ.get("VERCEL"):
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        return response

    @app.errorhandler(RequestEntityTooLarge)
    def too_large(exc):
        return jsonify(error="Use the file chooser to upload this file in smaller parts."), 413

    @app.get("/")
    @app.get("/app.js")
    @app.get("/hosted.js")
    @app.get("/experience.js")
    @app.get("/analytics.js")
    @app.get("/showcase.js")
    @app.get("/live.js")
    @app.get("/future.css")
    @app.get("/style.css")
    def static():
        name = "index.html" if request.path == "/" else request.path.lstrip("/")
        mime = "text/html" if name.endswith(".html") else "text/css" if name.endswith(".css") else "text/javascript"
        return Response((STATIC / name).read_bytes(), content_type=mime + "; charset=utf-8")

    @app.get("/assets/<path:name>")
    def visual_asset(name):
        return send_from_directory(STATIC / "assets", name)

    @app.get("/api/config")
    def config():
        return jsonify(hosted=True, registration=True, demo=False, max_file_size=MAX_PAYLOAD, chunk_size=CHUNK)

    @app.get("/api/health")
    def health():
        try:
            key()
            with connect_database(database_url) as conn:
                conn.execute("SELECT 1")
            return jsonify(ok=True, storage="postgres", version="2.1.1")
        except Exception:
            return jsonify(ok=False, error="Workspace storage is temporarily unavailable"), 503

    @app.get("/api/updates")
    def updates():
        # Read-only polling: do not acquire the global write lock or unlock keys.
        after = request.args.get("after")
        if after is not None and (not after.isdecimal() or len(after) > 16):
            return jsonify(error="Invalid update cursor"), 400
        try:
            token = sha256_bytes(request.cookies.get("pqe_session", "").encode())
            with connect_database(database_url) as conn:
                row = conn.execute("SELECT s.username,COALESCE(h.count,0) AS count,COALESCE(h.hash,'') AS hash FROM pqe_sessions s LEFT JOIN pqe_heads h ON h.owner=s.username WHERE s.token_hash=%s AND s.expires>%s", (token, int(time.time()))).fetchone()
                if not row:
                    return jsonify(error="Sign in to continue"), 401
                events = [] if after is None else [r[0] for r in conn.execute(
                    "SELECT body FROM pqe_audit WHERE owner=%s AND id>%s AND id<=%s ORDER BY id DESC LIMIT 20", (row["username"], int(after), row["count"]))]
                events = [{k: event[k] for k in ("id", "at", "event", "escrow_id", "data")} for event in events]
            return jsonify(count=row["count"], revision=str(row["count"]) + ":" + row["hash"], events=events)
        except Exception:
            logging.exception("Workspace update check failed")
            return jsonify(error="Live updates are reconnecting"), 503

    @app.route("/api/<path:route>", methods=["GET", "POST"])
    def api(route):
        post = request.method == "POST"
        if post:
            if request.headers.get("X-Requested-With") != "PQEscrow":
                return jsonify(error="Missing request protection header"), 403
            origin = request.headers.get("Origin")
            if origin and origin != request.host_url.rstrip("/"):
                return jsonify(error="Cross-origin requests are not allowed"), 403
        connection = None
        try:
            secret = key(); connection = connect_database(database_url)
            with schema_lock:
                if not initialized[0]:
                    initialize_database(connection); initialized[0] = True
            with tempfile.TemporaryDirectory(prefix="pqe-cloud-") as temp:
                with connection.transaction():
                    # Cross-instance writes, peer mirroring and ledger debits commit together.
                    connection.execute("SELECT pg_advisory_xact_lock(%s)", (WRITE_LOCK,))
                    hosted = CloudApp(temp, connection, secret)
                    handler = CloudHandler(hosted)
                    try:
                        if route in ("register", "uploads/start") and post:
                            identity = request.headers.get("X-Real-IP", request.remote_addr or "unknown")
                            bucket = hmac.digest(secret, (route + "/" + identity).encode(), "sha256").hex()
                            now = int(time.time()); limit = 12 if route == "register" else 60
                            count = connection.execute("INSERT INTO pqe_limits VALUES(%s,%s,1) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN pqe_limits.started<%s THEN 1 ELSE pqe_limits.count+1 END,started=CASE WHEN pqe_limits.started<%s THEN excluded.started ELSE pqe_limits.started END RETURNING count", (bucket, now, now - 3600, now - 3600)).fetchone()[0]
                            if count > limit:
                                return jsonify(error="Too many attempts. Please try again later."), 429
                        if route == "login":
                            # Failed authentication counters must survive this request.
                            try:
                                return handler.api(route, post)
                            except HTTPError as exc:
                                return jsonify(error=exc.message), exc.status
                        with connection.transaction():
                            return handler.api(route, post)
                    except HTTPError as exc:
                        return jsonify(error=exc.message), exc.status
                    finally:
                        hosted.accounts.keys.clear()
        except HTTPError as exc:
            return jsonify(error=exc.message), exc.status
        except (ValueError, TypeError, KeyError, OverflowError) as exc:
            return jsonify(error=str(exc) or "Check the fields and try again"), 400
        except Exception:
            logging.exception("Hosted request failed on %s", route)
            return jsonify(error="The workspace is temporarily unavailable. Please try again."), 503
        finally:
            if connection:
                connection.close()

    return app
