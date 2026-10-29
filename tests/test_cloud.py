"""Hosted integration checks use an isolated schema in the configured test DB."""
import copy
import hashlib
import os
import secrets
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

pytest.importorskip("flask")
psycopg = pytest.importorskip("psycopg")
pytest.importorskip("cryptography")
from psycopg import sql
from webapp import cloud
from webapp.cloud_store import connect_database

HEADERS = {"X-Requested-With": "PQEscrow"}
KEY = b"hosted-integration-test-key-32!!!"


@pytest.fixture
def hosted(monkeypatch):
    url = os.environ.get("PQE_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set PQE_TEST_DATABASE_URL for isolated hosted integration checks")
    schema = "pqe_test_" + secrets.token_hex(8)
    with connect_database(url) as connection:
        connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))

    def connect(*args):
        connection = connect_database(url)
        connection.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
        connection.commit()
        return connection

    monkeypatch.setattr(cloud, "connect_database", connect)
    key = hashlib.sha256(KEY).digest()
    factory = lambda: cloud.create_app(url, key)
    app = factory()
    yield app, factory, connect
    assert schema.startswith("pqe_test_")
    with connect_database(url) as connection:
        connection.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))


def post(client, path, data=None, raw=None):
    return client.post("/api/" + path, json={} if data is None else data, headers=HEADERS) if raw is None else client.post("/api/" + path, data=raw, headers=HEADERS)


def account(app, name, password="password123"):
    client = app.test_client()
    result = post(client, "register", dict(username=name, password=password, display_name=name.title()))
    assert result.status_code == 201, result.json
    assert post(client, "login", dict(username=name, password=password)).status_code == 200
    return client


def recreate(factory, client):
    fresh = factory().test_client()
    cookie = client.get_cookie("pqe_session")
    if cookie:
        fresh.set_cookie("pqe_session", cookie.value)
    return fresh


def setup_agreement(app, payload=b"the exact agreed delivery"):
    buyer, seller = account(app, "buyer"), account(app, "seller")
    assert post(buyer, "wallet/deposit", dict(amount_wei=str(2 * 10**18), lock_seconds=60)).status_code == 200
    now = buyer.get("/api/me").json["now"]
    response = post(buyer, "escrows", dict(seller="seller", amount_wei=str(10**18), description="Hosted delivery", expires_at=now + 3600, expected_sha256=hashlib.sha256(payload).hexdigest()))
    assert response.status_code == 201, response.json
    escrow_id = response.json["escrow_id"]
    assert post(seller, f"escrows/{escrow_id}/countersign").status_code == 200
    return buyer, seller, escrow_id


def upload(client, payload, escrow_id=None, purpose="delivery"):
    response = post(client, "uploads/start", dict(size=len(payload), filename="delivery.txt", purpose=purpose, escrow_id=escrow_id))
    assert response.status_code == 201, response.json
    upload_id = response.json["upload_id"]
    size = response.json["chunk_size"]
    for part, offset in enumerate(range(0, max(1, len(payload)), size)):
        response = post(client, f"uploads/{upload_id}/{part}", raw=payload[offset:offset + size])
        assert response.status_code == 200, response.json
    return upload_id


def test_register_and_session_survive_fresh_instances(hosted):
    app, factory, connect = hosted
    client = account(app, "new_person")
    assert client.get("/api/me").json["display_name"] == "New_Person"
    assert recreate(factory, client).get("/api/me").json["identity"]["name"] == "new_person"
    with connect() as connection:
        row = connection.execute("SELECT key_session FROM pqe_sessions").fetchone()
        assert row[0] and "password123" not in row[0]
    assert app.test_client().get("/api/wallet").status_code == 401
    assert post(client, "register", dict(username="new_person", password="password123")).status_code == 409
    assert client.get("/api/config").json["demo"] is False
    assert client.get("/api/health").json["storage"] == "postgres"


