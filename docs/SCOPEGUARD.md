# PQ-Escrow 2.0 — ScopeGuard AI

ScopeGuard extends the existing application. Original accounts, legacy agreements, marketplace, offline CLI, Attack lab, smart contracts and storage cutoffs remain available. ScopeGuard uses its own versioned agreement format and conditional **simulated test ETH** reservations. It does not migrate or rewrite old PQE-v1 agreements.

## Run locally (PowerShell)

From the repository root:

```powershell
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-dev.txt
& .\.venv\Scripts\python.exe -m webapp --seed-demo --no-browser
```

Open http://127.0.0.1:8765/#scopeguard. Local seeded accounts are `alice`, `bob`, `carol`, password `demo1234`. Hosted accounts are separate; these credentials are not automatically seeded online. Use two browser profiles/private windows for a live two-party demonstration.

Open Competition demo and select **Run complete demonstration**. Eleven interactive steps show proposal generation, two genuine ML-DSA signatures, scope comparison, amendment signing, delivery inspection, a disputed requirement and a mutual revision resolution. Example accounts are created in a temporary isolated workspace and deleted after the run. Reset reruns that isolated scenario. No current user's funds, accounts or agreements are modified. The illustrative ₹5,000 brief uses 0.005 simulated test ETH, with no implied exchange rate.

## Exercise your own workflow

1. Open Create agreement. Enter a project brief and generate the proposed scope. Analysis is explicitly deterministic demo mode, not a remote AI model.
2. Edit every requirement and acceptance criterion. Assign `M1`, `M2`, etc. to the corresponding milestones. Set a positive test ETH amount and a future deadline for every milestone. Specify a real seller username.
3. Save the immutable proposal. Buyer and seller separately review and sign. The second signature activates the version and reserves the total from the buyer's **available test funds**, separate from legacy deposited balances. Failed funding leaves the proposal pending; it does not create an unbacked reservation.
4. Use Scope changes to compare an additional request against the active signed version. Suggested costs/time never become charges. Edit and save a new amendment, then both parties sign. Old versions remain intact. Pending proposals freeze delivery/payment. After delivery starts, amendments are refused; resolve the project before agreeing to additional work.
5. Seller opens Proof of delivery and uploads a file up to 2 MiB. ZIP inspection allows at most 200 entries and 12 MiB expanded data. The server hashes, inspects and signs the report. Source code is not executed. Supported PDFs/images have limited watermarked previews; unsupported formats expose only receipt/metadata until paid settlement.
6. Review each check and its evidence. HTML file count, PDF page count, archive path and image minimum dimensions are objective checks; they do not imply functional quality. A found keyword remains NEEDS HUMAN REVIEW. An absent required keyword fails. A file hash is identity evidence only.
7. Buyer explicitly confirms human review and signs milestone release. A failed objective check blocks ordinary release. Settled payments cannot be repeated. Only paid milestones unlock originals.
8. Either participant can open a dispute to freeze release, append signed explanations and reference project delivery evidence. FairResolve shows both sides, version history, measured results and uncertainty. It never chooses a payment outcome.
9. Both parties can sign matching revision, refund, release or percentage-split resolutions. Funds move only on matching verified approvals. Revision keeps funds reserved. Partial payment unlocks paid-milestone originals; the UI explains this before signing. Open projects can end without waiting for expiry through mutual refund. Unsigned/unfunded proposals can be cancelled immediately.
10. Inspect the private Trust Passport. Demo projects are excluded. Metrics are observed test activity, not identity-verified reputation. Self-dealing is blocked, distinct counterparties shown; multi-account collusion requires future anti-Sybil identity controls. No public trust score is issued.

## Export and verify offline

Use Export evidence on a project, then:

```powershell
& .\.venv\Scripts\python.exe -m escrow.scope_verify .\scopeguard-evidence.json
```

Optionally add `--buyer-key-hash <fingerprint> --seller-key-hash <fingerprint>` with fingerprints obtained independently from each person. Verification checks canonical hashes, signature validity, version links, delivery report signatures and the audit chain. Without pinned fingerprints, it proves internal consistency rather than real-world identity. It does not certify file quality, payment finality, or an independent blockchain anchor. Existing PQE-v1 offline exchange remains unchanged.

