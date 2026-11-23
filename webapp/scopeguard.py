"""ScopeGuard: immutable signed scope, private evidence and conditional test escrow."""
import json
import re
import secrets
import threading
_preview_lock = threading.Lock()
from contextlib import contextmanager
from pathlib import Path

from escrow.crypto import b64, canonical_json, sha256_bytes, sign, verify, unb64
from .accounts import HTTPError
from .scope_analysis import MODE, MAX_FILE, provider, inspect_file, text

SCHEMA = """
CREATE TABLE IF NOT EXISTS sg_limits(owner TEXT PRIMARY KEY,started INTEGER NOT NULL,count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sg_projects(id TEXT PRIMARY KEY,buyer TEXT NOT NULL,seller TEXT NOT NULL,title TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 0,pending INTEGER NOT NULL DEFAULT 1,locked TEXT NOT NULL DEFAULT '0',state TEXT NOT NULL DEFAULT 'proposed',demo INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sg_versions(project TEXT NOT NULL REFERENCES sg_projects(id),version INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(project,version));
CREATE TABLE IF NOT EXISTS sg_signatures(project TEXT NOT NULL,version INTEGER NOT NULL,signer TEXT NOT NULL,signature TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(project,version,signer),FOREIGN KEY(project,version) REFERENCES sg_versions(project,version));
CREATE TABLE IF NOT EXISTS sg_deliveries(id TEXT PRIMARY KEY,project TEXT NOT NULL REFERENCES sg_projects(id),version INTEGER NOT NULL,milestone TEXT NOT NULL,filename TEXT NOT NULL,digest TEXT NOT NULL,object_key TEXT NOT NULL,signature TEXT NOT NULL,report TEXT NOT NULL,created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sg_disputes(id TEXT PRIMARY KEY,project TEXT NOT NULL REFERENCES sg_projects(id),opened_by TEXT NOT NULL,reason TEXT NOT NULL,state TEXT NOT NULL,created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sg_evidence(id TEXT PRIMARY KEY,dispute TEXT NOT NULL REFERENCES sg_disputes(id),author TEXT NOT NULL,body TEXT NOT NULL,signature TEXT NOT NULL,created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sg_resolutions(dispute TEXT NOT NULL REFERENCES sg_disputes(id),signer TEXT NOT NULL,body TEXT NOT NULL,signature TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(dispute,signer));
CREATE TABLE IF NOT EXISTS sg_payments(id TEXT PRIMARY KEY,project TEXT NOT NULL REFERENCES sg_projects(id),milestone TEXT NOT NULL,kind TEXT NOT NULL,amount TEXT NOT NULL,actor TEXT NOT NULL,body TEXT NOT NULL,signature TEXT NOT NULL,created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sg_audit(project TEXT NOT NULL REFERENCES sg_projects(id),seq INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(project,seq));
CREATE INDEX IF NOT EXISTS sg_projects_buyer ON sg_projects(buyer);
CREATE INDEX IF NOT EXISTS sg_projects_seller ON sg_projects(seller);
"""


def install(db):
    for statement in SCHEMA.split(';'):
        if statement.strip(): db.execute(statement)


def pack(value): return canonical_json(value).decode('utf-8')
def decoded(row, field): return json.loads(row[field])
def fail(condition, message, status=409):
    if condition: raise HTTPError(status,message)


def amount(value):
    fail(not isinstance(value,str) or not re.fullmatch(r'[1-9][0-9]{0,21}',value), 'Use a positive amount in test wei',400)
    return int(value)


def scope_message(project, version, digest):
    return {'domain':'PQE-ScopeGuard-v2/agreement','project':project,'version':version,'sha256':digest}