def test_complete_hosted_flow_wrong_file_retry_and_large_parts(hosted):
    app, factory, _ = hosted
    payload = b"verified bytes" * 85000
    buyer, seller, escrow_id = setup_agreement(app, payload)
    wrong = upload(seller, b"wrong file", escrow_id)
    response = post(seller, f"escrows/{escrow_id}/deliver-upload", {"upload_id": wrong})
    assert response.status_code == 400 and "fingerprint" in response.json["error"]
    assert seller.get(f"/api/escrows/{escrow_id}").json["state"] == "LOCKED"
    upload_id = upload(seller, payload, escrow_id)
    response = post(recreate(factory, seller), f"escrows/{escrow_id}/deliver-upload", {"upload_id": upload_id})
    assert response.status_code == 200, response.json
    assert "payload" not in response.json["bundle"]
    receipt = buyer.get(f"/api/escrows/{escrow_id}/artifact").json
    pieces = [buyer.get(f"/api/escrows/{escrow_id}/payload?offset={offset}").data for offset in range(0, len(payload), cloud.CHUNK)]
    assert b"".join(pieces) == payload
    assert receipt["file"]["sha256"] == hashlib.sha256(payload).hexdigest()
    assert post(buyer, "online", {"online": False}).status_code == 200
    assert post(recreate(factory, buyer), f"escrows/{escrow_id}/accept", {"decision": "release"}).status_code == 200
    assert post(buyer, "reconcile").status_code == 409
    post(buyer, "online", {"online": True})
    assert post(recreate(factory, buyer), "reconcile").json["results"][0]["outcome"] == "RELEASE"
    assert recreate(factory, seller).get(f"/api/escrows/{escrow_id}").json["state"] == "SETTLED"
    assert post(seller, "claim").json["amount_wei"] == str(10**18)
    assert seller.get("/api/wallet").json["funds"] == str(11 * 10**18)
    assert buyer.get("/api/audit").json["valid"] is True
    assert seller.get("/api/audit").json["valid"] is True


def test_private_access_notes_and_export(hosted):
    app, _, _ = hosted
    buyer, seller, escrow_id = setup_agreement(app)
    outsider = account(app, "outsider")
    assert outsider.get(f"/api/escrows/{escrow_id}").status_code == 404
    assert outsider.get(f"/api/escrows/{escrow_id}/artifact").status_code == 404
    assert post(outsider, f"escrows/{escrow_id}/notes", {"note": "intrusion"}).status_code == 404
    assert post(buyer, f"escrows/{escrow_id}/notes", {"note": "Private buyer checklist"}).status_code == 200
    assert buyer.get(f"/api/escrows/{escrow_id}/notes").json["note"] == "Private buyer checklist"
    assert seller.get(f"/api/escrows/{escrow_id}/notes").json["note"] == ""
    exported = buyer.get("/api/export")
    assert exported.status_code == 200 and escrow_id.encode() in exported.data
    assert post(buyer, "profile", {"display_name": "New display"}).status_code == 200
    assert buyer.get("/api/me").json["display_name"] == "New display"
    assert buyer.get("/api/notifications").json["unread"] > 0
    assert post(buyer, "notifications").status_code == 200
    assert buyer.get("/api/notifications").json["unread"] == 0


def test_revocation_password_change_and_expiry(hosted):
    app, factory, connect = hosted
    first = account(app, "secure_user")
    other = app.test_client()
    assert post(other, "login", dict(username="secure_user", password="password123")).status_code == 200
    assert len(first.get("/api/sessions").json["sessions"]) == 2
    assert post(first, "sessions/revoke", {"session_id": "others"}).status_code == 200
    assert recreate(factory, other).get("/api/me").status_code == 401
    assert post(first, "password", dict(old_password="password123", new_password="different-password")).status_code == 200
    assert recreate(factory, first).get("/api/me").status_code == 401
    assert post(other, "login", dict(username="secure_user", password="password123")).status_code == 401
    assert post(other, "login", dict(username="secure_user", password="different-password")).status_code == 200
    with connect() as connection:
        connection.execute("UPDATE pqe_sessions SET expires=0")
    assert recreate(factory, other).get("/api/me").status_code == 401


def test_persistent_login_throttle_csrf_and_isolated_lab(hosted):
    app, factory, _ = hosted
    client = account(app, "testing_user")
    assert client.post("/api/login", json=dict(username="testing_user", password="password123")).status_code == 403
    assert client.post("/api/login", json=dict(username="testing_user", password="password123"), headers={**HEADERS, "Origin":"https://evil.example"}).status_code == 403
    before = client.get("/api/chain").json
    assert post(client, "lab/time", {"seconds": 3600}).status_code == 403
    for kind in ("file", "signature", "price", "replay", "double-spend"):
        response = post(client, "lab/" + kind if kind in ("replay", "double-spend") else "lab/attack", {"kind":kind})
        assert response.status_code == 200, response.json
        assert response.json["blocked"] is True and response.json["outcome"] == "REJECT"
    assert client.get("/api/chain").json == before
    for _ in range(5):
        bad = factory().test_client()
        assert post(bad, "login", dict(username="testing_user", password="wrong")).status_code == 401
    assert post(factory().test_client(), "login", dict(username="testing_user", password="password123")).status_code == 429


