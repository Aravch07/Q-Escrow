"""Offline verification of exported ScopeGuard evidence. No account keys or network needed."""
import argparse
import json
from pathlib import Path
from .crypto import canonical_json,sha256_bytes,verify,unb64,key_hash


def verify_export(data,buyer_key_hash=None,seller_key_hash=None):
    results=[]
    try:
        pid=data['project']['id'];versions=data['versions'];known={}
        first=versions[0]['body']
        for role,pinned in [('buyer',buyer_key_hash),('seller',seller_key_hash)]:
            actual=key_hash(unb64(first[role]['public_key']))
            results.append({'check':role+' key fingerprint','ok':actual==first[role]['key_hash'] and (pinned is None or actual==pinned)})
        previous_hashes={None}
        for v in versions:
            body=v['body'];digest=sha256_bytes(canonical_json(body))
            integrity=digest==v['hash'] and body['parent_hash'] in previous_hashes and all(body[r]==first[r] for r in ('buyer','seller'))
            results.append({'check':f"Version {v['version']} integrity",'ok':integrity})
            previous_hashes.add(digest);known[v['version']]=body
            signers=set()
            for seal in v['signatures']:
                role=next((r for r in ('buyer','seller') if body[r]['name']==seal['signer']),None)
                message={'domain':'PQE-ScopeGuard-v2/agreement','project':pid,'version':v['version'],'sha256':digest}
                ok=bool(role and seal['signer'] not in signers and verify(unb64(body[role]['public_key']),message,seal['signature'],'scopeguard'))
                results.append({'check':f"Version {v['version']} / {seal['signer']}",'ok':ok});signers.add(seal['signer'])
            if v['version']==data['project']['active']:
                results.append({'check':'Active version has two distinct signatures','ok':len(signers)==2})
        for delivery in data['deliveries']:
            # Exports include the original signed report and signature in delivery entries.
            report=delivery['report'];body=known[delivery['version']]
            sig=delivery.get('signature')
            message={'domain':'PQE-ScopeGuard-v2/evidence','sha256':sha256_bytes(canonical_json(report))}
            results.append({'check':'Delivery '+delivery['id'],'ok':bool(sig and verify(unb64(body['seller']['public_key']),message,sig,'scopeguard') and report['facts']['sha256']==delivery['sha256'])})
        previous=''
        for entry in data['audit']:
            body={k:v for k,v in entry.items() if k!='hash'}
            valid=body['previous']==previous and sha256_bytes(canonical_json(body))==entry['hash']
            results.append({'check':f"Audit event {entry['seq']}",'ok':valid});previous=entry['hash']
    except (ValueError,TypeError,KeyError,IndexError):
        results.append({'check':'Export structure','ok':False})
    return {'ok':bool(results) and all(r['ok'] for r in results),'checks':results,
        'notice':'Without pinned fingerprints, this checks internal integrity, not the real-world identity of the parties. It does not prove file quality, current payment state or a blockchain anchor.'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('export');parser.add_argument('--buyer-key-hash');parser.add_argument('--seller-key-hash')
    args=parser.parse_args()
    result=verify_export(json.loads(Path(args.export).read_text(encoding='utf-8')),args.buyer_key_hash,args.seller_key_hash)
    print(json.dumps(result,indent=2));raise SystemExit(0 if result['ok'] else 1)

if __name__=='__main__':main()
