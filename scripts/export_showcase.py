"""Export only public sample evidence for the interactive read-only prototype."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from webapp.server import App


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    app = App(Path(args.data), min_lock=60)
    party = app.accounts.party('alice', public_only=True)
    account = app.chain.account(party.identity.evm_address)
    for key in ('balance', 'claimable'):
        account[key] = str(account[key])
    chain = app.chain.snapshot()
    for item in chain['accounts'].values():
        item['balance'] = str(item['balance'])
    chain['claimable'] = {key: str(value) for key, value in chain['claimable'].items()}
    for key in ('deposited', 'withdrawn', 'claimed'):
        chain[key] = str(chain[key])
    data = dict(format='PQE-showcase-v1', generated_at=app.now(),
                me=dict(identity=party.identity.descriptor(), online=True, now=app.now(), unlocked=False,
                        demo=True, hosted=False, min_lock=60),
                wallet=dict(funds=app.accounts.user('alice')['funds'], account=account, now=app.now()),
                users=app.accounts.users(),
                escrows=[app.detail(party, record) for record in party.store.all()],
                audit=dict(valid=party.store.verify_log(), entries=party.store.audit()),
                chain=chain)
    raw = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    assert all(secret not in raw for secret in ('secret_key', 'key_blob', 'password', 'token_hash', 'key_session'))
    assert data['audit']['valid']
    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(raw + '\n', encoding='utf-8')
    print(f'Exported {len(data["escrows"])} labelled sample agreements; no passwords or signing secrets.')


if __name__ == '__main__':
    main()