def normalize(data, now):
    title=text(data.get('title'),120,'a title')
    description=text(data.get('description'),12000,'a description')
    requirements=data.get('requirements')
    milestones=data.get('milestones')
    fail(not isinstance(requirements,list) or not 1<=len(requirements)<=40,'Use 1–40 requirements',400)
    fail(not isinstance(milestones,list) or not 1<=len(milestones)<=12,'Use 1–12 milestones',400)
    clean_m=[]
    for i,m in enumerate(milestones):
        fail(not isinstance(m,dict),'Invalid milestone',400)
        deadline=m.get('deadline')
        fail(type(deadline) is not int or not now+60<=deadline<=now+366*86400,'Milestone deadline must be between one minute and one year from now',400)
        clean_m.append({'id':f'M{i+1}','description':text(m.get('description'),400,'a milestone description'),
            'amount_wei':str(amount(m.get('amount_wei'))),'deadline':deadline})
    clean_r=[]
    for i,r in enumerate(requirements):
        fail(not isinstance(r,dict),'Invalid requirement',400)
        check=r.get('check',{'kind':'human','value':''})
        fail(not isinstance(check,dict),'Invalid check',400)
        kind,value=check.get('kind','human'),check.get('value','')
        fail(kind not in ('human','pages','pdf_pages','file','keyword','image_min') or not isinstance(value,str) or len(value)>120,'Unsupported verification check',400)
        if kind in ('pages','pdf_pages'): fail(not re.fullmatch(r'[1-9][0-9]{0,2}',value),'Page count must be 1–999',400)
        if kind=='image_min': fail(not re.fullmatch(r'[1-9][0-9]{0,4}x[1-9][0-9]{0,4}',value),'Use dimensions such as 1200x800',400)
        if kind in ('file','keyword'): fail(not value.strip(),'Provide the path or keyword for this check',400)
        milestone=r.get('milestone','M1')
        fail(milestone not in [m['id'] for m in clean_m],'Choose an existing milestone',400)
        priority=r.get('priority','must')
        fail(priority not in ('must','should','could'),'Invalid priority',400)
        clean_r.append({'id':f'REQ-{i+1:03}','description':text(r.get('description'),400,'a requirement'),
            'acceptance_criteria':text(r.get('acceptance_criteria'),1000,'acceptance criteria'),'priority':priority,
            'verification':kind,'check':{'kind':kind,'value':value.strip()},'milestone':milestone,'status':'proposed'})
    fail(any(not any(r['milestone']==m['id'] for r in clean_r) for m in clean_m),'Each milestone needs at least one requirement',400)
    return {'format':'PQE-ScopeGuard-v2','title':title,'description':description,'requirements':clean_r,'milestones':clean_m,
        'total_wei':str(sum(int(m['amount_wei']) for m in clean_m)),'currency':'simulated_test_ETH','analysis':MODE}


