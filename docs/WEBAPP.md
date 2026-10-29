# Local web application

On Windows, double-click `start_web.bat`. It selects the project environment,
prepares the bundled offline runtime if needed, and opens port **8766**.
Keep the launcher window open. A connection error on sign-in names the address
and explains how to restart; it does not mean the credentials were rejected.
The direct Python command below retains its normal port 8765.

Copied or moved workspaces resolve delivered files inside their own vault.
Saved absolute paths from an older location are not used as a fallback.
On Windows each server owns its port exclusively; starting a second instance on
the same port produces a readable startup message. Closed tabs and interrupted
browser connections do not trigger a second error response.

Run from the project root in PowerShell:

```powershell
python -m webapp --seed-demo --port 8765 --data data\webapp --min-lock 3600 --no-browser
```

`--seed-demo` creates missing Alice/Bob/Carol accounts (lower-case usernames,
password `demo1234`), grants 10 test ETH each, and deposits 5 of Alice's grant.
Seeding is idempotent. It does not reset existing balances, passwords, records,
or the time-machine offset. `--port` selects the loopback port; `--data` selects
the local database and vault directory; `--min-lock` sets the minimum on a newly
created ledger; `--no-browser` suppresses automatic browser opening. Binding is
always `127.0.0.1`; there is deliberately no public bind option. The demo clock
offset persists. Different accounts' online switches are independent.

## Pages

| Page | Tasks |
|---|---|
| Sign in / create account | Local account creation, demo chips, field validation and errors |
| Home (`#overview`) | Dismissible getting-started guide, balances, pending actions, agreements and activity |
| Agreements (`#escrows`) | Search and filter agreements, see their status and next action |
| Create escrow | Three-step Details / File check / Review form with validation and retained in-tab drafts |
| Agreement detail | Four-stage Agree / Deliver / Review / Finish rail, next action, file and expandable signatures/evidence |
| Wallet | Deposit with a time lock, withdraw after unlock, claim released earnings |
| Ledger | Shared test settlements, evidence hashes, accounts, registered keys and totals |
| Verify | Validate a full signed bundle without importing; hash any file locally in the browser |
| Attack lab | Select practice or delivered evidence, adjust mutations, run one/all, inspect changes and checks; separate shared clock |
| Activity | Hash-chained audit entries and verification status |
| Settings and keys | Public identity, key custody, theme, network, password change, sign out |
| Help (`#help`) | Buyer/seller walkthroughs, demo-account guidance, glossary, shortcuts and Home-guide restoration |

Both roles receive their own server-enforced actions. All signatures require an
explicit confirmation dialog. The buyer must review the actual content to judge
satisfaction; a matching hash alone proves only byte identity. The website uses
the buyer's received vault copy when checking release. Counterparty accounts
are opened with no secret key for peer import, even if that counterparty is
currently logged in elsewhere.

The four primary links are Home, Agreements, Wallet and Activity. Tools opens
Ledger, Verify, Attack lab and Settings; it closes on outside click or Escape
and returns keyboard focus to its toggle. The Help icon is always available.
The Home guide preference is stored per username in browser local storage.

The redesigned Home puts the actual escrow balance and next actions first,
followed by recent agreements and recent activity. The four-stage progress rail
on each agreement groups the existing six protocol stages for readability. Agreements
supports case-insensitive search over descriptions, parties, IDs and amounts, plus
All / In progress / Settled / Needs review filters. On small screens those rows
become compact agreement cards. Searching preserves keyboard focus.

