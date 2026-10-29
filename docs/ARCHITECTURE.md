# Protocol and trust architecture

## Stage-to-code map

| Stage | Implementation | Durable evidence |
|---|---|---|
| Create escrow | `protocol.propose`, `Store.next_seq` | Random nonce; canonical terms; buyer terms signature |
| Authenticate | `protocol.countersign`, `verify_signatures` | Seller terms signature after buyer verification |
| Deliver and hash | `protocol.deliver`, `accept`, `crypto.sha256_file` | Signed file receipt and buyer decision |
| Operate offline | `Store`, `export_bundle`, `import_bundle` | SQLite records, per-ID vault, exchangeable JSON |
| Verify and reconcile | `verify_offline`, `reconcile` | Ordered verdicts, audit entries, anchored evidence hash |
| Blockchain settlement | `LocalLedger`, `Web3Chain`, `PQEscrow.sol` | Single-use escrow and sequence, pull-payment balance |

The ML-DSA wrapper uses `dilithium_py.ml_dsa.ML_DSA_65`, the FIPS 204 API,
not the older CRYSTALS-Dilithium API. Public keys are 1,952 bytes, secret keys
4,032 bytes, and signatures 3,309 bytes. Binary fields use strict base64.

## Signed messages and domain separation

| Signature | Signer | Canonical message | ML-DSA context bytes |
|---|---|---|---|
| Buyer terms | Buyer | Complete terms | `PQE-v1/terms/buyer` |
| Seller terms | Seller | Identical complete terms | `PQE-v1/terms/seller` |
| Delivery | Seller | `{escrow_id, sha256, size, filename, delivered_at}` | `PQE-v1/delivery` |
| Acceptance | Buyer | `{escrow_id, decision, sha256, delivery_signature_sha256, accepted_at}` | `PQE-v1/acceptance` |

Canonical JSON is UTF-8, keys sorted lexicographically, no insignificant
whitespace, no NaN/Infinity, and non-ASCII characters encoded directly. Strings
are not Unicode-normalized. `amount_wei` is a positive canonical decimal string;
sequence and timestamps are integers (booleans are refused). EVM addresses are
lower-case, 20-byte hex. Timestamps are Unix UTC seconds. Expiry is exclusive:
delivery and release decisions must be strictly earlier than `expires_at`.

The escrow ID is the SHA-256 of these exact canonical terms. The terms contain
version, random 128-bit nonce, two full public identity descriptors, amount,
per-buyer sequence, description, optional expected file hash, creation and expiry.
Each descriptor's key hash must equal SHA-256 of its raw public key.

The acceptance binds both the delivery file hash and SHA-256 of the **decoded
delivery signature bytes**. Re-signing even an identical receipt produces a
different signature and invalidates the earlier acceptance binding. The contexts
are passed through ML-DSA's `ctx` parameter, not merely prepended to UI text.

## Storage and bundle import

Each party has its own SQLite database, sequence counter, audit chain, and vault.
`Record.state` is a property derived from artifacts: buyer signature → PROPOSED;
seller signature → LOCKED; receipt plus signature → DELIVERED; decision plus
signature → ACCEPTED. A recorded settlement or rejection makes the terminal state.
No independent mutable lifecycle column exists. Audit entries record a snapshot
of the derived state for history; they do not drive transitions.

Every mutation appends a canonical audit entry with its ID, wall-clock time,
event, escrow ID, data, and previous entry hash. The saved head commits to count
and digest. `verify_log()` checks IDs, links, hashes and head, including deletion
of a tail while the head is retained. Audit wall-clock timestamps are distinct
from the injectable protocol/demo clock. The head is local, not externally trusted.

The bundle has exactly `format`, `escrow_id`, `terms`, `signatures`, `delivery`,
`acceptance`, `payload`. No secret key, local path, peer settlement, or peer
rejection is accepted. All included signatures are verified before persistence,
and the payload's hash and length must match its signed receipt. Incoming
signatures cannot conflict with existing signature bytes, even if both verify.
Older partial bundles cannot regress a more complete record. Observing an
imported sequence advances the local sequence counter.

Payloads are written only to `vault/<validated 64-hex escrow ID>/payload`.
The signed filename is display metadata and is never joined into a filesystem
path. Website uploads sanitize it before signing, and downloads sanitize it
again for the attachment header. Payload confidentiality is not provided.

## Reconciliation policy

New deliveries with `expected_sha256` are checked against the raw file bytes
before any vault directory, payload, receipt, signature or audit entry is written.
A mismatch raises an error and leaves the countersigned agreement available for
a correct-file retry. This applies to CLI and HTTP delivery calls. The browser
also checks before enabling its signing button, but the server remains authoritative.
The refund policy below still handles signed mismatches imported or saved by an
older version; historical evidence is not rewritten.

`verify_offline(record, now)` reads local bytes but mutates no state and uses no
network. It validates the structure, every present signature, artifact
dependencies, exact receipt binding, timestamps, actual payload length/hash,
and optional expected hash. It reports checks with a verdict and explanation.