def test_peer_failure_rolls_back_record_and_sequence(hosted, monkeypatch):
    app, _, connect = hosted
    buyer, seller = account(app, "buyer"), account(app, "seller")
    before = buyer.get("/api/audit").json
    def fail(*args):
        raise ValueError("Simulated peer failure")
    monkeypatch.setattr(cloud.CloudApp, "peer", fail)
    result = post(buyer, "escrows", dict(seller="seller", amount_wei=str(10**18), description="Atomic creation", expires_at=int(time.time()) + 3600))
    assert result.status_code == 400
    assert buyer.get("/api/escrows").json["escrows"] == []
    assert buyer.get("/api/audit").json == before
    with connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM pqe_sequences").fetchone()[0] == 0


def test_concurrent_instances_cannot_repeat_settlement(hosted):
    app, factory, _ = hosted
    payload = b"concurrent settlement evidence"
    buyer, seller, escrow_id = setup_agreement(app, payload)
    uploaded = upload(seller, payload, escrow_id)
    assert post(seller, f"escrows/{escrow_id}/deliver-upload", {"upload_id": uploaded}).status_code == 200
    assert post(buyer, f"escrows/{escrow_id}/accept", {"decision": "release"}).status_code == 200
    first, second = recreate(factory, buyer), recreate(factory, buyer)
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda client: post(client, "reconcile"), [first, second]))
    assert all(response.status_code == 200 for response in responses)
    assert sum(result["outcome"] == "RELEASE" for response in responses for result in response.json["results"]) == 1
    snapshot = buyer.get("/api/chain").json
    assert len(snapshot["settlements"]) == 1
    seller_address = seller.get("/api/me").json["identity"]["evm_address"]
    assert snapshot["claimable"][seller_address] == str(10**18)


def test_upload_ownership_parts_and_storage_budget(hosted):
    app, _, connect = hosted
    owner, outsider = account(app, "owner"), account(app, "outsider")
    result = post(owner, "uploads/start", dict(size=2, filename="evidence.json", purpose="verify"))
    upload_id = result.json["upload_id"]
    assert post(outsider, f"uploads/{upload_id}/0", raw=b"{}").status_code == 404
    assert post(owner, f"uploads/{upload_id}/1", raw=b"{}").status_code == 400
    assert post(owner, f"uploads/{upload_id}/0", raw=b"{").status_code == 400
    assert post(owner, f"uploads/{upload_id}/0", raw=b"{}").status_code == 200
    assert post(owner, f"uploads/{upload_id}/0", raw=b"{}").status_code == 200
    assert post(owner, f"uploads/{upload_id}/0", raw=b"[]").status_code == 409
    with connect() as connection:
        connection.execute("INSERT INTO pqe_files VALUES(%s,%s,%s)", ("a" * 64, b"", 600 * 1024 * 1024))
    result = post(owner, "uploads/start", dict(size=1, filename="one-byte.json", purpose="verify"))
    assert result.status_code == 413 and "storage allowance" in result.json["error"]


def test_cancellation_and_read_only_live_updates(hosted):
    app, factory, connect = hosted
    buyer, seller, outsider = account(app, 'buyer'), account(app, 'seller'), account(app, 'outsider')
    assert app.test_client().get('/api/updates').status_code == 401
    initial = seller.get('/api/updates').json
    assert seller.get('/api/updates').json == initial
    for actor in (seller, buyer):
        proposal = post(buyer, 'escrows', dict(seller='seller',amount_wei=str(10**18),description='Cancelable online',expires_at=int(time.time()) + 3600))
        assert proposal.status_code == 201, proposal.json
        id = proposal.json['escrow_id']
        updates = seller.get('/api/updates?after=' + str(initial['count'])).json
        assert updates['revision'] != initial['revision']
        assert updates['events'][0]['data']['state'] == 'PROPOSED'
        assert post(outsider, f'escrows/{id}/cancel').status_code == 404
        if actor is buyer:
            assert post(seller, f'escrows/{id}/countersign').status_code == 200
            uploaded = upload(seller, b'saved delivery', id)
            assert post(seller, f'escrows/{id}/deliver-upload', {'upload_id':uploaded}).status_code == 200
        before = buyer.get('/api/wallet').json
        result = post(actor, f'escrows/{id}/cancel')
        assert result.status_code == 200, result.json
        assert result.json['state'] == 'CANCELLED'
        assert buyer.get('/api/wallet').json['account'] == before['account']
        assert buyer.get(f'/api/escrows/{id}').json['state'] == seller.get(f'/api/escrows/{id}').json['state'] == 'CANCELLED'
        assert recreate(factory, actor).get(f'/api/escrows/{id}').json['state'] == 'CANCELLED'
        artifact = actor.get(f'/api/escrows/{id}/artifact').json['bundle']
        assert artifact['cancellation']['escrow_id'] == id
        assert post(actor, f'escrows/{id}/cancel').status_code == 200
        assert post(seller, 'uploads/start', dict(size=1,filename='late.txt',purpose='delivery',escrow_id=id)).status_code == 409
    assert seller.get('/api/updates?after=bad').status_code == 400
    assert post(buyer, 'reconcile').json['results'] == []
    # Polling must not create audits, sessions, or acquire the writer lock.
    with connect() as connection:
        before = connection.execute('SELECT COUNT(*) FROM pqe_audit').fetchone()[0]
    assert seller.get('/api/updates').status_code == 200
    with connect() as connection:
        assert connection.execute('SELECT COUNT(*) FROM pqe_audit').fetchone()[0] == before
    reader = recreate(factory, seller)
    with ThreadPoolExecutor(max_workers=1) as executor:
        with connect() as writer:
            writer.execute('SELECT pg_advisory_xact_lock(%s)', (cloud.WRITE_LOCK,))
            assert executor.submit(reader.get, '/api/updates').result(timeout=20).status_code == 200
    assert all(event['escrow_id'] is None for event in outsider.get('/api/updates?after=0').json['events'])