The header refreshes data and toggles light/dark appearance. Sign-in offers a
password visibility control. The create form has an optional expected-file picker
that computes SHA-256 locally and fills the agreed fingerprint automatically.
Only the hash is submitted; the file is not uploaded during creation. The
fingerprint is read-only while a file is selected; Remove file clears both and
restores manual entry. Files above the 25 MiB delivery limit and hashing errors
block submission. Signing waits for hashing, and stale results from an earlier
selection cannot replace a newer fingerprint. Successful creation resets the
selection. Creation validates each step before advancing, keeps drafts when
going Back, closing the dialog, or visiting Wallet within the page, and reviews
the terms before the signature confirmation. Drafts are reset when the signed-in
account changes and are not persisted across browser reloads. Manual fingerprints
are normalized to lowercase. A funding notice links to Wallet if the current
deposit does not cover the amount. Agreement pages separate the signed instrument,
delivery evidence and role-specific next action. Signatures, agreement IDs and
full evidence tabs start collapsed. Waiting agreements show Check for updates;
only eligible payment/refund stages show Finish payment/refund. An offline
payment has a disabled Finish button and a Connect to finish action. These labels
use the existing signature, delivery and reconciliation APIs. Audit entries keep their full
hash proof under expandable details so the event history remains readable.

No external assets, fonts, scripts or CDNs are used. Georgia and system sans
fonts work offline. Light/dark/device themes persist in browser local storage.
Focus rings, skip link,
keyboard tabs, live toasts, alerts, reduced-motion styling, and guarded initial
username focus are included. Reload a page to see peer actions made in another
browser; confirmed settlements are mirrored on the next online API read.

The primary navigation fits at 320px without horizontal scrolling. The Tools menu
uses an inset panel on phones. Wallet offers hour/day/week duration presets and
an expandable custom-seconds control; signing identity details are expandable in
Settings. Main navigation moves keyboard focus to the new page's main content.

Delivery selection computes its hash in the browser and blocks signing when it
differs from `expected_sha256`. The server repeats the comparison before writing
any delivery, signature, payload or audit entry. Rejected uploads leave both
parties at LOCKED, so the seller can select the correct file and retry. Uploads
without an agreed fingerprint still require buyer review. Already-signed legacy
mismatches remain inspectable and refundable; their signed history is preserved.

Attack lab defaults to a generated, fully signed practice record; it needs no
existing delivery. File/signature/price tests can instead use one of the signed-in
user's deliveries. Byte position, signature byte and price multiplier are editable.
Replay and cloned-wallet experiments always use generated practice accounts and
an isolated ledger. They first settle a valid signed payment, then try repeated
submissions or independently signed same-sequence promises. Outputs include real
before/after values, ordered steps and verifier checks. No personal ledger,
record, payload or audit data is changed. The separate clock controls do affect
the shared application clock. Navigating away safely discards late lab responses.

## Security mechanisms

Usernames are exactly 3–20 lower-case ASCII letters, digits or underscores.
Passwords contain 8–1024 characters. Registration generates the ML-DSA key pair,
stores only its public descriptor and password-sealed private key, and does not
keep it in the unlocked-key cache. The UI then performs a separate login.

Password hashing uses scrypt (`N=16384, r=8, p=1`, 32-byte result) with a random
128-bit salt, and `hmac.compare_digest` for verification. Failed logins are
tracked in memory in separate username and remote-address buckets. Five failures
within 60 real-time seconds make further attempts return 429. Successful login
clears those buckets. Restart clears this demonstration throttle state.

The custom encrypted-key envelope uses an independent random 128-bit salt,
256-bit nonce, domain-separated scrypt derivation of 64 bytes, a SHAKE-256
keystream from the first 32 bytes, XOR encryption, and HMAC-SHA256 from the second
32 bytes over canonical version/salt/nonce/ciphertext. Authentication is checked
before producing a decryption keystream. A fresh envelope is made on password
change. This is an explicit demonstrator construction, not an audited standard
encryption format or a replacement for an established AEAD in production.

Session cookies use 32 random bytes (64 hex characters), `HttpOnly`, `SameSite=Strict`,
path `/`, and 12-hour expiration. Only their SHA-256 digests are stored in SQLite.
The cookie lacks `Secure` because this is loopback HTTP. A periodic server cleanup
drops expired sessions and drops cached signing keys when no session remains.
Password change re-seals the key and deletes **all** account sessions. Server
restart starts with an empty key cache even if unexpired session rows remain:
authenticated requests then return 401 `Sign in again to unlock your signing key`.
Users must log in again. There is no persisted browser-side unlock secret.