| Condition | Outcome |
|---|---|
| Bad terms/ID/key hash/signature/dependency/binding | REJECT |
| Signed artifact in the future | REJECT |
| Valid cancellation signed by either named party | CANCELLED |
| Delivered payload absent, altered, or wrong length | REJECT |
| No delivery yet, before expiry | HOLD |
| No delivery at expiry or later | REFUND |
| Delivery at or after expiry | REFUND |
| Actual receipt file differs from expected hash | REFUND |
| Timely delivery, no decision, before expiry | HOLD |
| Timely delivery, no decision, expiry reached | REFUND |
| Buyer signs refund, or release is dated at/after expiry | REFUND |
| Intact timely delivery and timely buyer release | RELEASE |

Cancellation is an independent terminal decision; its signature and timestamp
are checked before the normal delivery/payment policy. See
[cancellation and live updates](LIVE-UPDATES-AND-CANCELLATION.md).

For non-cancelled agreements, integrity is checked before expected-hash and deadline refunds: a corrupted
stored file is rejected for review, even when a refund might otherwise apply.
Once a timely release is signed, it may be settled after expiry. Before signing
release, the buyer hashes the actual received vault file (or an explicitly
provided CLI received file) and checks the receipt and optional expected hash.

`reconcile` examines all nonfinal records. Two pending escrows with the same
buyer EVM address and sequence are **both** rejected for manual review. Remaining
records are processed by `(buyer address, seq, escrow_id)`. It refuses already
settled IDs, used sequences, or unregistered/mismatched buyer keys. For RELEASE
it checks available funds after earlier releases have consumed them. REFUND
does not debit funds, but requires a registered key and consumes the sequence
and escrow ID. HOLD remains pending and consumes no balance or sequence.

Immediately before submission, the full signed bundle (including payload) is
captured and verified again so the evidence hash commits to the exact verified
snapshot. The hash is `SHA-256(canonical_json(full_bundle))`. Local paths,
settlement metadata, and audit entries are outside that evidence commitment.

The strict core reports a replay if another store already settled an ID. The
web layer first observes matching ledger settlements and mirrors their result
into the local record, so the counterparty sees SETTLED rather than REJECTED.

## Offline double-spend design

Offline devices cannot see each other's counter or promises. Copying a wallet
can produce two different, validly signed escrows sharing the same sequence.
The design bounds exposure and detects conflicts; it cannot prevent all offline
over-commitment or promise the seller that a release will succeed.

1. A time-locked, prefunded balance backs the buyer's promises until its unlock.
2. Depositing permanently registers the buyer's public-key hash for that address.
3. Every settled escrow consumes one address/sequence pair.
4. Release checks and consumes the remaining pooled balance atomically on-chain.
5. Every escrow ID may settle once. Replay fails even with a different sequence.

Locks never shorten on deposit. An account cannot switch key hashes. Refunding
an escrow leaves the pooled balance in place, subject to the original time lock;
it is not a transfer of an individually reserved amount. Withdraw becomes
available after unlock and can deplete backing for pending offline escrows.
The app does not prove that an escrow's expiry falls within a trusted lock
snapshot. The contract is the final authority; whichever valid sequence settles
first wins across devices. Local ordering only makes one relayer's batch
deterministic, not global transaction ordering.

## Contract and adapter

`accounts`, `claimable`, `seqUsed`, `settlements`, and `isSettled` hold the final
state. Owner controls the relayer allow-list. Withdraw/claim use a reentrancy
guard and checks-effects-interactions. Release credits the seller's claimable
balance; `claim()` performs the external transfer. A refund only records evidence
and consumes uniqueness markers. Solidity custom errors and events describe
state changes. Neither relayer authority nor key rotation has a recovery system.

LocalLedger mirrors those rules in JSON with a separate OS file lock and atomic
replacement for each ledger update. It mints test backing freely; it is not a
distributed blockchain, does not charge gas, and is editable by its file owner.
Web3Chain exposes the same balance, deposit, withdraw, claim, sequence and
settlement methods against the included ABI. Its runtime could not be validated
on this build machine; see the verification report.

## Trust model and limitations

* Relayers perform ML-DSA verification off-chain. The contract cannot distinguish
  valid from fabricated evidence submitted by an authorized relayer. Its
  evidence hash is an audit anchor, not a signature verification proof.
* Ethereum account authentication remains classical; the EVM chain is not
  post-quantum. The SHA-256 escrow ID alone is not a payment authorization.
* Pure-Python dilithium-py is not an audited, constant-time cryptographic custody
  implementation. The project and Solidity contract are unaudited.
* Website keys are password-encrypted at rest, but the server has signing power
  while a user is logged in. Use device/hardware custody for a production design.
  CLI plaintext identities are development-only. Memory deletion in Python is
  best effort; crash dumps, swap, malware, and old backups are outside the model.
* Signed timestamps attest what a signer claimed, not when a physical delivery
  occurred. The relayer trusts its clock. No timestamp oracle is implemented.
* No dispute resolution, satisfaction guarantee, refund arbitration, delivery
  confidentiality, external identity certification, or key-recovery flow exists.
* Attack-resistant backups, globally anchored audit heads, atomic cross-database
  wallet updates, multi-process web-server coordination, chain reorganizations,
  and transaction finality are not implemented.

References: [dilithium-py implementation and FIPS 204 API](https://github.com/GiacomoPope/dilithium-py),
[Solidity security considerations](https://docs.soliditylang.org/en/latest/security-considerations.html).
