# Live workspace updates and cancellation

## Automatic updates

Visible, signed-in workspaces check a small account-specific revision endpoint
about every 1.5 seconds after the preceding request finishes. Incoming agreements,
signatures, deliveries, decisions, cancellations and settlement outcomes trigger
in-app notifications and refresh the affected workspace view. This is short
polling, not a WebSocket connection; actual latency depends on the connection
and server response time.

Unchanged revisions do not reload the page or fetch the full workspace. Hosted
revision reads do not unlock signing keys or acquire the global writer lock.
They return only the signed-in account's audit revision and recent event metadata.
Inactive tabs stop checking. Returning to the tab or reconnecting checks promptly;
failures retry with backoff up to 30 seconds.

Background refreshes retain the current page, scroll position, search, status and
role filters, sort order and expanded details. Open dialogs, selected delivery
files and unsaved forms defer refresh and show an update notice. Closing the
dialog or saving the form allows the update to apply. Verification, Settings,
Help and Attack lab keep their local inputs/results; notifications and inbox
badges still update without resetting the tool.

## Cancel an agreement

Open an unfinished agreement and choose **Cancel agreement** in the action panel.
Either the buyer or seller can confirm the cancellation. A connected payment
link is required to record the closure immediately. No expiry wait or second
party approval is required. This includes an approved but not yet settled
agreement. Completed settlements and rejected records cannot be cancelled.

Cancellation adds a separately signed notice containing the agreement ID,
cancelling party and timestamp. The original terms, signatures and any delivery
remain in history. The other party sees **Cancelled** automatically. Further
signatures, deliveries and payment approvals are refused by the server.

The ledger records a cancellation and consumes the buyer sequence without
transferring funds. Unfunded proposals can also be cancelled. Only the selected
agreement is closed; other pending agreements are not reconciled by this action.
Repeated cancellation requests return the existing result. Hosted cancellation,
peer mirroring and ledger closure share one transaction, so a payment racing a
cancellation can produce only one final outcome.

Funds in this release are pooled and were never reserved for individual
agreements. Cancellation therefore does not create a wallet credit or remove a
deposit's independent time lock. Cancelled value is excluded from open agreement
value and refunds in Analytics. A Cancelled list filter and chart category keep
closed work visible without counting it as active work.

## Evidence compatibility

Existing `PQE-v1` bundles retain their original shape. Cancelled bundles add an
optional `cancellation` object and its ML-DSA-65 signature using context
`PQE-v1/cancellation`. Both must be present together and verify against the named
party. New readers preserve cancellation when an older bundle is imported, and
refuse changes that would revive a cancelled agreement. Older releases do not
understand cancellation bundles and must not be used to process them.
To restore an earlier interface, retain the current backend and cancellation
handling. The pre-redesign backend cannot safely read new cancellation records;
deploying that old backend against current saved workspaces is not a compatible
data rollback.

The optional EVM adapter/contract are unchanged. The live and Desktop simulated
ledgers support cancellation before key registration. The optional contract's
existing refund settlement still requires its normal registered-key checks.

## Verification

`tests/test_cancellation.py` covers both parties at proposal, signature, delivery
and approval stages, unchanged balances, blocked further actions, signature
tampering, stale imports, unfunded proposals and completed-payment refusal.
HTTP and Postgres tests cover ownership, persistence, evidence export, idempotency,
revision isolation and payment/cancellation races.

`scripts/live_workspace_test.cjs` uses independent buyer and seller browsers. It
checks incoming updates without a reload, draft and filter preservation,
cancellation from both sides, automatic payment updates, idle request behaviour,
reconnection and narrow layouts. The initial local run observed 1.5–2.6 second
updates. Those timings are observations, not a latency guarantee.

The separate preview/dispute redesign for protecting downloaded originals is
deferred. Existing download and buyer refund behaviour is unchanged.

Executed checks for this release: 83 existing local tests, 14 additional
cancellation/HTTP cases and 10 Postgres integration cases passed (107 distinct
Python cases). The hosted live-update test was repeated with the writer lock
held; read-only polling still completed. Analytics calculations, the two-browser
live-workspace flow, and all demo destinations at 320/390/768/1440 pixels passed
with no browser JavaScript errors. Results are in `docs/live-workspace-checks/`.
