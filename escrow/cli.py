import argparse
import json
import time
from pathlib import Path
from .chain import LocalLedger
from .crypto import canonical_json
from .identity import Identity
from .protocol import Party, propose, countersign, deliver, accept, import_bundle, export_bundle
from .reconcile import reconcile, verify_offline
from .store import Store


def main():
    parser = argparse.ArgumentParser(description="PQ-Escrow offline CLI")
    parser.add_argument("--home", default="data/alice")
    parser.add_argument("--ledger", default="data/ledger.json")
    commands = parser.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init", help="Create a CLI-only plaintext identity (0600)")
    init.add_argument("name")
    init.add_argument("--address")
    for name in ("whoami", "list", "verify-log", "reconcile", "ledger-balance"):
        commands.add_parser(name)
    p = commands.add_parser("propose")
    p.add_argument("--seller", required=True, help="Seller public identity JSON")
    p.add_argument("--amount-wei", required=True)
    p.add_argument("--description", required=True)
    p.add_argument("--expires-in", type=int, default=3600)
    p.add_argument("--expected-sha256")
    for name in ("countersign", "show", "export"):
        cmd = commands.add_parser(name)
        cmd.add_argument("id")
        if name == "export":
            cmd.add_argument("output")
    d = commands.add_parser("deliver")
    d.add_argument("id")
    d.add_argument("file")
    a = commands.add_parser("accept")
    a.add_argument("id")
    a.add_argument("decision", choices=("release", "refund"))
    a.add_argument("--received-file")
    i = commands.add_parser("import")
    i.add_argument("file")
    dep = commands.add_parser("ledger-deposit")
    dep.add_argument("amount_wei", type=int)
    dep.add_argument("--lock-seconds", type=int, default=3600)
    args = parser.parse_args()
    root = Path(args.home)
    root.mkdir(parents=True, exist_ok=True)
    if args.command == "init":
        if (root / "identity.json").exists():
            parser.error("Identity already exists; choose another --home")
        identity = Identity.create(args.name, args.address)
        identity.save(root / "identity.json")
        (root / "public.json").write_bytes(canonical_json(identity.descriptor()))
        print(json.dumps(identity.descriptor(), indent=2))
        return
    try:
        party = Party(Identity.load(root / "identity.json"), Store(root))
        chain = LocalLedger(args.ledger)
        c = args.command
        if c == "whoami": result = party.identity.descriptor()
        elif c == "propose":
            result = propose(party, json.loads(Path(args.seller).read_text(encoding="utf-8")), args.amount_wei,
                             args.description, party.now() + args.expires_in, args.expected_sha256)
        elif c == "countersign": result = countersign(party, args.id)
        elif c == "deliver": result = deliver(party, args.id, args.file)
        elif c == "accept": result = accept(party, args.id, args.decision, args.received_file)
        elif c == "import": result = import_bundle(party, Path(args.file).read_bytes())
        elif c == "export":
            Path(args.output).write_bytes(canonical_json(export_bundle(party.store.get(args.id))))
            result = {"saved": args.output}
        elif c == "list": result = [dict(id=r.escrow_id, state=r.state, description=r.terms["description"]) for r in party.store.all()]
        elif c == "show":
            r = party.store.get(args.id)
            result = {"state": r.state, "bundle": export_bundle(r), "verification": verify_offline(r, party.now()).asdict(), "settlement": r.settlement, "rejection": r.rejection}
        elif c == "verify-log": result = {"valid": party.store.verify_log()}
        elif c == "reconcile": result = reconcile(party, chain)
        elif c == "ledger-deposit": result = chain.deposit(party.identity.evm_address, party.identity.key_hash, args.amount_wei, args.lock_seconds)
        else: result = chain.account(party.identity.evm_address)
        if hasattr(result, "escrow_id"):
            result = {"escrow_id": result.escrow_id, "state": result.state}
        print(json.dumps(result, indent=2))
    except (ValueError, OSError) as exc:
        parser.exit(1, f"Error: {exc}\n")


if __name__ == "__main__":
    main()