class ScopeGuard:
    def __init__(self,app,name,party,db):
        self.app,self.name,self.party,self.db=app,name,party,db
        self.now=app.now()

    def rate_limit(self):
        row=self.db.execute("SELECT * FROM sg_limits WHERE owner=?",(self.name,)).fetchone()
        count=row["count"]+1 if row and row["started"]>self.now-3600 else 1
        fail(count>120,"ScopeGuard allows 120 analysis/actions per hour per account",429)
        started=row["started"] if row and row["started"]>self.now-3600 else self.now
        self.db.execute("INSERT INTO sg_limits VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET started=excluded.started,count=excluded.count",(self.name,started,count))

    def project(self,pid):
        row=self.db.execute('SELECT * FROM sg_projects WHERE id=?',(pid,)).fetchone()
        fail(not row or self.name not in (row['buyer'],row['seller']),'Project not found for your account',404)
        return dict(row)

    def version(self,p,number=None):
        number=number or p['pending'] or p['active']
        row=self.db.execute('SELECT * FROM sg_versions WHERE project=? AND version=?',(p['id'],number)).fetchone()
        fail(not row,'Agreement version not found',404)
        body=decoded(row,'body')
        fail(sha256_bytes(canonical_json(body))!=row['digest'],'Agreement integrity check failed')
        fail(body.get('buyer',{}).get('name')!=p['buyer'] or body.get('seller',{}).get('name')!=p['seller'],'Agreement ownership changed')
        return dict(row),body

    def seals(self,p,number):
        row,body=self.version(p,number)
        result=[]
        for s in self.db.execute('SELECT * FROM sg_signatures WHERE project=? AND version=?',(p['id'],number)):
            role='buyer' if s['signer']==p['buyer'] else 'seller'
            ok=s['signer'] in (p['buyer'],p['seller']) and verify(unb64(body[role]['public_key']),scope_message(p['id'],number,row['digest']),s['signature'],'scopeguard')
            result.append({'signer':s['signer'],'signature':s['signature'],'created':s['created'],'verified':ok})
        return result

    def require_active(self,p):
        fail(p['state'] in ('completed','cancelled'),'This project has ended')
        fail(not p['active'] or p['pending'],'Both parties must approve the current proposal before continuing')
        seals=self.seals(p,p['active'])
        fail(len(seals)!=2 or not all(s['verified'] for s in seals),'Both agreement signatures must verify')
        return self.version(p,p['active'])[1]

    def audit(self,p,event,data=None):
        last=self.db.execute('SELECT seq,digest FROM sg_audit WHERE project=? ORDER BY seq DESC LIMIT 1',(p['id'],)).fetchone()
        seq=last['seq']+1 if last else 1
        body={'seq':seq,'at':self.now,'actor':self.name,'event':event,'data':data or {},'previous':last['digest'] if last else ''}
        self.db.execute('INSERT INTO sg_audit VALUES(?,?,?,?)',(p['id'],seq,pack(body),sha256_bytes(canonical_json(body))))

    def notify(self,p,event):
        for name in (p['buyer'],p['seller']):
            self.app.accounts.party(name,public_only=True).store.log('scopeguard_'+event,None,{'project':p['id']})

    def balance(self,name,delta):
        row=self.db.execute('SELECT funds FROM users WHERE username=?',(name,)).fetchone()
        fail(not row,'Account no longer exists',404)
        funds=int(row['funds'])+delta
        fail(funds<0,'Insufficient spendable test funds. ScopeGuard reservations use the Wallet’s available test funds, separate from legacy deposits.')
        self.db.execute('UPDATE users SET funds=? WHERE username=?',(str(funds),name))

    def signed(self,body):
        envelope={'domain':'PQE-ScopeGuard-v2/evidence','sha256':sha256_bytes(canonical_json(body))}
        sig=sign(self.party.identity.secret_key,envelope,'scopeguard')
        fail(not verify(self.party.identity.public_key,envelope,sig,'scopeguard'),'Signature generation failed')
        return sig

    def verify_evidence(self,p,body,signature,signer):
        _,v=self.version(p,body.get('version') or p['active'] or 1)
        role='buyer' if signer==p['buyer'] else 'seller'
        return signer in (p['buyer'],p['seller']) and body.get('project')==p['id'] and verify(unb64(v[role]['public_key']),{'domain':'PQE-ScopeGuard-v2/evidence','sha256':sha256_bytes(canonical_json(body))},signature,'scopeguard')

    def create(self,data):
        seller=text(data.get('seller'),20,'a seller username')
        fail(seller==self.name,'Choose a different seller',400)
        seller_id=self.app.accounts.party(seller,public_only=True).identity.descriptor()
        count=self.db.execute('SELECT COUNT(*) AS n FROM sg_projects WHERE buyer=?',(self.name,)).fetchone()['n']
        fail(count>=40,'This account has reached its 40 ScopeGuard project limit',429)
        body=normalize(data,self.now)
        body.update(buyer=self.party.identity.descriptor(),seller=seller_id,parent_hash=None)
        pid=secrets.token_hex(16)
        self.db.execute('INSERT INTO sg_projects(id,buyer,seller,title,demo,created) VALUES(?,?,?,?,?,?)',(pid,self.name,seller,body['title'],1 if data.get('demo') is True else 0,self.now))
        self.db.execute('INSERT INTO sg_versions VALUES(?,?,?,?,?)',(pid,1,pack(body),sha256_bytes(canonical_json(body)),self.now))
        p=self.project(pid);self.audit(p,'proposal_created');self.notify(p,'proposal_created')
        return {'id':pid}

    def amend(self,p,data):
        fail(p['state'] in ('completed','cancelled','disputed'),'This project cannot be amended')
        row,base=self.version(p)
        fail(data.get('base_hash')!=row['digest'],'The agreement changed. Reload before proposing an amendment.')
        fail(bool(self.db.execute('SELECT 1 FROM sg_deliveries WHERE project=?',(p['id'],)).fetchone()),'Delivery has started. Resolve the current project before creating a new scope.')
        fail(bool(self.db.execute("SELECT 1 FROM sg_payments WHERE project=? AND kind!='reserve'",(p['id'],)).fetchone()),'Financial outcomes already exist; create a new agreement')
        body=normalize(data,self.now)
        body.update(buyer=base['buyer'],seller=base['seller'],parent_hash=row['digest'])
        number=self.db.execute('SELECT MAX(version) AS n FROM sg_versions WHERE project=?',(p['id'],)).fetchone()['n']+1
        fail(number>20,'This project has reached its 20-version limit',429)
        self.db.execute('INSERT INTO sg_versions VALUES(?,?,?,?,?)',(p['id'],number,pack(body),sha256_bytes(canonical_json(body)),self.now))
        self.db.execute('UPDATE sg_projects SET pending=? WHERE id=?',(number,p['id']))
        self.audit(p,'amendment_proposed',{'version':number});self.notify(p,'amendment_proposed')
        return {'version':number}

    def approve(self,p,data):
        fail(not p['pending'] or p['state'] in ('cancelled','completed','disputed'),'No proposal available for approval')
        row,body=self.version(p,p['pending'])
        fail(data.get('hash')!=row['digest'],'The proposal changed; review the latest version')
        fail(any(m['deadline']<=self.now for m in body['milestones']),'A proposed deadline has expired. Submit a new version.')
        role='buyer' if self.name==p['buyer'] else 'seller'
        fail(body[role]!=self.party.identity.descriptor(),'Your signing identity differs from the proposal')
        signature=sign(self.party.identity.secret_key,scope_message(p['id'],p['pending'],row['digest']),'scopeguard')
        fail(not verify(self.party.identity.public_key,scope_message(p['id'],p['pending'],row['digest']),signature,'scopeguard'),'Signature failed')
        existing=self.db.execute('SELECT 1 FROM sg_signatures WHERE project=? AND version=? AND signer=?',(p['id'],p['pending'],self.name)).fetchone()
        fail(bool(existing),'You have already signed this version')
        self.db.execute('INSERT INTO sg_signatures VALUES(?,?,?,?,?)',(p['id'],p['pending'],self.name,signature,self.now))
        seals=self.seals(p,p['pending'])
        if len(seals)==2 and all(s['verified'] for s in seals):
            delta=int(body['total_wei'])-int(p['locked'])
            self.balance(p['buyer'],-delta)
            reservation={'project':p['id'],'version':p['pending'],'sha256':row['digest'],'locked_wei':body['total_wei'],'delta_wei':str(delta),'mode':'simulated_test_ETH'}
            self.db.execute('INSERT INTO sg_payments VALUES(?,?,?,?,?,?,?,?,?)',(secrets.token_hex(16),p['id'],'*','reserve',str(delta),self.name,pack(reservation),self.signed(reservation),self.now))
            self.db.execute("UPDATE sg_projects SET active=pending,pending=0,locked=?,state='active',title=? WHERE id=?",(body['total_wei'],body['title'],p['id']))
        self.audit(p,'version_signed',{'version':p['pending'],'signer':self.name});self.notify(p,'version_signed')
        return {'ok':True}

    def open_dispute(self,p,reason):
        self.require_active(p)
        fail(p['state']=='disputed','There is already an open dispute')
        did=secrets.token_hex(16)
        self.db.execute("INSERT INTO sg_disputes VALUES(?,?,?,?,'open',?)",(did,p['id'],self.name,text(reason,3000,'a dispute explanation'),self.now))
        self.db.execute("UPDATE sg_projects SET state='disputed' WHERE id=?",(p['id'],))
        self.audit(p,'dispute_opened',{'dispute':did});self.notify(p,'dispute_opened')
        return {'id':did}

    def store_file(self,p,digest,raw):
        if hasattr(self.app.accounts,'connection'):
            from . import objects
            return 'db:'+objects.save_file(self.app.accounts.connection,raw)
        directory=self.app.root/'scope-files';directory.mkdir(exist_ok=True)
        (directory/digest).write_bytes(raw)
        return 'local:'+digest

    def read_file(self,key):
        if key.startswith('db:'):
            from . import objects
            return objects.file_bytes(self.app.accounts.connection,key[3:])
        return (self.app.root/'scope-files'/key[6:]).read_bytes()

    def deliver(self,p,data):
        body=self.require_active(p)
        fail(self.name!=p['seller'],'Only the seller can submit a delivery',403)
        fail(p['state']=='disputed','An open dispute freezes delivery and payment')
        mid=data.get('milestone');m=next((m for m in body['milestones'] if m['id']==mid),None)
        fail(not m,'Milestone not found',404)
        fail(self.paid(p,mid),'This milestone already has a financial outcome')
        raw=unb64(data.get('payload'))
        filename=text(data.get('filename'),120,'a filename')
        fail('/' in filename or '\\' in filename or filename.startswith('.'),'Use a plain filename',400)
        count=self.db.execute('SELECT COUNT(*) AS n FROM sg_deliveries WHERE project=?',(p['id'],)).fetchone()['n']
        fail(count>=30,'This project has reached its 30-delivery limit',429)
        report=inspect_file(raw,filename,body['requirements'],mid)
        did=f'{count+1:08x}'+secrets.token_hex(12)
        report.update(id=did,project=p['id'],version=p['active'],milestone=mid,created=self.now,seller=self.name)
        signature=self.signed(report)
        key=self.store_file(p,report['facts']['sha256'],raw)
        self.db.execute('INSERT INTO sg_deliveries VALUES(?,?,?,?,?,?,?,?,?,?)',(did,p['id'],p['active'],mid,filename,report['facts']['sha256'],key,signature,pack(report),self.now))
        self.audit(p,'delivery_submitted',{'delivery':did,'sha256':report['facts']['sha256']});self.notify(p,'delivery_submitted')
        return {'id':did,'report':report}

    def paid(self,p,mid):
        return bool(self.db.execute("SELECT 1 FROM sg_payments WHERE project=? AND milestone=? AND kind IN ('release','refund','split')",(p['id'],mid)).fetchone())

    def release(self,p,data):
        body=self.require_active(p)
        fail(self.name!=p['buyer'],'Only the buyer may approve release',403)
        fail(p['state']=='disputed','Payment is frozen during a dispute')
        mid=data.get('milestone');m=next((m for m in body['milestones'] if m['id']==mid),None)
        fail(not m,'Milestone not found',404)
        fail(self.paid(p,mid),'This milestone was already paid or refunded')
        row=self.db.execute('SELECT * FROM sg_deliveries WHERE project=? AND milestone=? ORDER BY created DESC,id DESC LIMIT 1',(p['id'],mid)).fetchone()
        fail(not row,'A delivery is required before release')
        report=decoded(row,'report')
        fail(data.get('delivery_id')!=row['id'],'Review the latest delivery before release')
        fail(not self.verify_evidence(p,report,row['signature'],p['seller']),'Delivery signature is invalid')
        fail(sha256_bytes(self.read_file(row['object_key']))!=row['digest'],'Delivered file failed its integrity check')
        fail(any(r['status']=='FAILED' for r in report['results']),'A failed objective check blocks release. Request revision or open a dispute.')
        fail(data.get('human_reviewed') is not True,'Explicit human review is required',400)
        value=int(m['amount_wei']);fail(int(p['locked'])<value,'Reserved test balance is insufficient')
        self.balance(p['seller'],value)
        decision={'project':p['id'],'version':p['active'],'milestone':mid,'delivery_id':row['id'],'sha256':row['digest'],'decision':'release','amount_wei':str(value),'human_reviewed':True}
        self.db.execute('INSERT INTO sg_payments VALUES(?,?,?,?,?,?,?,?,?)',(secrets.token_hex(16),p['id'],mid,'release',str(value),self.name,pack(decision),self.signed(decision),self.now))
        remaining=int(p['locked'])-value
        self.db.execute('UPDATE sg_projects SET locked=?,state=? WHERE id=?',(str(remaining),'completed' if remaining==0 else 'active',p['id']))
        self.audit(p,'milestone_released',decision);self.notify(p,'milestone_released')
        return {'ok':True}

    def evidence(self,p,data):
        dispute=self.db.execute("SELECT * FROM sg_disputes WHERE project=? AND state='open'",(p['id'],)).fetchone()
        fail(not dispute,'No open dispute')
        count=self.db.execute('SELECT COUNT(*) AS n FROM sg_evidence WHERE dispute=?',(dispute['id'],)).fetchone()['n']
        fail(count>=40,'This dispute has reached its 40-statement limit',429)
        delivery_id=data.get('delivery_id') or None
        if delivery_id: fail(not self.db.execute('SELECT 1 FROM sg_deliveries WHERE id=? AND project=?',(delivery_id,p['id'])).fetchone(),'Evidence file must belong to this project',400)
        body={'project':p['id'],'version':p['active'],'dispute':dispute['id'],'comment':text(data.get('comment'),3000,'an explanation'),'delivery_id':delivery_id,'author':self.name,'at':self.now}
        self.db.execute('INSERT INTO sg_evidence VALUES(?,?,?,?,?,?)',(secrets.token_hex(16),dispute['id'],self.name,pack(body),self.signed(body),self.now))
        self.audit(p,'evidence_added',{'dispute':dispute['id']});self.notify(p,'evidence_added')
        return {'ok':True}

    def resolve(self,p,data):
        body=self.require_active(p)
        dispute=self.db.execute("SELECT * FROM sg_disputes WHERE project=? AND state='open'",(p['id'],)).fetchone()
        fail(not dispute,'No open dispute')
        action=data.get('outcome')
        fail(action not in ('revision','refund','release','split'),'Choose an available resolution',400)
        share=data.get('seller_bps',0)
        fail(type(share) is not int or not 0<=share<=10000,'Seller share must be 0–10000 basis points',400)
        if action!='split': share=10000 if action=='release' else 0
        decision={'project':p['id'],'version':p['active'],'dispute':dispute['id'],'outcome':action,'seller_bps':share,'locked_wei':p['locked']}
        signature=self.signed(decision)
        self.db.execute('INSERT INTO sg_resolutions VALUES(?,?,?,?,?) ON CONFLICT(dispute,signer) DO UPDATE SET body=excluded.body,signature=excluded.signature,created=excluded.created',(dispute['id'],self.name,pack(decision),signature,self.now))
        rows=self.db.execute('SELECT * FROM sg_resolutions WHERE dispute=?',(dispute['id'],)).fetchall()
        matched=len(rows)==2 and all(r['body']==pack(decision) and self.verify_evidence(p,decision,r['signature'],r['signer']) for r in rows)
        if matched:
            if action!='revision':
                remaining=[m for m in body['milestones'] if not self.paid(p,m['id'])]
                fail(sum(int(m['amount_wei']) for m in remaining)!=int(p['locked']),'Reserved balance and milestones differ')
                for m in remaining:
                    value=int(m['amount_wei']);seller=value*share//10000
                    self.balance(p['seller'],seller);self.balance(p['buyer'],value-seller)
                    entry={**decision,'milestone':m['id'],'amount_wei':str(value),'seller_wei':str(seller),'buyer_wei':str(value-seller)}
                    self.db.execute('INSERT INTO sg_payments VALUES(?,?,?,?,?,?,?,?,?)',(secrets.token_hex(16),p['id'],m['id'],action,str(value),self.name,pack(entry),self.signed(entry),self.now))
                self.db.execute('UPDATE sg_projects SET locked=?,state=? WHERE id=?',('0','completed' if share else 'cancelled',p['id']))
            else: self.db.execute("UPDATE sg_projects SET state='active' WHERE id=?",(p['id'],))
            self.db.execute("UPDATE sg_disputes SET state='resolved' WHERE id=?",(dispute['id'],))
        self.audit(p,'resolution_signed',{'outcome':action,'mutual':matched});self.notify(p,'resolution_signed')
        return {'ok':True,'mutual':matched}

    def cancel(self,p):
        fail(p['active']!=0 or int(p['locked'])!=0,'Reserved projects need a mutually signed dispute/refund resolution')
        fail(p['state']=='cancelled','Already cancelled')
        self.db.execute("UPDATE sg_projects SET pending=0,state='cancelled' WHERE id=?",(p['id'],))
        self.audit(p,'proposal_cancelled');self.notify(p,'proposal_cancelled')
        return {'ok':True}

    def detail(self,p):
        versions=[]
        for row in self.db.execute('SELECT * FROM sg_versions WHERE project=? ORDER BY version',(p['id'],)):
            _,body=self.version(p,row['version'])
            versions.append({'version':row['version'],'hash':row['digest'],'body':body,'created':row['created'],'signatures':self.seals(p,row['version'])})
        deliveries=[]
        for r in self.db.execute('SELECT * FROM sg_deliveries WHERE project=? ORDER BY created,id',(p['id'],)):
            report=decoded(r,'report')
            deliveries.append({'id':r['id'],'milestone':r['milestone'],'version':r['version'],'filename':r['filename'],'sha256':r['digest'],'created':r['created'],'report':report,'signature':r['signature'],'signature_verified':self.verify_evidence(p,report,r['signature'],p['seller'])})
        disputes=[]
        for row in self.db.execute('SELECT * FROM sg_disputes WHERE project=? ORDER BY created,id',(p['id'],)):
            d=dict(row)
            d['evidence']=[{**decoded(e,'body'),'id':e['id'],'signature_verified':self.verify_evidence(p,decoded(e,'body'),e['signature'],e['author'])} for e in self.db.execute('SELECT * FROM sg_evidence WHERE dispute=? ORDER BY created,id',(d['id'],))]
            d['resolutions']=[{'signer':r['signer'],**decoded(r,'body'),'signature_verified':self.verify_evidence(p,decoded(r,'body'),r['signature'],r['signer'])} for r in self.db.execute('SELECT * FROM sg_resolutions WHERE dispute=?',(d['id'],))]
            disputes.append(d)
        payments=[{**dict(r),'body':decoded(r,'body'),'signature_verified':self.verify_evidence(p,decoded(r,'body'),r['signature'],r['actor'])} for r in self.db.execute('SELECT * FROM sg_payments WHERE project=? ORDER BY created,id',(p['id'],))]
        audit=[];previous='';valid=True
        for r in self.db.execute('SELECT * FROM sg_audit WHERE project=? ORDER BY seq',(p['id'],)):
            item=decoded(r,'body');valid=valid and item['previous']==previous and sha256_bytes(canonical_json(item))==r['digest'];previous=r['digest'];audit.append({**item,'hash':previous})
        current=next((v for v in versions if v['version']==(p['pending'] or p['active'])),versions[-1])
        report={**MODE,'original_agreement':versions[0]['body']['requirements'],
            'signed_versions':[v['version'] for v in versions if len(v['signatures'])==2 and all(s['verified'] for s in v['signatures'])],
            'changes':[{'version':v['version'],'parent_hash':v['body']['parent_hash'],'hash':v['hash']} for v in versions[1:]],
            'delivered_files':[{'id':d['id'],'filename':d['filename'],'sha256':d['sha256'],'created':d['created'],'signature_verified':d['signature_verified']} for d in deliveries],
            'passed':[{'delivery':d['id'],**r} for d in deliveries for r in d['report']['results'] if r['status']=='PASSED'],
            'failed':[{'delivery':d['id'],**r} for d in deliveries for r in d['report']['results'] if r['status']=='FAILED'],
            'uncertain':[{'delivery':d['id'],**r} for d in deliveries for r in d['report']['results'] if r['status']=='NEEDS_HUMAN_REVIEW'],
            'party_statements':[e for d in disputes for e in d['evidence']],
            'next_steps':['Review the latest delivery; older results may have been superseded.','Request revision for unmet checks.','Consider a mutually signed partial settlement or refund.','Use independent human arbitration if no agreement is possible.'],
            'notice':'Neutral deterministic evidence summary, not a legal ruling. No payment is released by this report.'}
        return {**MODE,'project':p,'current':current,'versions':versions,'deliveries':deliveries,'disputes':disputes,'payments':payments,'audit':audit,'audit_verified':valid,'fairresolve':report,'mode':'simulated_test_ETH','server_time':self.now}

    def dashboard(self):
        projects=[dict(r) for r in self.db.execute('SELECT * FROM sg_projects WHERE buyer=? OR seller=? ORDER BY created DESC,id',(self.name,self.name))]
        deliveries=[decoded(r,'report') for r in self.db.execute('SELECT d.report FROM sg_deliveries d JOIN sg_projects p ON p.id=d.project WHERE p.buyer=? OR p.seller=?',(self.name,self.name))]
        paid={(r['project'],r['milestone']) for r in self.db.execute("SELECT t.project,t.milestone FROM sg_payments t JOIN sg_projects p ON p.id=t.project WHERE (p.buyer=? OR p.seller=?) AND t.kind IN ('release','refund','split')",(self.name,self.name))}
        for p in projects:
            p['in_review']=p['state']=='active' and any(d['project']==p['id'] and (p['id'],d['milestone']) not in paid for d in deliveries)
        check_counts={status:sum(r['status']==status for d in deliveries for r in d['results']) for status in ('PASSED','FAILED','NEEDS_HUMAN_REVIEW')}
        recent=[decoded(r,'body') for r in self.db.execute('SELECT a.body FROM sg_audit a JOIN sg_projects p ON p.id=a.project WHERE p.buyer=? OR p.seller=? ORDER BY p.created DESC,a.seq DESC LIMIT 8',(self.name,self.name))]
        return {**MODE,'delivery_checks':check_counts,'delivery_count':len(deliveries),'recent':recent,'projects':projects,'stats':{'total':len(projects),'active':sum(p['state']=='active' for p in projects),'completed':sum(p['state']=='completed' for p in projects),'disputed':sum(p['state']=='disputed' for p in projects),'pending':sum(bool(p['pending']) and p['state']!='cancelled' for p in projects),'reserved_wei':str(sum(int(p['locked']) for p in projects))},'wallet_funds':self.app.accounts.user(self.name)['funds']}

    def passport(self):
        projects=[dict(r) for r in self.db.execute('SELECT * FROM sg_projects WHERE (buyer=? OR seller=?) AND demo=0',(self.name,self.name))]
        completed=[p for p in projects if p['state']=='completed']
        counterparties={p['seller'] if p['buyer']==self.name else p['buyer'] for p in completed}
        ontime=0;delivered=0;verified=0;disputes=0;resolved=0;mutual=0
        for p in projects:
            detail=self.detail(p)
            for d in detail['deliveries']:
                if p['seller']!=self.name: continue
                delivered+=1
                version=next(v for v in detail['versions'] if v['version']==d['version'])
                milestone=next(m for m in version['body']['milestones'] if m['id']==d['milestone'])
                ontime+=d['created']<=milestone['deadline']
                verified+=d['signature_verified'] and bool(d['report']['results']) and all(r['status']=='PASSED' for r in d['report']['results'])
            disputes+=len(detail['disputes']);resolved+=sum(d['state']=='resolved' for d in detail['disputes'])
            mutual+=sum(len(v['signatures'])==2 and all(s['verified'] for s in v['signatures']) for v in detail['versions'])
        return {'username':self.name,'completed_agreements':len(completed),'distinct_counterparties':len(counterparties),'objectively_verified_deliveries':verified,'deliveries':delivered,'on_time_rate':round(100*ontime/delivered) if delivered else None,'mutually_signed_versions':mutual,'disputes':disputes,'resolved_disputes':resolved,'dispute_frequency':round(100*sum(any(d['state'] for d in self.detail(p)['disputes']) for p in projects)/len(projects)) if projects else 0,
            'label':'Observed test-workspace activity · demo projects excluded · not identity-verified reputation',
            'anti_abuse':'Self-dealing is blocked and distinct counterparties are shown. Multiple fake identities cannot be reliably prevented without external identity/anti-Sybil controls. No public trust score is issued.'}


