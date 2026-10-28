# PQ-Escrow online

Live site: **https://pq-escrow.vercel.app**

Choose **Create account** to create your own hosted workspace. Usernames use
3–20 lowercase letters, numbers or underscores. Confirm your password, then use
your 10 test ETH to try the buyer and seller workflow with another account.
The shared Alice/Bob/Carol Desktop credentials are not enabled on the live site.
Desktop accounts, encrypted keys and saved agreements were not uploaded.

This remains an educational application with **test funds**, a simulated
settlement ledger and server-side ML-DSA-65 signing. Publishing it does not turn
the ledger into a live Ethereum contract or real-money custody service.

## Hosted features

* Persistent registration, password sign-in, profiles and account-specific workspaces.
* Encrypted, expiring signing sessions that work across server instances. Settings
  lists sessions and can revoke one device or all other devices. Password changes
  revoke every session. Session cookies are HttpOnly, SameSite=Strict and Secure
  on Vercel. Account recovery by email is not implemented.
* Agreements retain their four signature purposes, automatic reference hashing,
  wrong-file refusal, buyer decisions and replay/double-spend settlement checks.
* Private agreement notes; searchable lists with buyer/seller and amount/deadline
  filters; personal CSV exports; an activity inbox with persistent read state;
  and dashboard completion, settled-volume and upcoming-deadline summaries.
* Files up to 25 MiB and signed evidence up to 36 MiB transfer in parts of at
  most 1 MiB. Downloads reconstruct the file in the browser and verify SHA-256
  before saving. A full evidence export includes the original payload.
* Attack lab uses isolated practice data. The live shared clock cannot be changed
  by users. Pausing the payment connection still permits signing and delivery;
  the hosted workspace itself needs internet. The Desktop app remains available
  for fully local use.

## Architecture

`app.py` exposes the Flask WSGI application on Vercel Python 3.13.
`webapp/cloud.py` adapts the existing HTTP operations; the cryptographic protocol,
offline verifier and ledger rules remain shared with the Desktop application.

`webapp/cloud_store.py` stores accounts, sessions, records, independent audit
chains, counters, profiles, notes, uploads and deduplicated delivery bytes in a
dedicated Neon Postgres database. Temporary directories are request-local scratch
space. No durable state relies on Vercel's temporary filesystem or process memory.

Each API request owns a database transaction and signing context. A Postgres
advisory transaction lock serializes changes, peer mirroring and pooled-ledger
updates so separate instances cannot double-spend balances or lose sequence
increments. This deliberately prioritizes correctness for the demonstration;
it does not claim unlimited write throughput. Failed business operations roll
back their records, file writes, counters and audit entries together.

Password-protected account keys retain the documented Desktop envelope format.
Unlocked session keys are additionally encrypted with AES-256-GCM and the
deployment secret; the session token is authenticated as associated data. Only
token hashes are used as database session identifiers. Signing keys are cleared
from the request context after processing. Python cannot guarantee memory erasure.

Payloads and unfinished uploads are accessible only through authenticated,
ownership-checked API operations. Chunks have exact lengths and immutable retry
semantics. An upload cannot be finalized for another account or agreement.

## Configuration and deployment

The dedicated Vercel project is `uni-321d/pq-escrow`, linked to
`Aravch07/Q-Escrow`. The database resource is `pq-escrow-db`, on Neon's Free plan
in Singapore. No unrelated project's database or account data is used.

Required environment variables, managed in Vercel:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | TLS Postgres connection, injected by the Neon integration |
| `PQE_SESSION_KEY` | Base64-encoded 32 random bytes for AES-GCM session encryption |

Keep both values out of source control. `.env*`, `.vercel/`, runtime data,
virtual environments and downloaded tools are ignored. Pass secrets through
stdin when using the Vercel CLI. Rotating the session key requires users to sign
in again; it does not change their password-encrypted account keys.

Vercel installs the hosted runtime from `pyproject.toml` / `requirements.txt`.
Use `requirements-core.txt` or `requirements-dev.txt` with the included wheelhouse
for the offline Desktop edition. Its launcher and PowerShell helpers select the
core dependencies. `requirements-cloud-dev.txt` adds hosted development tooling.

To deploy a checked checkout already linked to this project:

```powershell
vercel deploy --prod --scope uni-321d
```

The public health endpoint is `/api/health`; success reports `storage: postgres`.
It exposes no connection strings or credentials.

## Resource limits

The hosted demo allows 100 agreements and 150 MiB of saved deliveries per account,
five active uploads and 100 MiB of unfinished uploads per account. Unfinished
uploads expire after an hour. A 600 MiB shared payload/upload budget protects
the database allowance. The API reports a clear error before accepting an upload
that exceeds these limits. Large payloads are not embedded in agreement-list
responses; file downloads and bundle export use the authenticated chunk endpoints.

Login failures are limited across requests and instances (five failures per
minute for an account/address). Registration and upload-start requests also have
persistent hourly limits. No paid plan was selected to publish this version.

## Validation

`tests/test_cloud.py` uses an isolated, randomly named database schema when
`PQE_TEST_DATABASE_URL` is set. Use an unpooled test connection. The schema is
removed after each test; the production workspace is not reset. These checks
cover cross-instance sessions, the complete payment flow, wrong-file retry,
chunk transfer, ownership, private notes, CSV export, inbox state, revocation,
password changes, expiry, CSRF, login throttling, lab isolation and atomic rollback.

`scripts/hosted_browser_test.cjs` exercises registration and both parties in
separate real browser contexts, with a large file, signed-bundle export and
verification, session revocation and ten mobile/desktop pages. Screenshots and
executed results are saved under `docs/hosted-live/` for the public deployment.
