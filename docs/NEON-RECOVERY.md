# Fresh hosted workspace

On 29 October 2026, the existing public site was connected to a new, dedicated
Neon Free project, `pq-escrow-recovery-20261029`, in Singapore. GitHub, the Vercel
project and https://pq-escrow.vercel.app remain the same.

The previous database was retained and disconnected from the website. Its
accounts and agreements were not migrated. Users should create new accounts on
the public site. New data is stored in Postgres, independently of browser storage,
temporary server files and Vercel deployments.

## Configuration

- The active project uses fixed 0.25 CU compute and default idle suspension.
- `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and `NEON_PROJECT_ID` are configured in
  Vercel for production, preview and development.
- The session encryption key was retained independently of the database settings.
- Database credentials, authentication profiles and private verification fixtures
  are not included in this repository or its release archive.
- No paid plan was enabled.

## Public-site verification

Two independent browser sessions registered new accounts and exercised incoming
agreements, seller delivery, buyer decisions, cancellation and settlement. Live
changes appeared without reloading: about 2.3 seconds for the incoming agreement,
3.8 seconds for delivery, and 2.4 seconds for payment in this run. These are observed
test timings, not a latency guarantee.

The production application was then rebuilt and redeployed. Fresh browser
sessions signed in through the interface and confirmed that:

- Both parties retained the settled agreement and verified signatures.
- The original delivered file remained available with its signed SHA-256.
- Cancellation and the buyer's private note remained saved; the seller's note was
  separate.
- Seller earnings could be claimed and the wallet balance updated correctly.
- Both audit chains remained valid.

No browser JavaScript errors were observed. Sanitized results are in
`docs/neon-recovery-checks/`. Production health returned HTTP 200 with
`ok: true` and `storage: postgres`.

## Demonstrating across computers

Open the public URL on both computers and create a buyer and seller account.
Use a small sample file, deposit test funds in the buyer's Wallet, then create,
sign, deliver, approve and finish the agreement. Keep both workspace tabs visible
to watch live updates. Close the tabs after the demonstration so the live checks
stop and the database can become idle. The Free plan retains its provider quotas.
