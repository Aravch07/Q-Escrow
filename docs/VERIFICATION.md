# Executed verification

The **28 October 2026** online release is recorded in
[HOSTED-VERIFICATION.md](HOSTED-VERIFICATION.md): 91 executed Python checks,
a public Vercel buyer/seller flow with a 25 MiB file, and independent hosted
navigation and Attack lab checks.

The **27 October 2026** Desktop startup, login, copied-file and Windows network
checks are recorded in [DESKTOP-CHECK.md](DESKTOP-CHECK.md).
The final full Python run passed **83 tests**, with **7 optional EVM skips**, in
**131.49 seconds**. All three saved Desktop demo logins and the complete browser
payment flow passed; Solidity compilation and all **16 Ganache checks** passed.

Core verification on **25 October 2026**; finance interface verification on
**26 October 2026**, Windows, Microsoft Store Python **3.13.14**.
This report distinguishes the checks that executed from the optional Python EVM
checks that could not execute. These checks are not a security audit.

| Check | Result |
|---|---|
| Fresh archive extraction, clean virtualenv, offline wheel installation | Passed |
| `python -m pytest tests -q` in the original extracted copy | **54 passed, 7 skipped**, 66.87 seconds |
| Current full Python suite, 26 October: delivery guard and interactive lab | **68 passed, 7 skipped**, 78.69 seconds |
| Offline six-stage demo from the extracted copy | Passed; double spend blocked; Bob claimable 1 ETH |
| CLI walkthrough from the extracted copy | Passed: init, proposal, export/import, countersign, delivery, release, reconciliation, list/show, balances and audit |
| solc-js compilation | Passed, solc 0.8.30, optimizer + viaIR, Paris EVM target |
| Real compiled contract in Ganache | **16 checks passed**, including withdrawal and cross-function reentry attempts |
| Chromium end-to-end website workflow | Passed with separate Alice and Bob contexts |
| Browser registration, short password, sign-out and 12 login/logout cycles | Passed |
| File hashing, bundle inspection and five attack lab experiments | Passed in Chromium and HTTP tests |
| Current page screenshots | **57 captured**, including guided creation, Help, mobile navigation, wrong-delivery rejection and interactive lab results |
| Browser JavaScript errors / external requests | **0 / 0** |

## Clean dependency proof

A new virtualenv was made after extracting the archive into a clean folder.
Installation used only `--no-index --find-links wheelhouse -r requirements-dev.txt`.
The installed distributions were:

```text
dilithium-py 1.5.1
pytest       9.1.1
colorama     0.4.6
iniconfig    2.3.1
packaging    26.3
pluggy       1.7.0
Pygments     2.21.0
pip          26.1.2 (virtualenv bootstrap)
```

The extra distributions are pytest's dependencies, not runtime requirements of
the application. There was no web3, eth-tester, Playwright, PIL, server framework,
template library or other application dependency in this environment. All core
and HTTP tests passed there. Each web test uses a real HTTP server and cookie jars.

## Core and HTTP coverage

The executed tests cover happy-path signatures and evidence commitments;
forged signatures for all four purposes; context separation; altered terms;
actual received-file checks; swapping payloads after acceptance or during
evidence capture; expected-hash refunds; expiry, holds and late delivery;
equivocation and stale bundles; safe payload paths; cloned-wallet sequence reuse;
rejection of both local same-sequence records; deterministic balance exhaustion;
unregistered and mismatched keys; minimum locks, withdrawal deadlines and
uint256 bounds; replay and relayer permissions; audit edits and tail deletion.

HTTP tests additionally cover all security headers, CSRF/origin refusal, username
and password rules, random password salts, hashed-only session tokens, throttling,
both-party lifecycle/role/state enforcement, nonparty file denial, 25 MiB cap,
attachment filenames, refunds, the offline peer/chain distinction, shared time,
insufficient funds, attack isolation, bundle and file verification, password
resealing and invalidation, encrypted secret bytes beyond the public matrix seed,
last-session cleanup, restart unlock, counterparty public-only access, legacy
plaintext migration, repeated login cycles, and lossless decimal wei JSON amounts.

## Browser evidence

