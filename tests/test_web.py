import copy
import http.cookiejar
import json
import threading
import urllib.error
import urllib.request
from pathlib import Path
import pytest
from escrow.chain import ETH
from escrow.crypto import b64, canonical_json, sha256_bytes, unb64
from webapp.server import App, Handler, Server
from webapp.security import seal, unseal
from conftest import legacy_delivery


@pytest.mark.parametrize("failure", [BrokenPipeError, ConnectionResetError, ConnectionAbortedError])
@pytest.mark.parametrize("stage", ["headers", "body", "request"])
def test_disconnected_browser_is_not_retried_as_bad_request(monkeypatch, failure, stage):
    handler = object.__new__(Handler)
    sent = []

    def disconnect(*args, **kwargs):
        raise failure("Browser closed the connection")

    if stage == "request":
        handler.path = "/api/me"
        handler.headers = {}
        handler.server = type("TestServer", (), {"app": type("TestApp", (), {"lock": threading.RLock()})()})()
        handler.api = disconnect
        handler.send = lambda *args, **kwargs: sent.append(args)
        handler.dispatch(False)
        assert sent == []
    else:
        handler.send_response = lambda *args: sent.append(args[0])
        handler.send_header = lambda *args: None
        handler.end_headers = disconnect if stage == "headers" else lambda: None
        handler.wfile = type("ClosedStream", (), {"write": staticmethod(disconnect)})()
        handler.send(200, {"ok": True})
        assert sent == [200]


class Client:
    def __init__(self, base):
        self.base = base
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def request(self, path, data=None, *, raw=False, csrf=True, headers=None):
        h = dict(headers or {})
        if data is not None:
            if csrf: h['X-Requested-With'] = 'PQEscrow'
            if not raw: h['Content-Type'] = 'application/json'
            data = data if raw else canonical_json(data)
        req = urllib.request.Request(self.base + path, data=data, headers=h)
        try:
            response = self.opener.open(req, timeout=30)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            content = response.read()
            result = json.loads(content) if response.headers.get_content_type() == 'application/json' else content
            return response.status, result, response.headers

    def get(self, path): return self.request('/api/' + path)
    def post(self, path, data=None, **kwargs): return self.request('/api/' + path, {} if data is None else data, **kwargs)
    def login(self, name='alice', password='demo1234'): return self.post('login', dict(username=name, password=password))


class World:
    def __init__(self, root):
        self.root = root
        self.clients = []
        self.start()

    def start(self):
        self.app = App(self.root, min_lock=60, seed_demo=True)
        self.server = Server(('127.0.0.1', 0), self.app)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'
        for client in self.clients: client.base = self.base

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(5)
        self.app.accounts.keys.clear()

    def restart(self):
        self.stop()
        self.start()

    def client(self, name=None):
        c = Client(self.base)
        self.clients.append(c)
        if name: assert c.login(name)[0] == 200
        return c


@pytest.fixture
def web(tmp_path):
    world = World(tmp_path / 'site')
    yield world
    world.stop()


def create(a, **extra):
    status, r, _ = a.post('escrows', {**dict(seller='bob', amount_wei=str(ETH), description='A verified design file'), **extra})
    assert status == 201, r
    return r['escrow_id']


def delivery(a, b, **extra):
    id = create(a, **extra)
    assert b.post('escrows/' + id + '/countersign')[0] == 200
    status, r, _ = b.post('escrows/' + id + '/deliver', b'design file content', raw=True, headers={'X-Filename':'../../design.txt'})
    assert status == 200, r
    return id


def accepted(a,b,**extra):
    id = delivery(a,b,**extra)
    assert a.post('escrows/' + id + '/accept', {'decision':'release'})[0] == 200
    return id