## Configuration and deployment

No new API key is needed. No external AI provider is configured or called; the provider interface is `webapp/scope_analysis.py`. Integrating a future provider requires server-side credentials, structured output validation and privacy/usage controls. Generated terms must still receive two human approvals.

Existing hosted variables remain:

- `DATABASE_URL` (or `POSTGRES_URL`): PostgreSQL connection string, server-only.
- `PQE_SESSION_KEY`: existing encrypted-session key. Preserve it; do not rotate it just to upgrade.
- `PQE_R2_GATEWAY`, `PQE_R2_GATEWAY_SECRET`: existing private Cloudflare gateway credentials. Preserve the existing storage-budget counters and gateway.
- `PQE_ADMIN_USERS`: optional existing admin configuration.

Additive `CREATE TABLE IF NOT EXISTS` migrations run on application initialization. SQLite and PostgreSQL share parameterized queries through the existing adapter. Hosted writes, test-wallet updates and payment journals use the existing PostgreSQL advisory-lock/transaction boundary. Local writes use the existing application lock and SQLite transaction. No smart-contract deployment is required for this simulated mode; real fund locking, audited arbitration and mainnet custody are not implemented.

```powershell
& .\.venv\Scripts\python.exe -m pytest tests\test_scopeguard.py -q
& .\.venv\Scripts\python.exe -m pytest tests\test_core.py tests\test_web.py tests\test_inbox.py tests\test_cancellation.py tests\test_startup.py -q
```

A browser integration check is included in `scripts/scopeguard_browser_test.cjs`. Start a disposable local workspace with `--seed-demo`, install Playwright in your development tools, and run `node scripts/scopeguard_browser_test.cjs`. Set `PQE_PLAYWRIGHT` to the installed module path if needed; `PQE_URL` defaults to http://127.0.0.1:8765. It checks responsive pages, requirement generation and the isolated signed demo without changing the current user's test balance.

Use the existing Vercel project and environment. `vercel` creates a preview; promote only after verifying hosted sign-in, signatures, reservations and R2 access. A rollback of frontend code does not require deleting ScopeGuard tables; keep all records and old signing keys.

## Files added

- `webapp/scope_analysis.py`: deterministic generation/change comparison and bounded file inspection.
- `webapp/scopeguard.py`: additive schema, authorization, immutable versions, signature verification, reservations, evidence, resolutions, reports and passport.
- `webapp/scope_demo.py`: isolated signed competition scenario.
- `webapp/static/scopeguard.js`, `webapp/static/scopeguard.css`: integrated pages, sidebar, editable proposals, reports, interactive demo and responsive theme.
- `escrow/scope_verify.py`: offline export verification.
- `tests/test_scopeguard.py`: positive and negative integration/verification tests.
- `scripts/scopeguard_browser_test.cjs`: reproducible local browser integration check.
- `docs/SCOPEGUARD.md`, `docs/SCOPEGUARD-ARCHITECTURE.md`: operator guide and architecture/limitations.
- `docs/images/scopeguard-dashboard.png`, `docs/images/scopeguard-demo.png`: labelled example screenshots.

## Existing files modified

`escrow/crypto.py` adds a dedicated signature context. `webapp/server.py`, `webapp/cloud.py`, and `webapp/cloud_store.py` integrate protected routes, static assets and schema installation. `webapp/static/app.js` and `index.html` mount the new pages. `requirements.txt` adds pure-Python PDF inspection. `README.md` introduces ScopeGuard and its honest prototype boundaries.

## Remaining production work

This is a tested prototype, not an audited real-money escrow service. External model integration, independent identity/anti-collusion protection, malware scanning/sandboxed behavioral testing, independent audit anchoring, real blockchain milestone locks, external human arbitration and legal/payment compliance remain future work. Server-custodied keys and custom legacy key envelopes are not represented as independently audited security. The current application-level R2 cutoffs remain conservative; they cannot cap unrelated traffic in the Cloudflare account.
