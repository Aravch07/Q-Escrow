# Private Cloudflare storage

PQ-Escrow uses a private R2 Standard bucket through an authenticated Worker.
Vercel checks agreement ownership and settlement before retrieving file bytes.
The bucket has no public download URL. The Worker secret is stored in Vercel
and Cloudflare secrets and never sent to the browser.

## Free allowance controls

The application stops new writes before cumulative storage reservations exceed
8,000,000,000 bytes. Each write reserves its payload size plus 1 KB before the
network request. Reservations commit separately from the agreement transaction,
so retries, failures, orphaned objects and rolled-back requests stay counted.
Deleted temporary files do not restore this conservative allowance automatically.

The application also stops R2 operations at 800,000 writes or 8,000,000 reads in
a rolling 35-day window. This leaves room below the R2 Standard monthly free
allowances and avoids an early reset across billing-period boundaries.
The gateway runs on Cloudflare Workers Free.

These controls cover this application. Other buckets, manual uploads and other
applications in the same Cloudflare account consume shared provider allowances.
Cloudflare's billing account remains responsible for that external usage.

Temporary upload objects under `uploads/` expire after one day. Signed originals
and their previews stay private. Settings shows the application reservations and
request counters. Storage errors pause the operation instead of bypassing a quota.

## Deployment

Deploy `cloudflare/wrangler.jsonc` with Wrangler and set the `STORAGE_SECRET`
Worker secret. Set the following encrypted Vercel environment variables.

- `PQE_R2_GATEWAY` contains the Worker's HTTPS URL.
- `PQE_R2_GATEWAY_SECRET` matches `STORAGE_SECRET`.
- `PQE_ADMIN_USERS` contains comma-separated administrator usernames.

The bucket must use Standard storage. Keep public access disabled.
Only the application server should know the gateway secret.

## Existing files

Older database deliveries remain readable. The administrator migration action
copies up to five files per request, verifies the SHA-256 from R2, and then clears
the database payload while keeping its digest, size, signed receipts and references.
A failed verification retains the original database bytes.

Never reset `pqe_storage_budget` counters without independently measuring account
storage and operations, including orphaned objects. Resetting them can invalidate
the free-allowance protection.
