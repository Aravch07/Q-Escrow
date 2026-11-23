import copy
import io
import json
import zipfile
import pytest
from escrow.crypto import canonical_json,sha256_bytes,b64
from escrow.chain import ETH
from webapp.scope_analysis import provider,inspect_file
from webapp.scopeguard import service,scope_message
from webapp.accounts import HTTPError
from test_web import World

@pytest.fixture
def site(tmp_path):
    w=World(tmp_path)
    try: yield w
    finally: w.stop()


def draft(now):
    generated=provider.generate('Build a responsive five-page website with login, registration and a contact form.')
    return dict(title='Five-page website',description='Five-page website with login and contact form',seller='bob',requirements=generated['requirements'],milestones=[dict(description='Website implementation',amount_wei=str(ETH),deadline=now+86400)])


def setup(site):
    a,b,c=site.client('alice'),site.client('bob'),site.client('carol')
    status,created,_=a.post('scopeguard',draft(site.app.now()));assert status==201,created
    pid=created['id']
    return a,b,c,pid


def approve(a,b,pid):
    detail=a.get('scopeguard/'+pid)[1]
    for client in (a,b):
        status,result,_=client.post('scopeguard/'+pid+'/approve',{'hash':detail['current']['hash']})
        assert status==200,result
    return a.get('scopeguard/'+pid)[1]


def archive(pages=5):
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w') as z:
        for i in range(pages):z.writestr(zipfile.ZipInfo(f'page{i}.html',date_time=(2026,1,1,0,0,0)),'<html><body>login registration contact responsive</body></html>')
    return output.getvalue()


def delivery(b,pid,pages=5):
    status,result,_=b.post('scopeguard/'+pid+'/deliver',{'filename':'website.zip','milestone':'M1','payload':b64(archive(pages))})
    assert status==200,result
    return result['id']


def test_generation_and_comparison():
    result=provider.generate('Five-page responsive website with login, registration and contact form')
    assert len(result['requirements'])==5
    assert result['mode']=='deterministic_demo'
    changes=provider.compare(result,'Also add an online payment gateway and two additional pages')['changes']
    assert {c['classification'] for c in changes}=={'new_requirement','modification'}
    assert provider.compare(result,'remove login')['changes'][0]['classification']=='contradiction'


def test_signing_reservation_amendment_and_tamper(site):
    a,b,c,pid=setup(site)
    assert c.get('scopeguard/'+pid)[0]==404
    assert c.post('scopeguard/'+pid+'/approve',{'hash':'bad'})[0]==404
    assert a.post('scopeguard/'+pid+'/approve',{'hash':'bad'})[0]==409
    detail=approve(a,b,pid)
    assert detail['project']['locked']==str(ETH)
    assert len(detail['current']['signatures'])==2
    assert all(s['verified'] for s in detail['current']['signatures'])
    assert a.get('wallet')[1]['funds']==str(4*ETH)  # seed deposit took 5 from initial 10
    proposal=draft(site.app.now());proposal['base_hash']=detail['current']['hash']
    proposal['milestones'][0]['amount_wei']=str(2*ETH)
    assert b.post('scopeguard/'+pid+'/amend',proposal)[0]==200
    assert b.post('scopeguard/'+pid+'/deliver',{'payload':b64(b'hi'),'filename':'x.txt','milestone':'M1'})[0]==409
    latest=approve(a,b,pid)
    assert latest['project']['active']==2
    assert latest['versions'][0]['hash']==detail['current']['hash']
    assert latest['versions'][1]['body']['parent_hash']==detail['current']['hash']
    assert latest['project']['locked']==str(2*ETH)
    assert latest['audit_verified']
    with site.app.accounts.connect() as db:
        changed=copy.deepcopy(latest['current']['body']);changed['title']='Tampered'
        db.execute('UPDATE sg_versions SET body=? WHERE project=? AND version=2',(json.dumps(changed),pid))
    assert a.get('scopeguard/'+pid)[0]==409


def test_delivery_release_original_protection_and_replay(site):
    a,b,c,pid=setup(site);approve(a,b,pid)
    assert a.post('scopeguard/'+pid+'/deliver',{})[0]==403
    did=delivery(b,pid)
    assert next(p for p in a.get('scopeguard')[1]['projects'] if p['id']==pid)['in_review']
    assert a.get('scopeguard/'+pid+'/download/'+did)[0]==403
    assert c.get('scopeguard/'+pid+'/download/'+did)[0]==404
    assert b.get('scopeguard/'+pid+'/download/'+did)[1]==archive()
    assert b.post('scopeguard/'+pid+'/release',{'milestone':'M1','delivery_id':did,'human_reviewed':True})[0]==403
    assert a.post('scopeguard/'+pid+'/release',{'milestone':'M1','delivery_id':did})[0]==400
    assert a.post('scopeguard/'+pid+'/release',{'milestone':'M1','delivery_id':did,'human_reviewed':True})[0]==200
    assert a.get('scopeguard/'+pid+'/download/'+did)[1]==archive()
    assert b.get('wallet')[1]['funds']==str(11*ETH)
    assert a.post('scopeguard/'+pid+'/release',{'milestone':'M1','delivery_id':did,'human_reviewed':True})[0]==409
    assert a.get('scopeguard/'+pid)[1]['project']['state']=='completed'
    assert not next(p for p in a.get('scopeguard')[1]['projects'] if p['id']==pid)['in_review']