def test_static_security_headers_and_csrf(web):
    c = web.client()
    for path in ('/','/app.js','/style.css'):
        status, body, headers = c.request(path)
        assert status == 200 and len(body) > 500
        assert "default-src 'self'" in headers['Content-Security-Policy']
        assert 'unsafe-inline' not in headers['Content-Security-Policy']
        assert headers['X-Frame-Options'] == 'DENY'
        assert headers['X-Content-Type-Options'] == 'nosniff'
        assert headers['Referrer-Policy'] == 'no-referrer'
    assert c.get('me')[0] == 401
    assert c.post('login', {'username':'alice','password':'demo1234'}, csrf=False)[0] == 403
    assert c.post('login', {'username':'alice','password':'demo1234'}, headers={'Origin':'http://evil.test'})[0] == 403
    status,_,headers = c.login()
    assert status == 200
    assert 'HttpOnly' in headers['Set-Cookie'] and 'SameSite=Strict' in headers['Set-Cookie']
    token = next(iter(c.jar)).value
    with web.app.accounts.connect() as db:
        row = db.execute('SELECT * FROM sessions').fetchone()
    assert len(token) == 64 and row['token_hash'] == sha256_bytes(token.encode())
    assert token != row['token_hash']


@pytest.mark.parametrize('username,password',[('ab','password1'),('ALICE','password1'),('bad-name','password1'),('valid_name','short')])
def test_registration_rules(web,username,password):
    assert web.client().post('register',dict(username=username,password=password))[0] == 400


def test_register_success_and_password_salt(web):
    c = web.client()
    assert c.post('register',dict(username='new_user',password='password1'))[0] == 201
    assert c.login('new_user','password1')[0] == 200
    assert c.get('me')[1]['identity']['name'] == 'new_user'
    assert c.post('register',dict(username='new_user',password='password1'))[0] == 409
    alice,bob = [web.app.accounts.user(name) for name in ('alice','bob')]
    assert alice['salt'] != bob['salt'] and alice['password'] != bob['password']


def test_throttle_user_and_address(web):
    c = web.client()
    for _ in range(5): assert c.login('alice','wrong')[0] == 401
    assert c.login()[0] == 429
    assert c.login('bob')[0] == 429  # Same client address, different user.
    web.app.accounts.failures = {('user','alice'):[0]}
    assert c.login()[0] == 200


def test_full_lifecycle_offline_and_peer_settlement(web):
    a,b = web.client('alice'),web.client('bob')
    id = delivery(a,b)
    assert a.post('online',{'online':False})[0] == 200
    assert a.post('escrows/' + id + '/accept',{'decision':'release'})[0] == 200
    assert b.get('escrows/' + id)[1]['state'] == 'ACCEPTED'
    assert a.post('reconcile')[0] == 409
    assert a.post('wallet/deposit',{'amount_wei':'1','lock_seconds':60})[0] == 409
    assert a.post('withdraw',{'amount_wei':'1'})[0] == 409
    assert a.post('claim')[0] == 409
    assert a.post('online',{'online':True})[0] == 200
    result = a.post('reconcile')
    assert result[0] == 200 and result[1]['results'][0]['outcome'] == 'RELEASE'
    own = a.get('escrows/' + id)[1]
    peer = b.get('escrows/' + id)[1]
    assert own['state'] == peer['state'] == 'SETTLED'
    assert peer['settlement']['note'] == 'release'
    assert not peer['rejection']
    assert b.post('reconcile')[1]['results'] == []
    assert b.get('wallet')[1]['account']['claimable'] == str(ETH)
    assert b.post('claim')[1]['amount_wei'] == str(ETH)
    assert b.get('wallet')[1]['funds'] == str(11*ETH)
    assert all(s['ok'] and s['bytes'] == 3309 for s in own['seals'])
    assert a.get('audit')[1]['valid']


