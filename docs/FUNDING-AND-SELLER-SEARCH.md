# Funding recovery and seller search

## Wallet balance and escrow balance

The account's test wallet and its deposited escrow balance are separate. A
positive wallet balance does not register a buyer key in the settlement ledger.
The first escrow deposit registers that key automatically.

The earlier relayer treated a missing deposit or insufficient balance as a
permanent rejection. That could leave a correctly signed and approved delivery
stuck. These two conditions now return **HOLD**, retain the agreement's current
state, and allow another payment attempt after funding. A real registered-key
mismatch, invalid signature, replay or reused sequence still rejects settlement.
An unfunded proposal waiting for delivery is also left pending.

For an approved but unfunded agreement, the buyer sees **Add funds to finish
payment** with the exact escrow shortfall. **Add funds in Wallet** pre-fills that
amount. After a successful deposit, the app returns to the original agreement;
the buyer can choose **Finish payment** without uploading or signing again. The
seller sees a funding message and receives live updates when the deposit arrives.
The amount and existing deposit-lock rules remain visible in Wallet. No deposit
or payment happens without the user choosing the corresponding action.

Payment actions from an agreement reconcile only that agreement. The API still
supports an explicit all-pending reconciliation when no agreement ID is supplied.

Old funding rejections require a bounded, audited recovery: validate signatures,
stored file hash/size, approval, ledger outcome and unused sequence; clear only
the erroneous funding rejection; preserve the original evidence and append an
audit event. This recovery must not move balances or automatically pay anyone.
Security rejections are not eligible for this procedure.

## Search seller usernames

The agreement builder uses an accessible username combobox instead of a fixed
dropdown. Type part of a username, optionally prefixed with `@`. Search ignores
case, prioritises prefix matches and shows up to eight suggestions. Choose a
result with the mouse or Arrow Up/Down and Enter. Escape closes suggestions.

The buyer's own username is excluded. Unknown names cannot advance to the next
step; the backend still resolves the chosen account independently. No first user
is selected automatically. The choice stays with an unsigned draft, and the
review step shows the exact username before signing.

## Verification

The local Python suite passed 100 cases, including retry after missing/insufficient
funding, unchanged signatures, genuine key-mismatch rejection, ownership, selected
agreement settlement, cancellation and startup. Three targeted Postgres cases
passed: funding retry across fresh instances, complete delivery/wrong-file flow,
and payment/cancellation concurrency.

`scripts/funding_search_test.cjs` checks self/unknown-name refusal, @username
normalisation, keyboard/mouse choice, narrow layouts, an approved unfunded payment,
the exact-amount Wallet handoff, automatic seller updates and eventual settlement
with the original signatures. Existing browser scripts use the new username field.