Tool versions: Node **24.18.0**, Playwright **1.64.1**, Chromium **156.0.8078.4**.
The final successful UI flow:

1. Alice created an escrow and confirmed her terms signature.
2. Bob countersigned and uploaded a text delivery, confirming its signature.
3. Alice switched the chain link offline and confirmed release.
4. Offline reconciliation was refused with a readable error.
5. Alice went online and settled. Bob observed that same settlement.
6. Bob claimed exactly 1 test ETH; his wallet rose from 10 to 11 test ETH.
7. All nine signed-in views were captured in desktop, mobile and dark modes.
8. Browser-local hashing and full bundle verification succeeded.
9. All five isolated attacks were blocked. Real balances and records were intact.
10. A new user was registered after a short password was refused. Sign-out worked,
    followed by 12 successful, consecutive login/logout cycles for that user.

Sign-in and registration were also captured in all three visual modes; three
intermediate signing/offline states were captured at desktop size. Full-page
screenshots were reviewed in contact sheets, with the agreement view also
inspected at full resolution. No document overflow was observed at 390px.
Notification stacking and a registration/sign-out mode issue found during QA
were fixed before the final captures. All external-resource requests were absent.

Machine-readable evidence: [Browser results](screenshots/browser-results.json).
The screenshots themselves are in `docs/screenshots/`.

## Real EVM verification and explicit limitation

The optional Python EVM environment installed web3 **7.16.0**, eth-tester
**0.13.0b1**, PyEVM **0.12.1b1**, and wheel dependencies without compiling C++.
On import, Windows Application Control returned **WinError 4551** for the
PyCryptodome `_SHA256.pyd` native extension. The seven Python EVM tests therefore
skip with an explicit environment reason. In the minimal environment they skip
because optional packages are absent. **Web3Chain and its Python deployment path
were not successfully executed here. No claim that those seven tests passed is made.**

The contract itself was successfully deployed and executed with its actual
included ABI/bytecode in **Ganache 7.9.2**, an in-process JavaScript EVM, through
ethers **6.17.0**. Ganache used its ordinary JavaScript fallback for the unavailable
optional native µWS accelerator. The 16 executed checks were:

* Minimum lock and immutable registered key.
* Withdrawal refusal during the lock.
* Relayer-only settlement and owner-only relayer administration.
* Wrong-key and insufficient-balance refusal.
* Release balance movement and stored evidence hash.
* Escrow-ID replay and buyer-sequence reuse refusal.
* Seller claim, with exact gas cost included in the balance assertion.
* Refund consumes sequence without debiting backing.
* Withdrawal succeeds after unlock.
* Owner can authorize a relayer.
* Withdrawal reentry fails while the receiver still has unlocked funds.
* Claim-to-withdraw cross-function reentry fails against a funded receiver.

See [Contract results](contract-results.json) for the exact check names and
`scripts/test_contract.cjs` plus `contracts/test/ReentrantReceiver.sol` to repeat
them. These tests supplement the blocked Python EVM suite; they do not establish
correctness of the unexecuted Web3Chain adapter or prove the contract secure.

## Packaging

The archive contains source, documentation, the compiled contract, screenshots,
and offline core/test wheels. It excludes Node installations, package-lock,
caches, generated runtime databases, data and virtualenvs. The original archive
was extracted into a new folder for the clean tests and CLI walkthrough. The
interface was subsequently redesigned; its additional verification is recorded
below. The external `pq-escrow.zip.sha256` file commits to the refreshed archive.
Use `Get-FileHash -Algorithm SHA256 .\pq-escrow.zip` to compare it.

## Interface redesign verification

The interface redesign changed the local HTML, CSS and client-side JavaScript,
with corresponding browser checks and documentation. The Python server,
protocol, key custody, ledger and Solidity settlement code are unchanged.

* The real-HTTP suite was rerun: **23 passed in 35.87 seconds**.
* The complete two-party Chromium flow was rerun successfully, including offline
  release, online settlement, peer settlement mirroring and a 1 ETH seller claim.
* All nine signed-in views, sign-in and registration were recaptured in desktop,
  mobile and dark appearances: **36 updated screenshots**.
* Additional checks passed for agreement search, all status filters, search-field
  focus retention, the header theme switch, refresh, Escape cancellation of the
  create dialog, and showing/hiding the password.
