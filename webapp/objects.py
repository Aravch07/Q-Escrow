"""Private R2 gateway with durable, conservative free-tier allowances."""
import hashlib
import os
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from urllib.parse import quote
from urllib.request import Request, urlopen

from .accounts import HTTPError

STORAGE_LIMIT = 8_000_000_000
WRITE_LIMIT = 800_000
READ_LIMIT = 8_000_000
connection_context = ContextVar("pqe_object_connection", default=None)


def configured():
    return bool(os.environ.get("PQE_R2_GATEWAY") and os.environ.get("PQE_R2_GATEWAY_SECRET"))


def reserve(kind, size=0):
    """Commit before network I/O, including when the outer request rolls back.

    Every upload consumes its bytes permanently, even after deletion or failure.
    This intentionally overestimates storage. Operations use a rolling 35-day
    window so a billing-period boundary cannot prematurely reset them.
    """
    import psycopg
    from psycopg import sql

    current = connection_context.get()
    if current is None:
        raise RuntimeError("Storage requires a database allowance")
    schema = current.execute("SELECT current_schema()").fetchone()[0]
    now = datetime.now(timezone.utc)
    day = now.strftime("%Y-%m-%d")
    cutoff = (now - timedelta(days=35)).strftime("%Y-%m-%d")
    with psycopg.connect(current.info.dsn, password=current.info.password, connect_timeout=10) as conn:
        conn.execute("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
        conn.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
        conn.execute("SELECT pg_advisory_xact_lock(7348261902)")
        used = conn.execute("SELECT COALESCE(SUM(used),0) FROM pqe_storage_budget WHERE name LIKE %s AND name>=%s",
                            (kind + "/%", kind + "/" + cutoff)).fetchone()[0]
        capacity = WRITE_LIMIT if kind == "writes" else READ_LIMIT
        if used >= capacity:
            raise HTTPError(429, "File storage has reached its free request allowance. Try again later.")
        if size is not None and kind == "writes":
            total = conn.execute("SELECT used FROM pqe_storage_budget WHERE name='bytes'").fetchone()
            if (total[0] if total else 0) + size + 1024 > STORAGE_LIMIT:
                raise HTTPError(413, "The free storage allowance is full. New uploads are paused to prevent charges.")
            conn.execute("INSERT INTO pqe_storage_budget VALUES('bytes',%s) ON CONFLICT(name) DO UPDATE SET used=pqe_storage_budget.used+excluded.used",
                         (size + 1024,))
        conn.execute("INSERT INTO pqe_storage_budget VALUES(%s,1) ON CONFLICT(name) DO UPDATE SET used=pqe_storage_budget.used+1",
                     (kind + "/" + day,))


def transfer(method, key, raw=None, offset=None, length=None):
    if not configured():
        raise RuntimeError("Private file storage is not configured")
    if method in ("PUT", "GET"):
        reserve("writes" if method == "PUT" else "reads", len(raw) if method == "PUT" else 0)
    headers = {"Authorization": "Bearer " + os.environ["PQE_R2_GATEWAY_SECRET"],
               "Content-Type": "application/octet-stream", "User-Agent": "PQEscrow/2.3"}
    if offset is not None:
        headers["Range"] = f"bytes={offset}-{offset + length - 1}"
    url = os.environ["PQE_R2_GATEWAY"].rstrip("/") + "/" + quote(key, safe="/")
    with urlopen(Request(url, data=raw, method=method, headers=headers), timeout=25) as response:
        return response.read()


def put(key, raw):
    transfer("PUT", key, raw=raw)


def get(key, offset=None, length=None):
    return transfer("GET", key, offset=offset, length=length)


def delete(key):
    transfer("DELETE", key)


def file_bytes(connection, digest, offset=None, length=None):
    row = connection.execute("SELECT object_key FROM pqe_files WHERE digest=%s", (digest,)).fetchone()
    if not row:
        raise ValueError("Delivery file missing")
    if row["object_key"]:
        return get(row["object_key"], offset, length)
    if offset is None:
        raw = connection.execute("SELECT data FROM pqe_files WHERE digest=%s", (digest,)).fetchone()[0]
    else:
        raw = connection.execute("SELECT substring(data FROM %s FOR %s) FROM pqe_files WHERE digest=%s",
                                 (offset + 1, length, digest)).fetchone()[0]
    if raw is None:
        raise ValueError("Delivery file missing")
    return bytes(raw)


def save_file(connection, raw):
    digest = hashlib.sha256(raw).hexdigest()
    old = connection.execute("SELECT object_key FROM pqe_files WHERE digest=%s", (digest,)).fetchone()
    if old:
        return digest
    key = "deliveries/" + digest if configured() else None
    if key:
        put(key, raw)
    connection.execute("INSERT INTO pqe_files(digest,data,size,object_key) VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                       (digest, None if key else raw, len(raw), key))
    return digest