def test_roles_state_download_and_upload_limits(web):
    a,b,c = (web.client(name) for name in ('alice','bob','carol'))
    id = create(a)
    assert a.post('escrows/' + id + '/countersign')[0] == 400
    assert b.post('escrows/' + id + '/deliver',b'early',raw=True)[0] == 400
    assert c.get('escrows/' + id)[0] == 404
    assert c.get('escrows/' + id + '/bundle')[0] == 404
    assert c.get('escrows/' + id + '/download')[0] == 404
    assert c.post('escrows/' + id + '/accept',{'decision':'release'})[0] == 404
    assert b.post('escrows/' + id + '/countersign')[0] == 200
    assert b.post('escrows/' + id + '/countersign')[0] == 400
    assert a.post('escrows/' + id + '/deliver',b'wrong role',raw=True)[0] == 400
    assert b.post('escrows/' + id + '/deliver',b'x'*(25*1024*1024+1),raw=True)[0] == 413
    assert b.post('escrows/' + id + '/deliver',b'actual content',raw=True,headers={'X-Filename':'..%2F..%2Fsecret.html'})[0] == 200
    status,raw,headers = a.get('escrows/' + id + '/download')
    assert status == 200 and raw == b'actual content'
    assert headers.get_content_type() == 'application/octet-stream'
    assert headers['Content-Disposition'] == 'attachment; filename="secret.html"'
    assert b.post('escrows/' + id + '/accept',{'decision':'release'})[0] == 400
    assert a.post('escrows/' + id + '/accept',{'decision':'refund'})[0] == 200
    assert a.post('escrows/' + id + '/accept',{'decision':'release'})[0] == 400


@pytest.mark.parametrize('expected',[None,'f'*64])
def test_refund_paths(web,expected):
    a,b = web.client('alice'),web.client('bob')
    if expected:
        id=create(a,expected_sha256=expected)
        assert b.post('escrows/'+id+'/countersign')[0]==200
        seller=web.app.accounts.party('bob')
        record=legacy_delivery(seller,id)
        web.app.peer(seller,record)
        assert a.post('escrows/' + id + '/accept',{'decision':'release'})[0] == 400
    else:
        id=delivery(a,b)
        assert a.post('escrows/' + id + '/accept',{'decision':'refund'})[0] == 200
    assert a.post('reconcile')[1]['results'][0]['outcome'] == 'REFUND'
    assert a.get('wallet')[1]['account']['balance'] == str(5*ETH)


def test_wrong_file_upload_is_atomic_and_retryable(web):
    a,b=web.client('alice'),web.client('bob');right=b'agreed file'
    id=create(a,expected_sha256=sha256_bytes(right));b.post('escrows/'+id+'/countersign')
    parties=[web.app.accounts.party(name) for name in ('alice','bob')]
    before=[p.store.audit() for p in parties]
    status,result,_=b.post('escrows/'+id+'/deliver',b'wrong file',raw=True)
    assert status==400 and 'does not match the agreed' in result['error']
    for p,audit in zip(parties,before):
        assert p.store.get(id).state=='LOCKED' and p.store.get(id).delivery is None
        assert p.store.audit()==audit and not (p.store.vault/id/'payload').exists()
    assert b.post('escrows/'+id+'/deliver',right,raw=True)[0]==200
    assert a.get('escrows/'+id)[1]['delivery']['sha256']==sha256_bytes(right)


def test_time_machine_expiry_and_withdraw(web):
    a = web.client('alice')
    id = create(a,expires_at=web.app.now()+60)
    assert a.post('withdraw',{'amount_wei':str(ETH)})[0] == 400
    assert a.post('lab/time',{'seconds':3601})[0] == 200
    assert a.post('reconcile')[1]['results'][0]['outcome'] == 'REFUND'
    assert a.post('withdraw',{'amount_wei':str(ETH)})[0] == 200
    assert a.get('escrows/' + id)[1]['settlement']['note'] == 'refund'
    assert a.post('lab/time',{'seconds':-1})[0] == 400