* Browser file hashing, signed-bundle verification, all five attack lab cases,
  account registration, short-password rejection, sign-out and all 12 repeated
  login/logout cycles passed again.
* Browser JavaScript errors and external-resource requests both remained zero;
  all page widths stayed within the 390px mobile viewport.

The updated interface keeps full hashes and signed evidence inspectable while
placing balances, agreement status and next actions first. No user data was
reset or migrated by this update. See the current `browser-results.json` for
the executed browser check list.

## Light finance interface — 26 October 2026

The current interface replaces the dark sidebar with white horizontal navigation,
three compact balance cards, an action strip, agreement list and readable recent
activity. It selects light appearance once for existing browsers; later appearance
choices persist. Account records, keys and balances are unchanged.

* Real-HTTP tests: **23 passed in 53.53 seconds**.
* Complete two-party Chromium payment workflow passed again, including the exact
  1 ETH claim, offline release, online settlement and peer mirroring.
* **39 current screenshots** cover the signed-in pages in light/mobile/dark,
  sign-in and registration, empty dashboard and mobile creation dialog.
* Legacy dark preference plus dark device appearance correctly starts in light;
  an explicitly selected appearance survives reload.
* Search, filters, focus retention, password visibility, modal cancellation,
  refresh, verification tools, five attack cases and 12 repeated sign-ins passed.
* **Zero browser JavaScript errors and zero external requests** on the final run.
* Additional layout checks passed at **320, 390, 768 and 1024px**: no empty-page
  overflow, selected navigation visible, mobile dialog fits and cancels, and
  mobile search clears correctly. Payment actions appear before the long evidence
  section on phones.
* The user's already-running server on port 8765 was checked read-only: it serves
  the new design marker with `Cache-Control: no-store`.

Reproduce the full browser flow using `scripts/browser_test.cjs` against a freshly
seeded temporary data directory. Run `scripts/finance_layout_test.cjs` for the
additional layout checks. Results are saved in `docs/screenshots/browser-results.json`
and `docs/screenshots/finance-layout-results.json`. The original full Python and
contract results above are retained; they were not rerun for these frontend changes.

## Automatic expected-file fingerprint — 26 October 2026

The Create escrow form now accepts an optional local reference file and calculates
SHA-256 in the browser. The existing signed `expected_sha256` term is used; the
server, protocol and settlement rules are unchanged.

* `scripts/create_file_test.cjs` passed known-hash comparison, replacement, removal,
  empty-file hashing, optional/manual entry, blocked submission while hashing,
  stale-completion races, oversize rejection and recovery from hashing errors.
* Browser requests confirmed selecting a file sends no POST. Creation sends only
  the agreement fields and expected fingerprint, without the reference file.
* The generated hash appeared in signature confirmation and persisted in signed
  terms. File selection, fingerprint and read-only state reset after creation.
* The complete Chromium buyer/seller workflow passed using a selected reference
  file followed by the matching delivery, offline release, settlement and exact
  1 ETH claim. Existing verification tools, attack cases, registration and repeated
  sign-ins also passed. Browser errors and external requests remained **0 / 0**.
* Desktop, 390px mobile and dark file-picker screenshots were captured. The mobile
  dialog fits horizontally and scrolls vertically to its actions.
* Read-only checking confirmed the user's existing server on port 8765 serves the
  new file picker without requiring a restart.

See `docs/screenshots/create-file-results.json` and `browser-results.json` for the
executed check lists. Existing backend and contract test results remain as dated
above; those suites were not rerun for this browser-only feature.

## Delivery rejection and interactive Attack lab — 26 October 2026

The core delivery function now compares raw bytes with the agreed SHA-256 before
creating a payload, receipt, signature or audit entry. A wrong file is rejected
without changing either party's agreement, and the correct file can be retried.
The browser hashes the selected delivery, displays an explicit mismatch and
disables signing. The server independently enforces the check for direct API and
CLI calls. Previously signed mismatched records retain their evidence and refund
policy; they are not rewritten to hide the historical delivery.