Legacy migration supports a user row whose `key_blob` is null and a matching
plaintext `users/<username>/identity.json`. After correct-password login, the
server validates the public descriptor, stores the encrypted envelope, and
removes the plaintext file. Historical backups or filesystem copies cannot be
erased by this migration. No automatic password recovery is supplied.

All POSTs require `X-Requested-With: PQEscrow`, including register/login/logout,
and explicit cross-origin POST origins are refused. No CORS access is granted.
Responses use a self-only CSP (no inline scripts/styles), `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `no-store`.
All signed actions validate the caller against the embedded descriptor and state.
Downloads and bundles are available only from a party's own store, are attachment
downloads, and never use the peer filename as a path. Uploads are limited to
25 MiB (25 × 1024 × 1024 bytes); bundle verification accepts up to 36 MiB for base64
overhead. Files remain readable on disk by the machine's authorized filesystem user.

The server sees plaintext passwords during login and plaintext signing keys
while unlocked. It can sign as a logged-in user. Production must move signing
to a client device or hardware token and use a reviewed encryption/custody design.
This demo has no real wallet keys, TLS termination, internet deployment, multi-node
consensus, external transport, dispute mechanism, or audited financial custody.

## JSON API

All paths start with `/api/`. Except register/login and idempotent logout, endpoints
require an unlocked authenticated session. Every POST also needs the CSRF header.
Money is wei: terms, wallet action requests, and wallet/ledger response amounts
use decimal strings so JavaScript never rounds them. The local ledger's internal
balances are Python integers. Application timestamps are UTC
Unix seconds. Responses contain either the result or `{"error":"explanation"}`.

| Method | Path | Input / result |
|---|---|---|
| POST | `register` | `{username,password}` → public identity; 201 |
| POST | `login` | `{username,password}` → session cookie |
| POST | `logout` | `{}` → end current session |
| POST | `password` | `{old_password,new_password}` → re-seal key, end all sessions |
| GET | `me` | Public identity, online flag, unlock flag, app time, minimum lock |
| GET | `updates?after={audit_id}` | Own revision and recent event metadata; read-only live-update check |
| POST | `online` | `{online: true/false}` → chain-link preference |
| GET | `users` | Public descriptors only |
| GET | `wallet` | Test funds, registered ledger account and claimable balance |
| POST | `wallet/deposit` | `{amount_wei,lock_seconds}`; online required |
| POST | `withdraw` | `{amount_wei}`; online, unlocked funds required |
| POST | `claim` | `{}`; online; move all earnings to test wallet |
| GET / POST | `escrows` | List own records / `{seller,amount_wei,description,expires_at?,expected_sha256?}` |
| GET | `escrows/{id}` | Instrument, state, role, seals, all checks, activity, bundle |
| POST | `escrows/{id}/countersign` | `{}`; seller, proposed, before expiry |
| POST | `escrows/{id}/deliver` | Raw file body, URL-encoded `X-Filename`; seller, locked |
| POST | `escrows/{id}/accept` | `{decision:"release"/"refund"}`; buyer, delivered |
| POST | `escrows/{id}/cancel` | `{}`; either party, unfinished, online; signed immediate cancellation |
| GET | `escrows/{id}/download` | Attachment bytes; either party |
| GET | `escrows/{id}/bundle` | Full signed JSON attachment; either party |
| POST | `verify-bundle` | Full bundle or `{bundle: ...}` → offline verdict and checks |
| POST | `verify-file` | Raw bytes → SHA-256 and size (the UI instead hashes locally) |
| POST | `reconcile` | `{}` → all pending verdicts in deterministic order; online |
| GET | `chain` | Shared local ledger explorer snapshot |
| GET | `audit` | Own audit entries and chain validity |
| POST | `lab/attack` | `{kind:"file"/"signature"/"price",escrow_id?,options?}` → changes, steps, before/after checks and verdict |
| POST | `lab/replay` | `{options?:{attempts:2..5}}` → one valid payment, repeated attempts on a practice ledger |
| POST | `lab/double-spend` | `{options?:{copies:2..4}}` → signed same-sequence devices; extra settlements refused |
| POST | `lab/time` | `{seconds:1..604800}` → advance shared demo clock |

Standard errors: 400 invalid content/role/state, 401 authentication or unlock,
403 CSRF/origin, 404 absent/nonparty record, 409 duplicate username/offline chain,
413 upload too large, 429 throttled. A nonparty receives no confirmation that
another party's escrow ID exists. Downloads use `application/octet-stream`.

Attack settings are integers: `offset` is 0 through 26214399 and must fit the
selected file (0 for an empty file); `signature_byte` is 0 through 3308;
`multiplier` is 2 through 1000; `attempts` is 2 through 5; `copies` is 2 through 4.
Omitted settings use 0, 3308, 100, 2 and 2 respectively. A missing `escrow_id`
selects practice evidence. A selected agreement must belong to the caller and
have an initially verifiable delivered file. These checks execute the real
protocol verifier and ledger rules, rather than returning predetermined labels.

## Testing

The finance interface defaults to light appearance on its first visit, replacing
the previous design's stored preference once. Later appearance selections are
retained. Desktop uses horizontal navigation; narrow screens scroll the selected
navigation item into view. Mobile agreement actions precede the instrument and
evidence checks. The main dashboard shows live balances, pending actions and
agreements; it does not add sample transactions to an existing account.

`tests/test_web.py` starts real ThreadingHTTPServer instances on ephemeral ports
and uses separate HTTP cookie jars for users. Tests cover headers, auth/CSRF,
registration, throttle, both roles, file access and caps, refunds/expected hashes,
offline peer flow, time-machine expiry/withdraw, insufficient/unregistered
balances, isolated attacks, verification, password/session behavior, encrypted
disk keys (beyond the public ML-DSA seed), restart unlock, last-session cleanup,
counterparty public-only access, legacy migration, and 12 login/logout cycles.

`scripts/browser_test.cjs` independently drives Chromium with separate contexts,
uses UI actions for the payment lifecycle, and captures desktop, mobile and dark
views. It also verifies browser hashing, bundle inspection, five attacks, new
account creation, native short-password validation, sign-out and 12 repeated
logins. See `docs/VERIFICATION.md` and `docs/screenshots/browser-results.json` for
the executed results and the separate optional-EVM limitation.

`scripts/finance_layout_test.cjs` adds empty-account checks at 320, 390, 768 and
1024px, selected-navigation visibility, mobile dialog fit and cancellation,
and mobile search. Both browser scripts accept `PQE_PLAYWRIGHT`, `PQE_URL` and
`PQE_SCREENSHOTS`; use a freshly seeded temporary data directory for the full
payment-flow script. The extra layout script signs into the seeded `carol`
account without creating agreements or changing balances.

`scripts/browser_test.cjs` also tries a wrong delivery in the UI and through a
direct authenticated POST, verifies it was not saved, then completes the matching
delivery and payment. After that script, `scripts/lab_interactive_test.cjs` checks
all experiment controls on a fresh account, error recovery, detailed results,
isolation, reset, time presets, mobile/dark layouts, navigation during a running
experiment and selected real evidence. It uses the same browser environment
variables and saves `interactive-lab-results.json`.

`scripts/usability_test.cjs` covers the primary navigation, per-account Home
guide, role walkthroughs and keyboard tabs, Tools/Escape focus behavior at
320–1440px, three-step validation, Back/Cancel draft retention, a Wallet funding
detour, duration presets and final signed creation. Run it on disposable seeded
data with a fresh Carol account. `scripts/navigation_test.cjs`, after the full
browser workflow, recaptures all ten signed-in views and checks that signatures,
terms and bundle download remain accessible inside the new disclosure sections.
