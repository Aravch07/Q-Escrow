# Prototype verification — 29 October 2026

## Executed before publication

- **83 Desktop protocol, HTTP and startup tests passed** in 142.56 seconds.
- The extended static-asset/security test passed separately after adding the new
  assets, scripts and traversal checks (2.77 seconds).
- **Eight hosted Postgres integration tests passed** in 426.46 seconds. Tests
  used isolated schemas and removed them afterward.
- `scripts/analytics_test.cjs` passed exact-money, refund, role, date-period,
  empty-workspace, duplicate-record and large-value calculations.
- `scripts/futuristic_preview_test.cjs` passed the labelled sample, five-step
  tour and destination highlight, escrow wizard, actual fixture totals,
  7/30/90-day charts, role/measure filters, keyboard tooltips, CSV, theme/accent
  persistence and ten destinations at 320/390/768/1440 pixels. Sample actions
  sent zero POST requests; no browser JavaScript errors were recorded.
- `scripts/hosted_browser_test.cjs` passed against the local hosted adapter with
  an isolated Postgres schema. Two fresh accounts completed a real 1 MiB file
  agreement, automatic reference hashing, wrong-file blocking, chunked upload
  and download, private notes, approval with payment connection paused,
  settlement, exact claim and signed-bundle verification. Role/value filters,
  CSV, inbox, profile and session revocation passed. All tested account pages
  fitted mobile/desktop; zero browser JavaScript errors were recorded.
- The public-source scan found no deployment credentials or private-key blocks.
  The read-only sample export has no private signing keys, password hashes or
  session material. Fonts include their OFL licences.
- The final separate hosted navigation run passed **all eleven destinations**
  (including Analytics and Inbox) at 320/390/768/1440 pixels. The Attack lab ran
  all five experiments with changed controls, blocked all attacks and preserved
  the real ledger/audit. Reset worked; no browser JavaScript errors occurred.

The initial signed-in header exceeded 320 pixels by one pixel; its button minimum
widths were corrected. Agreement filters now wrap on narrow phones. A later
parallel local browser run hit a timeout while database integration tests were
using the same hosted database service; the final separate run passed.

Sample screenshots and machine-readable results are in `docs/prototype-checks/`.
These checks establish an educational prototype, not a real-money custody audit.

## Public production verification

Vercel deployed application commit `c2282380dadc8278e60eda8707087e3c33f9b352`
from GitHub `main` to `https://pq-escrow.vercel.app`, with state **READY** and
the production alias assigned. The old release remains available on the rollback
branch documented in `PROTOTYPE.md`.

Both browser suites then passed against that public address:

- The real account workflow repeated registration, 1 MiB reference hashing,
  wrong-file rejection, delivery/download with matching SHA-256, offline decision,
  settlement, claim, signed-bundle verification, private notes, CSV, inbox,
  profiles and session revocation. No browser JavaScript errors occurred.
- The public demo passed its tour and destination highlight, wizard, exact
  statistics, chart controls, CSV and appearance checks across all four viewport
  widths. No server POSTs or browser JavaScript errors occurred. Image readiness
  is awaited explicitly so the screenshot check also covers assets loading over
  the public network.

Machine-readable results: `public-workflow-results.json` and
`public-demo-results.json` in `docs/prototype-checks/`.
The temporary local servers and isolated browser-test schema were removed.
Desktop/source copies and the ZIP include the release; local user data was
preserved and deployment secrets were excluded.
