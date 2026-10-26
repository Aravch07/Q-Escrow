"""Optional deployment to a user-selected node with an unlocked deployer account."""
import argparse
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main():
    p = argparse.ArgumentParser(description="Deploy unaudited PQEscrow to a local/test EVM")
    p.add_argument("--rpc", default="http://127.0.0.1:8545")
    p.add_argument("--owner", help="Unlocked node account; defaults to first node account")
    p.add_argument("--min-lock", type=int, default=3600)
    args = p.parse_args()
    try:
        from web3 import Web3
    except ImportError:
        p.exit(1, "Optional dependency missing. Install web3 separately for EVM use.\n")
    from escrow.chain_web3 import Web3Chain
    w3 = Web3(Web3.HTTPProvider(args.rpc))
    if not w3.is_connected():
        p.exit(1, "Cannot connect to the specified RPC endpoint.\n")
    chain = Web3Chain.deploy(w3, args.owner, args.min_lock)
    print("Contract:", chain.contract.address)
    print("Trusted relayer:", chain.relayer)
    print("Ethereum accounts are not post-quantum. Use test funds only.")


if __name__ == "__main__":
    main()
