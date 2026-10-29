# Interactive prototype — 29 October 2026

[Open PQ-Escrow](https://pq-escrow.vercel.app) or
[explore the sample directly](https://pq-escrow.vercel.app/?demo=1#overview).

## Try it in a minute

1. Choose **Explore interactive demo**. The ribbon identifies the sample data.
2. Use **Take a tour** for the five-step guide. Back, Next and Open page work.
3. Open **Create escrow** to explore the three-step wizard. Pick a reference file
   to calculate its SHA-256 locally. Signing invites you to create an account.
4. Open **Tools → Analytics**. Switch Activity, Payments or Agreement value;
   choose 7/30/90 days and a buying/selling role. Hover a chart point or use
   Tab, arrow keys, Home and End to inspect it. Export the visible period as CSV.
5. Explore an agreement, its evidence, wallet, ledger, verification and settings.
   Choose Obsidian, Frost or System appearance and an accent. Settings persist
   in this browser. Sample balances and signatures cannot be changed.
6. Choose **Create your account** for the full, persistent workflow with test
   funds. Use two separate browser profiles for a buyer and seller.

## The working account flow

Workspace changes now appear automatically, with notifications for incoming
evidence and payment outcomes. Either party can choose **Cancel agreement**
before settlement instead of waiting for expiry. See
[live updates and cancellation](LIVE-UPDATES-AND-CANCELLATION.md) for behaviour
and the independent wallet-lock rules.

Register → deposit test funds → create an agreement with the other account →
both parties sign → seller chooses the delivery → mismatched reference files are
blocked → buyer reviews and signs a decision → reconnect and finish payment →
seller claims earnings. Notes, inbox updates, profiles, session controls,
downloads, evidence verification and Attack lab remain functional.

The hosted payment connection can be paused for a signing demonstration; the
hosted app still needs internet. Desktop remains the fully local edition.

## What the statistics mean

- Agreement count, status and headline value are totals for the selected role.
- The line chart uses the selected date range, with local calendar-day buckets.
- Activity counts saved audit events. Role filters include events tied to that
  role's agreements. All roles also includes wallet/account events.
- Payments counts released settlements. Refunds are separate from revenue.
- Agreement value counts signed terms created in the period; it is not a payment.
- Funding coverage compares pooled escrow balance with open buying value. Funds
  are checked again at settlement and are not reserved for individual promises.
- Empty real accounts show an empty chart, without fabricated transactions.
- Exact monetary totals and CSV values use integer wei. Graph geometry uses
  approximate numeric coordinates; point labels retain the exact value.

## Sample data and artwork

`scripts/seed_design_preview.py` creates a new isolated Desktop fixture directory.
It refuses an existing directory. `scripts/export_showcase.py` exports whitelisted
public evidence into `webapp/static/assets/sample-workspace.json`.
This export contains no passwords, session tokens or private signing keys.
The sample API serves fixture data in browser memory and sends no mutation
requests. Account-required actions offer registration. Verification in a real
account uses the actual protocol verifier.

The two original experimental images were replaced by calm ceramic/acrylic link
and evidence-layer artwork. Fonts are bundled locally with their OFL licences;
the interface needs no third-party font request. Reduced-motion preferences
disable decorative motion. Layouts are checked at 320, 390, 768 and 1440 pixels.

## Roll back the source

The old release is preserved on
[`codex/pre-redesign-2026-10-29`](https://github.com/Aravch07/Q-Escrow/tree/codex/pre-redesign-2026-10-29),
at commit `990c82315a9abfd89c3c433c5b6a001e429c66e2`.
The redesign introduces no database schema migration.

For a reviewable rollback, create a new branch from current `main`, restore the
tracked tree from that old commit, commit the restoration and open a pull request
to `main`. Deploy the restored main through the existing Vercel integration.
Alternatively, Vercel can promote the earlier ready deployment. Source rollback
does not restore or delete database contents. Keep the existing database and
deployment secrets; do not force-push or replace users' saved workspaces.

## Verification

Run `node scripts/analytics_test.cjs` for exact calculation checks.
`scripts/futuristic_preview_test.cjs` exercises the sample, tour, wizard,
analytics, appearance and responsive layouts. `scripts/hosted_browser_test.cjs`
exercises real registration, signed delivery, wrong-file rejection, settlement,
claims, evidence verification, notes, sessions and exports.
`scripts/hosted_navigation_test.cjs` checks real account pages and all five
isolated Attack lab experiments. Set `PQE_URL` to the target; set
`PQE_PLAYWRIGHT` to the installed Playwright module path when needed.

This release uses simulated test ETH and server-side ML-DSA-65 signing. It has
not undergone an independent security audit and is not ready for real-money custody.