def test_insufficient_balance_and_unregistered(web):
    a,b = web.client('alice'),web.client('bob')
    status,r,_=a.post('escrows',dict(seller='bob',amount_wei=str(6*ETH),description='Over-committed'))
    assert status==201
    id=r['escrow_id']
    b.post('escrows/'+id+'/countersign');b.post('escrows/'+id+'/deliver',b'file',raw=True)
    a.post('escrows/'+id+'/accept',{'decision':'release'})
    result=a.post('reconcile')[1]['results'][0]
    assert result['outcome']=='REJECT' and 'Insufficient' in result['reason']
    # Bob creates a new buyer agreement but has not registered a buyer key.
    r=b.post('escrows',dict(seller='alice',amount_wei='1',description='Unregistered buyer'))[1]
    result=next(x for x in b.post('reconcile')[1]['results'] if x['escrow_id']==r['escrow_id'])
    assert result['outcome']=='REJECT' and 'not registered' in result['reason']


def test_attack_lab_and_verify(web):
    a,b=web.client('alice'),web.client('bob');id=accepted(a,b)
    before=copy.deepcopy(web.app.chain.snapshot())
    record_before=a.get('escrows/'+id)[1]['bundle']
    for kind in ('file','signature','price','replay','double-spend'):
        path='lab/'+kind if kind in ('replay','double-spend') else 'lab/attack'
        status,result,_=a.post(path,{'kind':kind,'escrow_id':id})
        assert status==200 and result['blocked'] and result['isolated'],result
    assert web.app.chain.snapshot()==before
    assert a.get('escrows/'+id)[1]['bundle']==record_before
    assert a.post('verify-file',b'independent',raw=True)[1]['sha256']==sha256_bytes(b'independent')
    assert a.post('verify-bundle',{'bundle':record_before})[1]['outcome']=='RELEASE'
    record_before['terms']['amount_wei']='900'
    assert a.post('verify-bundle',{'bundle':record_before})[0]==400


def test_lab_practice_works_without_deliveries_and_is_isolated(web):
    c=web.client('carol');before=copy.deepcopy(web.app.chain.snapshot());audit=c.get('audit')[1]
    for kind,options in [('file',{'offset':2}),('signature',{'signature_byte':0}),('price',{'multiplier':7}),
                         ('replay',{'attempts':4}),('double-spend',{'copies':3})]:
        route='lab/'+kind if kind in ('replay','double-spend') else 'lab/attack'
        status,result,_=c.post(route,dict(kind=kind,options=options))
        assert status==200 and result['blocked'] and result['isolated'],result
        assert result['changes'] and result['before_checks'] and result['after_checks']
        assert all(step['ok'] for step in result['steps'])
    assert web.app.chain.snapshot()==before
    assert c.get('escrows')[1]['escrows']==[] and c.get('audit')[1]==audit


def test_lab_selected_evidence_obeys_account_access(web):
    a,b,c=web.client('alice'),web.client('bob'),web.client('carol')
    id=accepted(a,b)
    assert c.post('lab/attack',dict(kind='file',escrow_id=id))[0]==404
    assert a.post('lab/attack',dict(kind='file',escrow_id='f'*64))[0]==404


@pytest.mark.parametrize('kind,options',[
    ('file',{'offset':-1}),('file',{'offset':99999}),('file',{'offset':True}),
    ('signature',{'signature_byte':3309}),('price',{'multiplier':1}),('price',{'multiplier':2.5}),
    ('replay',{'attempts':6}),('double-spend',{'copies':1}),('file',[]),
])
def test_lab_rejects_invalid_settings(web,kind,options):
    c=web.client('alice');before=web.app.chain.snapshot()
    route='lab/'+kind if kind in ('replay','double-spend') else 'lab/attack'
    assert c.post(route,dict(kind=kind,options=options))[0]==400
    assert web.app.chain.snapshot()==before


def test_password_change_ends_all_sessions_and_reseals(web):
    a,second=web.client('alice'),web.client('alice')
    old=web.app.accounts.user('alice')['key_blob']
    assert a.post('password',dict(old_password='bad',new_password='newpass123'))[0]==401
    assert a.post('password',dict(old_password='demo1234',new_password='newpass123'))[0]==200
    assert a.get('me')[0]==second.get('me')[0]==401
    assert 'alice' not in web.app.accounts.keys
    assert old!=web.app.accounts.user('alice')['key_blob']
    assert a.login('alice','demo1234')[0]==401
    assert a.login('alice','newpass123')[0]==200


