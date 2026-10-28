# Hosted release checks — 28 October 2026

Live address: **https://pq-escrow.vercel.app**

## Executed automated checks

* **83 Desktop protocol, HTTP and startup tests passed** in 147.29 seconds.
* **Six Postgres integration tests passed** in 172.80 seconds, followed by
  **two additional concurrency/upload-budget tests** in 51.05 seconds.
  Each test used an isolated schema, removed after completion. No existing
  Desktop database, signing key or account was imported into the hosted database.
* The eight hosted tests covered fresh registration, sessions across fresh app
  instances, complete delivery/payment/claim flow, wrong-file retry, chunk upload
  and download, ownership, private notes, exports, profiles, inbox state, session
  revocation, password change, expiry, persistent login throttling, CSRF, lab
  isolation, atomic rollback, simultaneous settlement and upload-budget enforcement.
* Solidity and the offline signature format were unchanged by the hosted release.
  The earlier sixteen executed Ganache checks remain documented separately. The
  optional Python web3/PyEVM environment was not used for these hosted checks.

Total executed Python checks in these release runs: **91 passed**.

## Public Vercel browser test

`scripts/hosted_browser_test.cjs` ran against the public production address,
using independently registered buyer and seller accounts in separate browser
contexts. It used **26,214,400 bytes (25 MiB)** of random file content.

The browser successfully:

1. Created accounts with confirmed passwords and loaded their separate workspaces.
2. Deposited test funds, drafted an agreement and hashed the reference file locally.
3. Added both signatures, blocked an incorrect file, then uploaded the correct
   25 MiB delivery in requests of at most 1 MiB each.
4. Saved a private note that the other party could not read.
5. Downloaded and reconstructed the delivery; the SHA-256 matched the original.
6. Approved payment while the payment connection was paused, refused finishing
   payment while paused, then reconnected and settled. The seller claimed exactly
   1 test ETH.
7. Exported the full signed JSON evidence including its payload and re-uploaded
   that large bundle in parts. The real verifier returned **RELEASE**.
8. Used role/value filters, downloaded a CSV, marked inbox updates as read, saved
   a profile, and signed out another browser session.

The run recorded **zero browser JavaScript errors**. Results are in
`docs/hosted-live/results.json`.

## Independent page and lab checks

`scripts/hosted_navigation_test.cjs` waited for each page's own heading before
checking layout. Home, Agreements, Wallet, Activity, Verify, Ledger, Attack lab,
Settings, Help and Inbox all fitted **320, 390, 768 and 1440 pixel** viewports.
It captured current desktop/mobile screenshots and exercised dark appearance.

The live Attack lab ran all five real experiments with modified controls. All
five attacks were blocked; the chosen replay/device counts appeared in the
traces. Real ledger and audit data stayed unchanged. Reset cleared the results.
The shared live clock control was absent. This run also recorded **zero browser
JavaScript errors**. Its results are in `docs/hosted-live/navigation-results.json`.

The local preview used a separate, temporary schema. Deployment health checked
the actual Postgres connection. Credentials and runtime data are excluded from
GitHub and from the downloadable project archive.
