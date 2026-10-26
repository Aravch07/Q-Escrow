import argparse
import logging
import threading
import webbrowser
from .server import App, Server


def main():
    parser = argparse.ArgumentParser(description="PQ-Escrow local test application")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data", default="data/webapp")
    parser.add_argument("--min-lock", type=int, default=3600)
    parser.add_argument("--seed-demo", action="store_true")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if args.min_lock < 0:
        parser.error("--min-lock cannot be negative")
    logging.basicConfig(level=logging.WARNING)
    app = App(args.data, args.min_lock, args.seed_demo)
    server = Server(("127.0.0.1", args.port), app)
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"PQ-Escrow ready at {url}\nTest ledger only. No real funds. Press Ctrl+C to stop.", flush=True)
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        app.accounts.keys.clear()


if __name__ == "__main__":
    main()
