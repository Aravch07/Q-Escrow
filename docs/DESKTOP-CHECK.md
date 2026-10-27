# Desktop login and project check — 27 October 2026

## Cause of the sign-in failure

The screenshot showed a browser connection failure. At the start of inspection,
nothing was listening on the Desktop app's port, 8766. Starting the server against
the existing Desktop data immediately allowed Alice, Bob and Carol to sign in
with their existing demo passwords. No password or account reset was needed.

The old Windows launcher checked only `.venv/` and otherwise used the global
Python command. It missed the working environment inside `pq-escrow-clean/`.

## Repairs

* `start_web.bat` now checks both supported environment locations, prepares an
  environment with the included offline runtime when needed, starts port 8766,
  and keeps startup errors visible. Explicit `--port` arguments still work.
* Connection failures identify the current address and explain how to start the
  local app. They remain distinct from incorrect-password errors. The same
  guidance appears when the initial session request cannot reach the server.
* Saved deliveries resolve inside the current workspace's vault. A copied folder
  cannot silently use an old absolute payload path in a different workspace.
  Missing or altered local payloads still fail verification; no external fallback
  is allowed. Signed terms, delivery hashes and audit history are preserved.
* Windows listeners use an exclusive port. A second server cannot share the first
  server's port, and startup reports a readable recovery message.
* Closed browser connections are handled without retrying a response as a bad
  request or emitting a request-handler traceback.

## Checks performed

The final complete Python run finished with **83 passed, 7 skipped in 131.49
seconds**. The seven skips are the optional Python EVM environment described below.

* Browser sign-in, matching workspace and sign-out for all three saved Desktop
  accounts; lost-connection messaging, retry without reloading, initial session
  failure, incorrect-password handling and correct-password recovery passed.
* All four existing SQLite databases passed `PRAGMA integrity_check`. The three
  account keys are present in encrypted form; all saved signatures, audit chains
  and delivered files verified inside the Desktop folder.
* Fresh-folder first run created a virtual environment and installed the bundled
  runtime without an index or network download. The launcher started successfully
  from a different working directory, including a path with spaces. Its website
  returned HTTP 200 and created data inside that project folder.
* Protocol regression tests cover moving/copying a store, changing the old copy's
  file, and refusing to fall back to that old copy when the current file is absent.
* Actual startup against an occupied Desktop port exited with a readable message
  and no traceback. Tests also cover invalid ports and duplicate listeners.
* Browser workflow passed creation, automatic reference hashing, wrong-file
  refusal in browser and HTTP, correct retry, offline approval, online settlement,
  seller claim, registration and twelve consecutive sign-in/sign-out cycles.
* Navigation, light/dark appearance and mobile layouts, the three-step creation
  wizard, file selection races/errors, and all five interactive Attack lab
  experiments passed. Experiments did not alter real agreements or balances.
* Python sources, JavaScript files and PowerShell scripts passed syntax checks.
  JSON files and all seven offline wheel archives parsed and checked successfully.
  The Desktop environment's dependency check reported no broken requirements.
* Solidity compiled with solc 0.8.30. All sixteen supplementary Ganache contract
  checks passed, including replay, double spend, role restrictions, refund,
  release, claim, locks and cross-function reentry protection. Ganache used its
  JavaScript fallback on the installed Node version.

The seven optional Python EVM tests require separately installed web3/PyEVM
dependencies and are skipped in the core Desktop environment. This does not
affect the local demo; the sixteen contract checks above executed separately.
Payment and attack tests used disposable data. The saved Desktop accounts were
checked without performing payment actions.

Browser results are in `docs/screenshots/login-results.json`,
`browser-results.json`, `finance-layout-results.json`, `interactive-lab-results.json`,
`usability-results.json`, `create-file-results.json` and `navigation-results.json`.