@contextmanager
def service(app,name,party):
    with app.accounts.connect() as db:
        yield ScopeGuard(app,name,party,db)


def scopeguard_api(handler,route,post,name,party):
    app=handler.app
    with service(app,name,party) as sg:
        if post: sg.rate_limit()
        if route=="scopeguard/demo" and post:
            from .scope_demo import run_demo
            return handler.send(200,run_demo())
        if route=='scopeguard/analyze' and post: return handler.send(200,provider.generate(handler.body().get('description')))
        if route=='scopeguard/passport' and not post: return handler.send(200,sg.passport())
        if route=='scopeguard':
            return handler.send(201,sg.create(handler.body())) if post else handler.send(200,sg.dashboard())
        match=re.fullmatch(r'scopeguard/([0-9a-f]{32})(?:/(amend|approve|compare|deliver|release|dispute|evidence|resolve|cancel|export|(?:download|preview)/([0-9a-f]{32})))?',route)
        fail(not match,'ScopeGuard endpoint not found',404)
        pid,action,did=match.groups();p=sg.project(pid)
        if not post and action is None: return handler.send(200,sg.detail(p))
        if not post and action=='export':
            return handler.send(200,sg.detail(p),headers={'Content-Disposition':'attachment; filename="scopeguard-evidence.json"'})
        if not post and did:
            row=sg.db.execute('SELECT * FROM sg_deliveries WHERE id=? AND project=?',(did,pid)).fetchone()
            fail(not row,'Delivery not found',404)
            if action.startswith('preview/'):
                from .preview import render_preview, PREVIEW_TYPES
                suffix=Path(row['filename']).suffix.lower()
                fail(suffix not in PREVIEW_TYPES,'This file supports a receipt preview only',415)
                raw=sg.read_file(row['object_key']);fail(sha256_bytes(raw)!=row['digest'],'File integrity check failed')
                try:
                    import threading
                    with _preview_lock:
                        return handler.send(200,render_preview(raw,suffix,name))
                except HTTPError: raise
                except Exception: raise HTTPError(422,'The limited preview is unavailable. The original remains protected.') from None
            paid=sg.db.execute("SELECT body FROM sg_payments WHERE project=? AND milestone=? AND kind IN ('release','split')",(pid,row['milestone'])).fetchone()
            unlocked=bool(paid and (decoded(paid,'body').get('seller_wei') is None or int(decoded(paid,'body')['seller_wei'])>0))
            fail(name!=p['seller'] and not unlocked,'The original unlocks after a paid milestone settlement',403)
            raw=sg.read_file(row['object_key']);fail(sha256_bytes(raw)!=row['digest'],'File integrity check failed')
            return handler.send(200,raw,'application/octet-stream',{'Content-Disposition':f'attachment; filename="{re.sub(r"[^a-zA-Z0-9_.-]","_",row["filename"])}"'})
        fail(not post,'Use the appropriate form for this action',405)
        data=handler.body(limit=3*1024*1024)
        actions={'amend':lambda:sg.amend(p,data),'approve':lambda:sg.approve(p,data),'compare':lambda:provider.compare(sg.require_active(p),data.get('request')),
            'deliver':lambda:sg.deliver(p,data),'release':lambda:sg.release(p,data),'dispute':lambda:sg.open_dispute(p,data.get('reason')),
            'evidence':lambda:sg.evidence(p,data),'resolve':lambda:sg.resolve(p,data),'cancel':lambda:sg.cancel(p)}
        fail(action not in actions,'Action not found',404)
        return handler.send(200,actions[action]())
