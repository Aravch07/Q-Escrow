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
