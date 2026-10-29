# Organised inbox

The hosted inbox shows one card per agreement, grouped by its current status:

- Awaiting signature
- Awaiting delivery
- Ready for review
- Payment pending (including pending refunds)
- Completed (payments and refunds are labelled separately on the card)
- Cancelled
- Needs review

Each card names the agreement, the counterparty and their role, who created the
agreement, and who sent the latest update. A collapsed recent-history section
shows the previous updates and their senders. **Open agreement** goes directly
to the original agreement. Automatic settlement/recovery notices that do not
identify a human sender are labelled **System** rather than guessing a person.
Historical delivery/approval senders are inferred from their signed role and
the event's state at the time, even if the agreement is now completed.

Use **Agreement status**, **Search agreements or people**, and **Unread only** to
narrow the inbox. Search accepts an optional `@` before a username. Filters and
expanded histories remain in place during automatic updates. Agreements move
between groups when their current status changes; their earlier events remain
inside the same card. Account and wallet notifications have their own section.

The API keeps up to five recent meaningful events for each owned agreement and
20 recent account events. This prevents one active agreement from pushing every
other agreement out of the former global 40-event list. No-op waiting checks are
excluded. Older full history remains in the agreement and Activity pages. Unread
counts include all meaningful unread events, not just the visible history window.

## Read state and compatibility

An additive, nullable `notifications_seen_id` profile column records the audit
cursor when **Mark all as read** is used. Existing timestamp read markers remain
the fallback until that first action, preserving older accounts' read state.
New arrivals in the same second remain unread because their audit IDs are newer.
The read cursor is part of the live revision, so read-state changes also reach
other open browsers. The fast revision query tolerates a profile whose new column
has not yet been added; normal application initialisation applies the migration.

`GET /api/notifications` retains the flat `events` list and `unread` count for
compatibility and adds `agreements`, `account_events`, status labels and counts.
`GET /api/notifications?summary=1` returns only the unread count for the header
badge. Every query is scoped to the authenticated owner. Inbox summaries exclude
file bytes, signatures, public keys, private notes and session data.

## Verification

Unit checks cover all seven states, role-based sender inference, cancellation
senders, refund labels, legacy read timestamps, same-second cursor semantics and
metadata privacy. Postgres checks exercise real agreement states, history beyond
40 events, ownership, read-state revisions, same-second arrivals and the existing
private-access/notes/export flow. The browser check covers grouping, names,
sender labels, title escaping, filters, live status movement, unread arrivals,
account separation and responsive layouts.

Executed before publication: **21 unit cases passed**, **three Postgres cases
passed** (including existing private access, notes and export behaviour), and the
two-browser inbox check passed with no JavaScript errors. Layouts fitted 320,
390, 768 and 1440 pixels. Results are in `docs/inbox-checks/`.

The same two-browser check also passed against the production site on
29 October 2026, including account creation, real agreement updates and live
inbox refreshes, with no JavaScript errors. See
`docs/inbox-checks/public-results.json`.