Attack lab uses generated, fully signed practice evidence by default and also
accepts an owned delivered agreement for file/signature/price tests. Settings
control the changed byte, signature byte, multiplier, submission count and cloned
device count. Results contain actual before/after data, verification checks and
ordered steps. Replay and double-spend experiments first make one valid payment
on a disposable ledger and then exercise the real replay/sequence guards.

Executed checks:

* Full Python suite: **68 passed, 7 skipped in 78.69 seconds**. The optional EVM
  environment limitation above still applies. Core/HTTP tests cover atomic wrong
  upload refusal, correct retry, legacy refunds, all lab settings, invalid inputs,
  access control and unchanged real ledger, records and audit data.
* Full Chromium payment flow passed with an agreed file. It attempted a wrong file
  in the UI and through a direct authenticated POST, confirmed the server kept
  LOCKED with no delivery, and completed a correct retry, release, settlement and
  the exact 1 ETH claim. Existing browser checks passed with zero JavaScript errors
  and zero external requests.
* `scripts/lab_interactive_test.cjs` passed all five practice experiments on an
  account with no deliveries, adjusted controls, invalid-setting recovery,
  before/after inspection, verifier failure details, Run all and Reset results.
* The same browser checks confirmed selected real evidence remains unchanged,
  actual ledger and audit state remain unchanged, time presets only fill the
  input, and leaving during an experiment safely ignores a delayed response.
* Desktop, 390px mobile and dark result screenshots were visually checked. Card
  captures use document clipping from the top of the page so sticky navigation
  does not cover the isolated component.
* The user's server on port 8765 was restarted against its existing data folder;
  read-only readiness checks returned HTTP 200 and the new delivery/lab interface.

See `docs/screenshots/interactive-lab-results.json`, `browser-results.json`,
`scripts/browser_test.cjs`, `scripts/lab_interactive_test.cjs` and the Python tests
for the executed scenarios. Solidity and the optional Web3 adapter were unchanged.

## New-user navigation and guided workflow — 26 October 2026

The interface now has Home, Agreements, Wallet and Activity as its four primary
destinations. Tools holds the advanced pages, and a persistent Help entry opens
role-based instructions and a short glossary. Creation uses Details / File check /
Review. Agreement pages group the protocol into Agree / Deliver / Review / Finish,
show only the action relevant to the current stage and collapse technical evidence.
The Python protocol, ledger, key custody and Solidity contract are unchanged by
this interface pass; the 68-pass backend run above remains the current backend
verification and was not repeated for these static-file changes.

Executed browser checks:

* The complete buyer/seller payment flow passed with automatic reference hashing,
  wrong-file refusal in browser and server, correct retry, offline approval,
  online Finish payment, settlement mirroring and an exact 1 ETH seller claim.
* `usability_test.cjs` passed four-link navigation, guide dismissal/persistence and
  restoration, buyer/seller Help tabs with keyboard controls, Tools bounds at
  320/390/768/1440px, Escape focus restoration and preferences-first Settings.
* Guided creation rejected incomplete fields and zero amounts; Back/Cancel kept
  the draft; visiting Wallet to deposit funds kept the description, seller, amount
  and reference-file hash. Friendly lock presets and custom duration worked.
  No creation request was made before review and explicit signature confirmation.
* `create_file_test.cjs` passed again through the wizard, including file changes,
  removal, empty files, asynchronous race protection, size/read errors, optional
  and manual fingerprints, uppercase normalization, correct signed terms and reset.
* `navigation_test.cjs` recaptured all ten signed-in views in desktop light,
  390px mobile and desktop dark. Every page fit its viewport. Expanded signatures,
  terms and signed-bundle download remained accessible.
* All five interactive lab experiments, their controls, isolation, reset, mobile
  presentation and navigation-during-run checks passed again.
* Existing registration, password visibility, filtering, focus retention, refresh,
  browser file hashing, bundle inspection and 12 repeated sign-ins passed.
* Browser JavaScript errors and external requests remained zero in the complete
  workflow. The usability/navigation reports also recorded zero JavaScript errors.

Results are in `docs/screenshots/usability-results.json`, `navigation-results.json`,
`create-file-results.json`, `interactive-lab-results.json` and `browser-results.json`.
Unsigned drafts exist only in the current page and are not saved across reloads.