def test_failed_check_and_mutual_dispute_refund(site):
    a,b,c,pid=setup(site);approve(a,b,pid);did=delivery(b,pid,2)
    decision={'milestone':'M1','delivery_id':did,'human_reviewed':True}
    assert a.post('scopeguard/'+pid+'/release',decision)[0]==409
    assert b.post('scopeguard/'+pid+'/dispute',{'reason':'Please review the page count'})[0]==200
    assert a.post('scopeguard/'+pid+'/evidence',{'comment':'Only two pages were supplied','delivery_id':did})[0]==200
    detail=a.get('scopeguard/'+pid)[1]
    assert len(detail['fairresolve']['failed'])==1
    assert detail['disputes'][0]['evidence'][0]['signature_verified']
    assert a.post('scopeguard/'+pid+'/release',decision)[0]==409
    assert a.post('scopeguard/'+pid+'/resolve',{'outcome':'refund'})[1]['mutual'] is False
    assert a.get('scopeguard/'+pid)[1]['project']['locked']==str(ETH)
    assert b.post('scopeguard/'+pid+'/resolve',{'outcome':'release'})[1]['mutual'] is False
    assert b.post('scopeguard/'+pid+'/resolve',{'outcome':'refund'})[1]['mutual'] is True
    assert a.get('wallet')[1]['funds']==str(5*ETH)
    assert a.get('scopeguard/'+pid)[1]['project']['state']=='cancelled'
    assert a.get('scopeguard/'+pid+'/download/'+did)[0]==403


def test_inspection_guards_and_hashes():
    req=provider.generate('five-page website')['requirements']
    good=inspect_file(archive(),'work.zip',req,'M1')
    assert good['facts']['sha256']==sha256_bytes(archive())
    assert good['results'][0]['status']=='PASSED'
    assert inspect_file(archive(2),'work.zip',req,'M1')['results'][0]['status']=='FAILED'
    with pytest.raises(HTTPError):inspect_file(b'wrong','work.zip',req,'M1')
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w') as z:z.writestr('../evil.txt','unsafe')
    with pytest.raises(HTTPError):inspect_file(output.getvalue(),'work.zip',req,'M1')
    with pytest.raises(HTTPError):inspect_file(b'x'*(2*1024*1024+1),'big.txt',req,'M1')


def test_insufficient_funds_atomic_and_restart(site):
    a,b,c,pid=setup(site)
    with site.app.accounts.connect() as db: db.execute("UPDATE users SET funds='0' WHERE username='alice'")
    d=a.get('scopeguard/'+pid)[1]
    assert a.post('scopeguard/'+pid+'/approve',{'hash':d['current']['hash']})[0]==200
    assert b.post('scopeguard/'+pid+'/approve',{'hash':d['current']['hash']})[0]==409
    d=a.get('scopeguard/'+pid)[1]
    assert len(d['current']['signatures'])==1 and d['project']['locked']=='0'
    site.restart();a.login();assert a.get('scopeguard/'+pid)[1]['current']['hash']==d['current']['hash']


def test_no_auth_and_validation(site):
    c=site.client()
    assert c.get('scopeguard')[0]==401
    a=site.client('alice')
    data=draft(site.app.now());data['seller']='alice'
    assert a.post('scopeguard',data)[0]==400
    data['seller']='bob';data['milestones'][0]['amount_wei']='-1'
    assert a.post('scopeguard',data)[0]==400
    assert a.post('scopeguard/analyze',{'description':None})[0]==400