def test_cancel_racing_payment_has_one_final_outcome(hosted):
    app, factory, _ = hosted
    payload = b'concurrent cancellation evidence'
    buyer, seller, id = setup_agreement(app, payload)
    uploaded = upload(seller, payload, id)
    assert post(seller, f'escrows/{id}/deliver-upload', {'upload_id':uploaded}).status_code == 200
    assert post(buyer, f'escrows/{id}/accept', {'decision':'release'}).status_code == 200
    first, second = recreate(factory, buyer), recreate(factory, seller)
    with ThreadPoolExecutor(max_workers=2) as executor:
        cancel_future = executor.submit(post, second, f'escrows/{id}/cancel')
        settle_future = executor.submit(post, first, 'reconcile')
        cancelled, settled = cancel_future.result(), settle_future.result()
    assert cancelled.status_code in (200,409) and settled.status_code == 200
    a, b = buyer.get(f'/api/escrows/{id}').json, seller.get(f'/api/escrows/{id}').json
    assert a['state'] == b['state']
    snapshot = buyer.get('/api/chain').json
    assert len(snapshot['settlements']) == 1
    if a['state'] == 'CANCELLED':
        assert cancelled.status_code == 200
        assert snapshot['settlements'][id]['release'] is False
    else:
        assert a['state'] == 'SETTLED' and cancelled.status_code == 409
        assert snapshot['settlements'][id]['release'] is True


def test_unfunded_payment_remains_retryable_and_completes_after_deposit(hosted):
    app, factory, _ = hosted
    buyer, seller = account(app, 'buyer'), account(app, 'seller')
    proposal = post(buyer, 'escrows', dict(seller='seller',amount_wei=str(10**18),description='Retry missing deposit',expires_at=int(time.time())+3600))
    assert proposal.status_code == 201
    id = proposal.json['escrow_id']
    assert post(seller, f'escrows/{id}/countersign').status_code == 200
    uploaded = upload(seller, b'unchanged approved delivery', id)
    assert post(seller, f'escrows/{id}/deliver-upload', {'upload_id':uploaded}).status_code == 200
    assert post(buyer, f'escrows/{id}/accept', {'decision':'release'}).status_code == 200
    before = buyer.get(f'/api/escrows/{id}').json
    assert post(buyer, 'reconcile', {'escrow_id':id}).json['results'][0]['outcome'] == 'HOLD'
    fresh = recreate(factory, buyer)
    held = fresh.get(f'/api/escrows/{id}').json
    assert held['state'] == 'ACCEPTED' and held['rejection'] is None
    assert held['funding']['registered'] is False
    cursor = seller.get('/api/updates').json['count']
    assert post(fresh, 'wallet/deposit', {'amount_wei':str(10**18),'lock_seconds':60}).status_code == 200
    assert any(e['event']=='buyer_funding_updated' for e in seller.get('/api/updates?after='+str(cursor)).json['events'])
    assert post(fresh, 'reconcile', {'escrow_id':id}).json['results'][0]['outcome'] == 'RELEASE'
    after = seller.get(f'/api/escrows/{id}').json
    assert after['state'] == 'SETTLED' and after['bundle']['signatures'] == before['bundle']['signatures']
    assert seller.get('/api/wallet').json['account']['claimable'] == str(10**18)