def test_key_encrypted_and_only_while_signed_in(web):
    assert web.app.accounts.keys=={}
    a,both=web.client('alice'),web.client('alice')
    secret=web.app.accounts.keys['alice']
    u=web.app.accounts.user('alice')
    assert unseal(json.loads(u['key_blob']),'demo1234')==secret
    encrypted=unb64(json.loads(u['key_blob'])['ciphertext'])
    assert encrypted!=secret and secret[64:128] not in encrypted
    for file in web.root.rglob('*'):
        if file.is_file() and file.suffix not in ('.lock',):
            assert secret[64:160] not in file.read_bytes()
    assert a.post('logout')[0]==200 and 'alice' in web.app.accounts.keys
    assert both.post('logout')[0]==200 and 'alice' not in web.app.accounts.keys
    assert web.app.accounts.party('alice',public_only=True).identity.secret_key is None


def test_restart_requires_new_login(web):
    a=web.client('alice')
    web.restart()
    status,error,_=a.get('me')
    assert status==401 and error['error']=='Sign in again to unlock your signing key'
    assert web.app.accounts.keys=={}
    assert a.login()[0]==200
    assert a.get('me')[0]==200


def test_expired_session_drops_key(web):
    a=web.client('alice')
    assert a.post('lab/time',{'seconds':12*3600+1})[0]==200
    assert a.get('me')[0]==401 and 'alice' not in web.app.accounts.keys


def test_counterparty_never_given_secret(web,monkeypatch):
    a,b=web.client('alice'),web.client('bob')
    original=web.app.accounts.party;opened=[]
    def tracked(name,public_only=False):
        party=original(name,public_only)
        if public_only: opened.append((name,party.identity.secret_key))
        return party
    monkeypatch.setattr(web.app.accounts,'party',tracked)
    id=accepted(a,b)
    assert {'alice','bob'} <= {name for name,_ in opened}
    assert all(secret is None for _,secret in opened)
    assert a.get('escrows/'+id)[1]['state']=='ACCEPTED'


def test_legacy_plaintext_migration(web):
    identity=web.app.accounts.party('alice',public_only=True).identity
    encrypted=json.loads(web.app.accounts.user('alice')['key_blob'])
    identity.secret_key=unseal(encrypted,'demo1234')
    legacy=web.root/'users'/'alice'/'identity.json';identity.save(legacy)
    with web.app.accounts.connect() as db: db.execute("UPDATE users SET key_blob=NULL WHERE username='alice'")
    assert web.client().login()[0]==200
    assert not legacy.exists()
    assert web.app.accounts.user('alice')['key_blob']


def test_envelope_authenticates_before_decrypt():
    secret=b'x'*4032
    envelope=seal(secret,'password1')
    assert unseal(envelope,'password1')==secret
    envelope['ciphertext']=b64(b'y'*4032)
    with pytest.raises(ValueError,match='authentication'):
        unseal(envelope,'password1')


def test_twelve_repeated_logins(web):
    c=web.client()
    for _ in range(12):
        assert c.login()[0]==200
        assert c.get('me')[0]==200
        assert c.post('logout')[0]==200


def test_wei_precision_is_preserved_in_json(web):
    a=web.client('alice')
    assert a.post('wallet/deposit',dict(amount_wei='1',lock_seconds=60))[0]==200
    wallet=a.get('wallet')[1]
    assert wallet['account']['balance']=='5000000000000000001'
    assert wallet['funds']=='4999999999999999999'
    ledger=a.get('chain')[1]
    assert ledger['deposited']=='5000000000000000001'
    assert next(iter(ledger['accounts'].values()))['balance']=='5000000000000000001'
