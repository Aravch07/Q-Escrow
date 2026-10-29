"""Create labelled local sample history in a NEW folder; never uses the cloud DB."""
import argparse
import time
import sys
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from escrow.chain import ETH
from escrow.crypto import sha256_bytes
from escrow.protocol import propose, countersign, deliver, accept
from escrow.reconcile import reconcile
from webapp.server import App


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', required=True)
    args = parser.parse_args()
    root = Path(args.data).resolve()
    if root.exists() and any(root.iterdir()):
        parser.error('Choose a new, empty preview data directory. Existing data is never reset.')
    now = int(time.time())
    with patch('time.time', return_value=now - 6 * 86400):
        app = App(root, min_lock=60, seed_demo=True)
    for name in ('alice', 'bob', 'carol'):
        app.accounts.login(name, 'demo1234', 'local-design-preview')
    parties = {name: app.accounts.party(name) for name in ('alice', 'bob', 'carol')}

    def agreement(buyer_name, seller_name, description, amount, days_ago, stage):
        buyer, seller = parties[buyer_name], parties[seller_name]
        payload = ('PQ-Escrow design preview\nSample deliverable for ' + description + '\n').encode()
        with patch('time.time', return_value=now - days_ago * 86400):
            record = propose(buyer, seller.identity, int(Decimal(str(amount)) * ETH), description,
                             now + (24 + days_ago * 8) * 3600, sha256_bytes(payload))
            app.peer(buyer, record)
            if stage != 'proposed':
                record = countersign(seller, record.escrow_id)
                app.peer(seller, record)
            if stage not in ('proposed', 'locked'):
                record = deliver(seller, record.escrow_id, payload, description.lower().replace(' ', '-') + '.txt')
                app.peer(seller, record)
            if stage in ('paid', 'refunded', 'accepted'):
                record = accept(buyer, record.escrow_id, 'refund' if stage == 'refunded' else 'release')
                app.peer(buyer, record)
            if stage in ('paid', 'refunded'):
                reconcile(buyer, app.chain)
                app.mirror(seller)

    agreement('alice', 'bob', 'Product strategy sprint', 1.25, 6, 'paid')
    agreement('alice', 'carol', 'Brand identity system', .8, 5, 'paid')
    agreement('alice', 'bob', 'Interface exploration', 1.4, 4, 'paid')
    agreement('alice', 'carol', 'Motion studies', .6, 3, 'refunded')
    with patch('time.time', return_value=now - 3 * 86400 + 3600):
        bob = parties['bob'].identity
        app.chain.deposit(bob.evm_address, bob.key_hash, 3 * ETH, 3600)
        app.accounts.update_funds('bob', -3 * ETH)
        parties['bob'].store.log('wallet_deposit', data={'amount_wei': str(3 * ETH)})
    agreement('alice', 'bob', 'Website component library', .95, 2, 'delivered')
    agreement('alice', 'carol', 'Product launch film', 1.65, 1, 'locked')
    agreement('bob', 'alice', 'Design systems review', .65, 1, 'paid')
    agreement('bob', 'alice', 'Packaging artwork', 2.4, 1, 'locked')
    agreement('alice', 'bob', 'Analytics dashboard', .75, 0, 'proposed')
    agreement('bob', 'alice', 'Growth marketing handoff', 1.1, 0, 'accepted')
    for party in parties.values():
        assert party.store.verify_log()
    app.accounts.keys.clear()
    print(f'Labelled local preview created: {len(parties["alice"].store.all())} sample agreements.')


if __name__ == '__main__':
    main()