def test_split_and_passport_demo_exclusion(site):
    a,b,c,pid=setup(site);approve(a,b,pid);did=delivery(b,pid)
    assert a.post('scopeguard/'+pid+'/dispute',{'reason':'Agree to partial settlement'})[0]==200
    for client in (a,b):assert client.post('scopeguard/'+pid+'/resolve',{'outcome':'split','seller_bps':5000})[0]==200
    assert a.get('wallet')[1]['funds']==str(45*ETH//10)
    assert b.get('wallet')[1]['funds']==str(105*ETH//10)
    assert a.get('scopeguard/'+pid+'/download/'+did)[0]==200
    passport=a.get('scopeguard/passport')[1]
    assert passport['completed_agreements']==1 and passport['distinct_counterparties']==1
    with site.app.accounts.connect() as db:db.execute('UPDATE sg_projects SET demo=1 WHERE id=?',(pid,))
    assert a.get('scopeguard/passport')[1]['completed_agreements']==0

def test_pdf_image_and_keyword_evidence():
    from pypdf import PdfWriter
    from PIL import Image
    output=io.BytesIO();writer=PdfWriter();writer.add_blank_page(width=300,height=300);writer.write(output)
    requirements=[dict(id='REQ-001',milestone='M1',check={'kind':'pdf_pages','value':'2'})]
    report=inspect_file(output.getvalue(),'report.pdf',requirements,'M1')
    assert report['facts']['pages']==1 and report['results'][0]['status']=='FAILED'
    image=io.BytesIO();Image.new('RGB',(100,80),'blue').save(image,format='PNG')
    requirements[0]['check']={'kind':'image_min','value':'100x80'}
    assert inspect_file(image.getvalue(),'image.png',requirements,'M1')['results'][0]['status']=='PASSED'
    requirements[0]['check']={'kind':'keyword','value':'login'}
    assert inspect_file(b'login','notes.txt',requirements,'M1')['results'][0]['status']=='NEEDS_HUMAN_REVIEW'
    with pytest.raises(HTTPError):inspect_file(image.getvalue(),'image.jpg',requirements,'M1')


def test_isolated_demo_signatures_and_reset():
    from webapp.scope_demo import run_demo
    result=run_demo()
    assert len(result['steps'])==11
    assert result['steps'][0]['data']['requirements'][0]['description']=='Five website pages'
    assert result['steps'][5]['data']['body']['requirements'][0]['description']=='Seven website pages'
    assert all(s['verified'] for s in result['steps'][5]['data']['signatures'])
    assert result['steps'][-1]['data']['project']['state']=='active'
    assert result['steps'][-1]['data']['project']['locked']=='5000000000000000'
    assert result['steps'][-1]['data']['audit_verified']


def test_revision_resubmission_latest_and_two_milestones(site):
    a,b,c=site.client('alice'),site.client('bob'),site.client('carol')
    data=draft(site.app.now());data['milestones'].append(dict(description='Second task',amount_wei=str(ETH),deadline=site.app.now()+90000))
    data['requirements'][-1]['milestone']='M2'
    pid=a.post('scopeguard',data)[1]['id'];approve(a,b,pid)
    old=delivery(b,pid,2)
    assert a.post('scopeguard/'+pid+'/dispute',{'reason':'Two pages is not enough'})[0]==200
    for client in (a,b):assert client.post('scopeguard/'+pid+'/resolve',{'outcome':'revision'})[0]==200
    latest=delivery(b,pid,5)
    assert latest>old
    assert a.post('scopeguard/'+pid+'/release',{'milestone':'M1','delivery_id':old,'human_reviewed':True})[0]==409
    assert a.post('scopeguard/'+pid+'/release',{'milestone':'M1','delivery_id':latest,'human_reviewed':True})[0]==200
    d=a.get('scopeguard/'+pid)[1]
    assert d['project']['state']=='active' and d['project']['locked']==str(ETH)
    assert a.post('scopeguard/'+pid+'/dispute',{'reason':'Second milestone no longer required'})[0]==200
    for client in (a,b):assert client.post('scopeguard/'+pid+'/resolve',{'outcome':'refund'})[0]==200
    assert b.get('wallet')[1]['funds']==str(11*ETH)
    assert a.get('wallet')[1]['funds']==str(4*ETH)


def test_signature_tampering_blocks_financial_actions(site):
    a,b,c,pid=setup(site);approve(a,b,pid)
    with site.app.accounts.connect() as db:
        sig=db.execute('SELECT signature FROM sg_signatures WHERE project=? AND signer=?',(pid,'bob')).fetchone()[0]
        db.execute('UPDATE sg_signatures SET signature=? WHERE project=? AND signer=?',('AAAA'+sig[4:],pid,'bob'))
    detail=a.get('scopeguard/'+pid)[1]
    assert not all(s['verified'] for s in detail['current']['signatures'])
    assert b.post('scopeguard/'+pid+'/deliver',{'filename':'work.zip','payload':b64(archive()),'milestone':'M1'})[0]==409

def test_offline_export_verification_detects_changes(site):
    from escrow.scope_verify import verify_export
    a,b,c,pid=setup(site);approve(a,b,pid);delivery(b,pid)
    exported=a.get('scopeguard/'+pid+'/export')[1]
    assert verify_export(exported)['ok']
    assert not verify_export(exported,buyer_key_hash='0'*64)['ok']
    bad=copy.deepcopy(exported);bad['versions'][0]['body']['requirements'][0]['description']='Forged'
    assert not verify_export(bad)['ok']
    bad=copy.deepcopy(exported);bad['deliveries'][0]['report']['facts']['filename']='Forged'
    assert not verify_export(bad)['ok']
