"""Repeatable, isolated competition walkthrough. No real account or funds are changed."""
import copy
import io
import tempfile
import zipfile
from .scopeguard import service
from .scope_analysis import provider
from escrow.crypto import b64


def run_demo():
    from .server import App
    steps=[]
    with tempfile.TemporaryDirectory(prefix='pqe-scope-demo-') as folder:
        app=App(folder)
        for name in ('demo_buyer','demo_seller'):
            app.accounts.register(name,'isolated-demo-only')
            app.accounts.login(name,'isolated-demo-only','isolated-scenario')
        def call(name,action):
            with service(app,name,app.accounts.party(name)) as sg:return action(sg)
        generated=provider.generate('Build a responsive five-page website with login, registration and contact form.')
        steps.append({'title':'Generate the brief','copy':'Deterministic extraction proposes five requirements. Nothing has been agreed yet.','data':generated})
        data={'title':'Five-page website · competition example','description':'Illustrative client brief ₹5,000. Settlement uses 0.005 simulated test ETH, with no exchange rate or real INR payment.',
            'seller':'demo_seller','requirements':copy.deepcopy(generated['requirements']),'milestones':[{'description':'Website delivery','amount_wei':'5000000000000000','deadline':app.now()+86400}],'demo':True}
        pid=call('demo_buyer',lambda sg:sg.create(data))['id']
        def detail(name='demo_buyer'):return call(name,lambda sg:sg.detail(sg.project(pid)))
        def approve(name):return call(name,lambda sg:sg.approve(sg.project(pid),{'hash':detail(name)['current']['hash']}))
        approve('demo_buyer');steps.append({'title':'Buyer approval','copy':'The buyer signs the canonical agreement hash using ML-DSA-65. Seller approval is still required.','data':detail()['current']})
        approve('demo_seller');steps.append({'title':'Both signatures verified','copy':'Two verified signatures activate version 1 and reserve 0.005 simulated test ETH.','data':detail()['current']})
        changes=provider.compare(detail()['current']['body'],'Also add an online payment gateway and two additional pages.')
        steps.append({'title':'Detect scope changes','copy':'A payment gateway is new; increasing the page count modifies the signed quantity. Estimates are proposals.','data':changes})
        data['base_hash']=detail()['current']['hash']
        data['requirements']=copy.deepcopy(generated['requirements'])+[{'description':'Payment gateway','acceptance_criteria':'Demonstrate successful and failed test checkout.','priority':'must','verification':'human','milestone':'M1','check':{'kind':'human','value':''},'status':'proposed'}]
        data['requirements'][0]['description']='Seven website pages';data['requirements'][0]['check']={'kind':'pages','value':'7'}
        data['requirements'][0]['acceptance_criteria']='Provide seven distinct HTML pages.'
        call('demo_buyer',lambda sg:sg.amend(sg.project(pid),data))
        steps.append({'title':'Propose an amendment','copy':'Version 1 stays intact. Version 2 proposes seven pages and checkout; payment stays unchanged until explicitly agreed.','data':detail()['current']})
        approve('demo_buyer');approve('demo_seller')
        steps.append({'title':'Sign the amendment','copy':'Both parties sign version 2. The original signed version remains in history.','data':detail()['current']})
        output=io.BytesIO()
        with zipfile.ZipFile(output,'w') as archive:
            for i in range(7):archive.writestr(f'page-{i+1}.html','<html><body>Illustrative page only</body></html>')
        submitted=call('demo_seller',lambda sg:sg.deliver(sg.project(pid),{'filename':'website-example.zip','milestone':'M1','payload':b64(output.getvalue())}))
        steps.append({'title':'Submit the delivery','copy':'The server hashes the actual ZIP, checks archive integrity, and signs the report.','data':submitted})
        steps.append({'title':'Inspect the requirements','copy':'Seven HTML files pass the count check. Login, responsiveness and checkout still need human review.','data':submitted['report']})
        call('demo_buyer',lambda sg:sg.open_dispute(sg.project(pid),'Checkout behavior was not demonstrated.'))
        call('demo_buyer',lambda sg:sg.evidence(sg.project(pid),{'comment':'The page count matches, but I cannot verify the payment integration.','delivery_id':submitted['id']}))
        call('demo_seller',lambda sg:sg.evidence(sg.project(pid),{'comment':'I can provide a revised build and a test checkout recording.','delivery_id':submitted['id']}))
        steps.append({'title':'Raise a dispute','copy':'The dispute freezes release. Both sides add signed statements tied to the delivery.','data':detail()['disputes']})
        steps.append({'title':'Review FairResolve evidence','copy':'The report separates measured facts from uncertain functionality and presents both explanations. It does not decide who is right.','data':detail()['fairresolve']})
        for name in ('demo_buyer','demo_seller'):call(name,lambda sg:sg.resolve(sg.project(pid),{'outcome':'revision'}))
        steps.append({'title':'Agree to revision','copy':'Both parties sign a revision resolution. Funds remain reserved; no automatic release occurs.','data':{'project':detail()['project'],'disputes':detail()['disputes'],'audit_verified':detail()['audit_verified']}})
    return {'label':'Isolated demonstration · ephemeral example identities · real ML-DSA computations · simulated funds only', 'steps':steps,'reset':'Run again to create a fresh isolated scenario. No production accounts or agreements are changed.'}
