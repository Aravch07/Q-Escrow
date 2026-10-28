# PQ-Escrow

Offline agreements, ML-DSA-65 authentication, and evidence-based EVM settlement.
This is a working local demonstration with **test funds only**. It is not an
audited payment service. Ethereum accounts themselves are not post-quantum.

**Live hosted workspace:** [pq-escrow.vercel.app](https://pq-escrow.vercel.app).
Choose **Create account** to register. Hosted accounts and agreements persist
online; your Desktop accounts remain separate. The live version adds profiles,
session controls, an inbox, private notes, exports and large-file transfers.
See [hosting and configuration](docs/HOSTING.md). Both editions use test funds.

The workflow is deliberately ordered:

**Create escrow → Authenticate → Deliver and hash → Operate offline → Verify and reconcile → Blockchain settlement**

## Quick start — Windows PowerShell, Python 3.13

On Windows, you can double-click **start_web.bat** in the project folder.
It uses the project's Python environment (including the earlier copied layout),
or prepares one with the bundled offline dependencies on the first run.
Keep its window open while using the app at http://127.0.0.1:8766.
If the port is already in use, open the running app or select another port:
`.\start_web.bat --port 8767`.

“Cannot reach PQ-Escrow” means the local server is stopped or you opened a
different address. Start the launcher and use the address it prints. This is
different from “Username or password is incorrect.” Demo accounts use
`alice`, `bob`, or `carol`, with password `demo1234`; existing changed passwords
are preserved. Open the web address rather than the HTML file directly.

Get the project from [GitHub](https://github.com/Aravch07/Q-Escrow) and start it:

```powershell
git clone https://github.com/Aravch07/Q-Escrow.git
Set-Location -LiteralPath .\Q-Escrow
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install --no-index --find-links .\wheelhouse -r requirements-dev.txt
& .\.venv\Scripts\python.exe -m webapp --seed-demo
```

If you downloaded a ZIP instead, extract it and open the project folder containing
`requirements-dev.txt` and `webapp/`. Start with `python -m venv .venv` above.
Do not run setup from an empty folder. The separately supplied `pq-escrow.zip`
has the project files at its root; GitHub's Download ZIP adds an outer folder.

To run the tests and the self-contained offline demo:

```powershell
& .\.venv\Scripts\python.exe -m pytest tests -q
& .\.venv\Scripts\python.exe scripts\demo_offline.py
```

Open [the local website](http://127.0.0.1:8765). Sign in as `alice`, `bob`, or
`carol`, password `demo1234`. Use different browser profiles or a private window
for the two parties. Each seed account receives 10 test ETH; Alice deposits 5 of
her 10 into the ledger, leaving 5 in her test wallet. New accounts also receive
10 simulated ETH for demonstrations. No cryptocurrency is created or transferred.

Only `dilithium-py` is a Desktop runtime dependency. `pytest` and its dependencies are for
tests. The hosted runtime additionally uses Flask, psycopg and cryptography.
The Desktop core and web server do not import these hosted packages, web3,
Playwright, or Node packages.
No activation script or `py` launcher is needed. No C++ build tools are needed.

The bundled `wheelhouse/` supports an entirely offline installation of the core
and test dependencies:

```powershell
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install --no-index --find-links .\wheelhouse -r requirements-dev.txt
```

To prepare another wheel cache while connected, or install one later:

```powershell
& .\scripts\download_wheels.ps1 -IncludeTests
& .\scripts\install_offline.ps1 -IncludeTests
```

## Interface update

The workspace has four primary destinations: **Home, Agreements, Wallet and
Activity**. **Tools** contains Ledger, Verify, Attack lab and Settings. The **?**
button opens a getting-started guide with separate buyer and seller walkthroughs.
The Home guide can be dismissed and reopened from Help.

**Create escrow** has three short steps: Details, File check and Review. Back,
Cancel and a trip to Wallet retain the draft within the current page; refreshing
the browser clears the unsigned draft. Review shows the seller, amount, deadline
and file-check choice before signing. If deposited funds are insufficient, it
links to Wallet without losing the draft.

Agreement pages use **Agree → Deliver → Review → Finish**, show the role-specific
next action, and keep signatures and technical checks under expandable details.
**Agree and sign**, **Send delivery**, **Release payment** and **Finish payment**
lead through the workflow. Offline users see **Connect to finish**. Wallet uses
friendly deposit-duration presets, with custom seconds available when needed.
Appearance and public signing details are in Settings. Agreements includes search
and status filters; all advanced tools remain available.

This update selects light appearance once, including for browsers with the old
dark preference. Subsequent light, dark or match-device choices are remembered.
Full hashes, signatures and audit proofs remain available within their tools.

If the local server is already running from this folder, press **Ctrl+F5** in
your browser to load the updated interface. No dependency reinstall is required.
The appearance update preserves account data, signing keys and balances. Updates
to Python server files require a server restart and another sign-in.

## Try the full website flow

When creating an escrow, optionally choose the **Expected file**. The browser
calculates SHA-256 automatically and fills the agreed fingerprint into the terms.
Only that fingerprint is sent during creation; the reference file stays on your
device. Use **Remove file** to clear it or enter a known fingerprint manually.
The reference file must fit the delivery limit of 25 MiB. The seller still
uploads the actual delivery later, and release checks it against the agreed hash.

1. Alice creates an escrow naming Bob as seller. Her terms are signed immediately.
2. Bob opens it, verifies the buyer seal, and countersigns.
3. Bob chooses a file. If an expected fingerprint was agreed, both the browser
   and server refuse a mismatch before saving or signing it. Bob can choose the
   correct file and retry. A matching delivery is uploaded and its receipt signed.
4. Alice downloads and reviews the file, switches the chain link offline, and
   signs **Release payment**. The server re-hashes her received vault copy first.
5. Alice goes online and selects **Finish payment**. Verification processes all
   her pending records in buyer/sequence order. Bob can perform this step too.
6. Bob sees the same ledger result and claims his earnings in Wallet.

The peer link is always available, even with the chain link switched off. This
models exchanging bundles over USB, LAN, QR or Bluetooth; those transports are
not implemented. There is no requirement for internet connectivity at runtime.
Both browsers still need to reach the running local HTTP server.

Attack lab works immediately with a fully signed practice example. You can also
select one of your delivered agreements for file, signature and price attacks.
Adjust the byte position, signature byte, price multiplier, replay submissions or
number of cloned devices, then run one experiment or **Run all experiments**.
Results show the actual changes, step-by-step outcomes and verification checks.
**Reset results** clears the display. All attacks use disposable copies and
practice ledgers; they do not change your saved agreements or balances.

The separate demo clock controls in Attack lab advance the shared, persisted
clock. They can expire agreements, unlock deposits, and expire 12-hour sessions.
The time presets fill the input; **Advance demo clock** applies the change.
After registration, sign in again after any server restart to unlock your key.

Already-signed deliveries from an older version remain in their history. A
mismatched historical delivery cannot release payment; use a new agreement for
the correct file. Agreements without an expected fingerprint cannot determine
which exact file was intended and still require the buyer's review.

## Project tree

```text
escrow/                 crypto, identity, signed protocol, SQLite, reconciliation
  chain.py              abstract Chain and JSON-file LocalLedger
  chain_web3.py          optional web3 adapter and deploy helper
  cli.py                offline command-line interface
webapp/                 standard-library HTTP server, accounts, key encryption
  static/               local HTML, CSS and JavaScript (no external assets)
contracts/PQEscrow.sol   EVM settlement contract
build/PQEscrow.json      included solc-js ABI and deployable bytecode
tests/                  protocol, HTTP, and optional web3/PyEVM tests
scripts/                demo, deploy, compile, browser and contract QA, offline setup
docs/                   architecture, web API, verification report, screenshots
wheelhouse/             offline core/test wheels (no EVM or browser dependencies)
requirements.txt        hosted runtime (Flask, Postgres, cryptography)
requirements-core.txt   dilithium-py only; offline Desktop runtime
requirements-dev.txt    Desktop runtime and pytest
requirements-cloud-dev.txt hosted runtime and integration-test tools
package.json            solc-js compiler only
start_web.bat           Windows convenience launcher
Makefile                optional shortcuts
```

## Offline CLI walkthrough

CLI identities are **plaintext private-key files** with mode 0600, for development
only. Windows mode bits do not replace restrictive filesystem ACLs. Website keys
use a separate, password-encrypted storage system. Do not interchange the two.

Run the following from the project root in PowerShell. The JSON bundles include
payloads; copying a bundle is the entire offline exchange in this example.

```powershell
$python = '.\.venv\Scripts\python.exe'
& $python -m escrow.cli --home data\alice init alice
& $python -m escrow.cli --home data\bob init bob
& $python -m escrow.cli --home data\alice ledger-deposit 1000000000000000000 --lock-seconds 3600
$proposal = & $python -m escrow.cli --home data\alice propose --seller data\bob\public.json --amount-wei 1000000000000000000 --description 'Design file' --expires-in 3600
$id = ($proposal | ConvertFrom-Json).escrow_id
& $python -m escrow.cli --home data\alice export $id buyer-terms.json
& $python -m escrow.cli --home data\bob import buyer-terms.json
& $python -m escrow.cli --home data\bob countersign $id
& $python -m escrow.cli --home data\bob export $id locked.json
& $python -m escrow.cli --home data\alice import locked.json
Set-Content -LiteralPath delivery.txt -Value 'Delivered design' -Encoding utf8
& $python -m escrow.cli --home data\bob deliver $id delivery.txt
& $python -m escrow.cli --home data\bob export $id delivered.json
& $python -m escrow.cli --home data\alice import delivered.json
& $python -m escrow.cli --home data\alice accept $id release
& $python -m escrow.cli --home data\alice export $id accepted.json
& $python -m escrow.cli --home data\bob import accepted.json
& $python -m escrow.cli --home data\alice reconcile
& $python -m escrow.cli --home data\bob ledger-balance
& $python -m escrow.cli --home data\alice verify-log
```

`whoami`, `list`, `show ID`, and `accept ID refund` are also available. Each
command supports `--help`. Global options precede the command. The core treats
resubmission by a different store as replay; the website mirrors confirmed
settlements to the counterparty instead. The website uses `data/webapp/ledger.json`
by default; the CLI uses `data/ledger.json`. They are separate demonstrations.

The self-contained demo does not leave persistent data:

```powershell
& .\.venv\Scripts\python.exe scripts\demo_offline.py
```

Its final lines must say that the cloned-wallet double spend was blocked and
`Bob claimable: 1 ETH`.

## Real EVM support (optional)

The included artifact means Node is **not** required to use `Web3Chain`. Recompile
only if changing Solidity. This pins solc-js 0.8.30 and targets the Paris EVM:

```powershell
npm.cmd install --no-audit --no-fund
node scripts\compile.js
```

Compilation makes no network requests after installation. Keep `node_modules/`
locally if you will recompile offline; it is intentionally excluded from the zip.

Keep EVM dependencies in a separate virtual environment. These versions were
resolvable as Windows Python 3.13 wheels; they remain optional:

```powershell
python -m venv .venv-evm
& .\.venv-evm\Scripts\python.exe -m pip install --only-binary=:all: -r requirements-dev.txt 'web3>=7,<8' 'eth-tester==0.13.0b1' 'py-evm==0.12.1b1' 'eth-hash[pycryptodome]'
& .\.venv-evm\Scripts\python.exe -m pytest tests\test_evm.py -q -rs
& .\.venv-evm\Scripts\python.exe scripts\deploy.py --rpc http://127.0.0.1:8545 --min-lock 3600
```

Deployment expects an already-running node and an unlocked test deployer account.
The website intentionally uses LocalLedger; it is not a browser wallet or mainnet
frontend. The optional adapter uses node-managed unlocked accounts and waits for
transaction receipts. It does not implement hardware signing, retries, chain
reorganization handling, nonce management, or finality tracking.

On the build machine, Windows Application Control blocked a PyCryptodome native
extension needed by web3. The seven web3 tests therefore skipped, with the reason
reported. **The Python EVM adapter has not been executed successfully here.**
The compiled contract was additionally executed in an in-process Ganache EVM;
see [the verification report](docs/VERIFICATION.md) for the distinct results.

To repeat that independent contract check (optional Node QA tools):

```powershell
npm.cmd install --prefix .qa-evm ganache ethers --no-audit --no-fund
$env:PQE_GANACHE = (Resolve-Path .\.qa-evm\node_modules\ganache).Path
$env:PQE_ETHERS = (Resolve-Path .\.qa-evm\node_modules\ethers).Path
node scripts\test_contract.cjs
```

## Tests and browser verification

```powershell
& .\.venv\Scripts\python.exe -m pytest tests -q
```

The default environment needs only the runtime dependency and pytest. Seven EVM
tests skip if their optional dependencies, backend, or artifact are absent. A
Windows application-control block of an optional extension also skips explicitly.
Unexpected import/runtime errors still fail the EVM tests.

For browser QA, start a **fresh** seeded data directory in one PowerShell window:

```powershell
& .\.venv\Scripts\python.exe -m webapp --seed-demo --no-browser --data data\browser-qa --port 8765 --min-lock 60
```

In another window at the same project root:

```powershell
npm.cmd install --prefix .qa-browser playwright --no-audit --no-fund
node .qa-browser\node_modules\playwright\cli.js install chromium
$env:PQE_PLAYWRIGHT = (Resolve-Path .\.qa-browser\node_modules\playwright).Path
node scripts\browser_test.cjs
```

The browser script expects fresh demo balances. Use a new data directory for
each run. It uses separate Alice and Bob contexts, exercises all stages, checks
offline settlement refusal, claims earnings, runs all five attacks, tests new
registration and short-password rejection, and repeats login/logout 12 times.
It captures every signed-in page at desktop, 390px mobile, and dark sizes, plus
sign-in and intermediate states. `PQE_URL` and `PQE_SCREENSHOTS` override its URL
and screenshot directory. These tools are QA dependencies, never runtime imports.

## Trust and limits

* ML-DSA authenticates messages; it does not encrypt delivery files or make the
  EVM post-quantum. SHA-256 commitments do not prove a file is satisfactory.
* Relayers verify signatures off-chain and can authorize arbitrary settlements.
  The contract anchors evidence, but cannot judge whether it was valid.
* Offline devices cannot know about other promises. Time-locked deposits and
  registered keys provide backing; reused sequences, depleted balances, and
  replayed IDs are detected at settlement. Funds are pooled, not individually
  reserved. The final ledger decides which otherwise valid promise succeeds.
* The server holds an unlocked signing key while an account has active sessions.
  A compromised server can sign then. The custom password envelope, pure-Python
  cryptography, web application, and contract are unaudited. Password strength
  matters. Python cannot guarantee erasure of all secret memory copies.
* Timestamps use trusted local clocks, not trusted timestamp authorities. Signers
  can lie about times outside the demo. No arbitration, backup recovery, payload
  confidentiality, chain finality system, or production transport is provided.
* Hash chains expose ordinary edits and broken links. An attacker who can rewrite
  the entire database and saved head can fabricate or truncate a consistent log.
* LocalLedger and its accounts database are not a single crash-atomic transaction.
  This is a single-server, loopback HTTP demo, not internet-facing custody.

Read [Architecture](docs/ARCHITECTURE.md), [Web application](docs/WEBAPP.md), and
[Verification](docs/VERIFICATION.md) for exact policy, API, and measured coverage.
