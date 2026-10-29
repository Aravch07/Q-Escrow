"""Small inbox summaries; never load delivery bytes or expose signing material."""

STATUSES = [
    ("PROPOSED", "Awaiting signature"), ("LOCKED", "Awaiting delivery"),
    ("DELIVERED", "Ready for review"), ("ACCEPTED", "Payment pending"),
    ("SETTLED", "Completed"), ("CANCELLED", "Cancelled"), ("REJECTED", "Needs review"),
]


def agreement_summary(row, viewer):
    body, terms = row["body"], row["body"]["terms"]
    state = ("CANCELLED" if body.get("cancellation") else "REJECTED" if body.get("rejection")
             else "SETTLED" if body.get("settlement") else "ACCEPTED" if body.get("acceptance")
             else "DELIVERED" if body.get("delivery") else "LOCKED" if row.get("seller_signed")
             else "PROPOSED")
    buyer, seller = terms["buyer"]["name"], terms["seller"]["name"]
    if viewer not in (buyer, seller):
        return None
    label = dict(STATUSES)[state]
    if state == "SETTLED":
        label = "Payment completed" if body["settlement"].get("release") else "Refunded"
    elif state == "ACCEPTED" and body["acceptance"].get("decision") == "refund":
        label = "Refund pending"
    return dict(escrow_id=row["id"], title=terms["description"].strip() or "Untitled agreement",
                state=state, status_label=label, buyer=buyer, seller=seller, created_by=buyer,
                counterparty=seller if viewer == buyer else buyer,
                role="buyer" if viewer == buyer else "seller")


def sender_for(event, agreement, viewer, body=None):
    """Infer historical signed actions; automated notices remain System updates."""
    kind = event["event"]
    if agreement:
        buyer, seller = agreement["buyer"], agreement["seller"]
        explicit = event.get("data", {}).get("actor")
        if explicit in (buyer, seller):
            return explicit
        if kind in ("proposed", "decision_release", "decision_refund", "buyer_funding_updated"):
            return buyer
        if kind in ("countersigned", "delivered"):
            return seller
        if kind in ("agreement_cancelled",) or kind == "bundle_imported" and event.get("data", {}).get("state") == "CANCELLED":
            role = ((body or {}).get("cancellation") or {}).get("cancelled_by")
            return agreement.get(role) if role in ("buyer", "seller") else None
        if kind == "bundle_imported":
            state = event.get("data", {}).get("state")
            return buyer if state in ("PROPOSED", "ACCEPTED") else seller if state in ("LOCKED", "DELIVERED") else None
        if kind in ("settled_release", "settled_refund", "settled_cancelled"):
            return viewer
        if kind == "peer_settlement_observed" and agreement["state"] == "CANCELLED":
            role = ((body or {}).get("cancellation") or {}).get("cancelled_by")
            return agreement.get(role) if role in ("buyer", "seller") else None
        return None
    return viewer if kind in ("account_created", "wallet_deposit", "withdraw", "claim") else None


def build_inbox(viewer, rows, records, seen_at=0, seen_id=None):
    metadata, bodies = {}, {}
    for row in records:
        summary = agreement_summary(row, viewer)
        if summary:
            metadata[row["id"]], bodies[row["id"]] = summary, row["body"]
    cards, account_events, events, unread_groups = {}, [], [], {}
    for row in rows:
        raw = row["body"]
        id = raw.get("escrow_id")
        agreement = metadata.get(id)
        unread = raw["id"] > seen_id if seen_id is not None else raw["at"] > seen_at
        event = dict(id=raw["id"], event=raw["event"], at=raw["at"],
                     escrow_id=id if agreement else None, unread=unread,
                     sender=sender_for(raw, agreement, viewer, bodies.get(id)),
                     observed_state=raw.get("data", {}).get("state"))
        events.append(event)
        unread_groups.setdefault(id, int(row.get("group_unread", int(unread))))
        if agreement:
            if id not in cards:
                cards[id] = {**agreement, "events": [], "unread_count": int(row.get("group_unread", int(unread))),
                             "update_count": int(row.get("group_total", 1)), "latest_at": event["at"], "latest_id": event["id"]}
            cards[id]["events"].append(event)
        else:
            account_events.append(event)
    agreements = sorted(cards.values(), key=lambda card: card["latest_id"], reverse=True)
    counts = {state: sum(card["state"] == state for card in agreements) for state, _ in STATUSES}
    return dict(events=events, unread=sum(unread_groups.values()), agreements=agreements,
                account_events=account_events, status_counts=counts,
                statuses=[dict(state=state, label=label) for state, label in STATUSES])
