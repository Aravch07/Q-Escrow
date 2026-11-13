"""Shared hosted request board and the handoff into signed escrow."""
import re
import secrets

from flask import request

from .accounts import HTTPError

CATEGORIES = {
    "python": "Python", "java": "Java", "web": "Web development", "design": "Images & design",
    "science": "Science & research", "writing": "Writing", "data": "Data & analytics", "other": "Other",
}
PAGE_SIZE = 24
SORTS = {"newest": "created_at DESC", "budget": "budget_wei::numeric DESC,created_at DESC",
         "active": "offer_count DESC,created_at DESC"}


def required_text(data, key, maximum, label):
    value = data.get(key)
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum or "\x00" in value:
        raise HTTPError(400, f"Enter {label} using 1–{maximum} characters")
    return value.strip()


def price(data, key):
    value = data.get(key)
    if not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]{0,21}", value):
        raise HTTPError(400, "Enter a positive amount below 10,000 test ETH")
    return value


def visible_listing(row, name):
    listing = dict(row)
    if name not in (listing["requester"], listing["seller"]):
        listing.pop("escrow_id")
    return listing


def browse(handler, name):
    conn = handler.connection
    category = request.args.get("category", "")
    query = request.args.get("q", "").strip()[:120].replace("\x00", "")
    offset = request.args.get("offset", "0")
    view = request.args.get("view", "mine" if request.args.get("mine") == "1" else "open")
    sort = request.args.get("sort", "newest")
    if ((category and category not in CATEGORIES) or not re.fullmatch(r"[0-9]{1,7}", offset)
            or view not in ("open", "mine", "offers", "saved") or sort not in SORTS):
        raise HTTPError(400, "Invalid marketplace filters")
    rows = conn.execute("""WITH board AS (
        SELECT r.*, b.member IS NOT NULL AS saved, o.seller IS NOT NULL AS offered,
               (SELECT COUNT(*) FROM pqe_market_offers a WHERE a.request_id=r.id) AS offer_count
        FROM pqe_market_requests r
        LEFT JOIN pqe_market_saved b ON b.request_id=r.id AND b.member=%s
        LEFT JOIN pqe_market_offers o ON o.request_id=r.id AND o.seller=%s
        WHERE CASE %s WHEN 'open' THEN r.status='open' WHEN 'mine' THEN r.requester=%s
              WHEN 'offers' THEN o.seller IS NOT NULL ELSE b.member IS NOT NULL END
          AND (%s='' OR r.category=%s)
          AND strpos(lower(r.title || ' ' || r.description || ' ' || r.requester), lower(%s))>0)
        SELECT * FROM board ORDER BY """ + SORTS[sort] + ",id DESC LIMIT %s OFFSET %s",
        (name, name, view, name, category, category, query, PAGE_SIZE + 1, int(offset))).fetchall()
    stats = conn.execute("SELECT category,COUNT(*) AS total FROM pqe_market_requests WHERE status='open' GROUP BY category")
    return handler.send(200, {"categories": CATEGORIES, "category_counts": {r["category"]: r["total"] for r in stats},
                              "requests": [visible_listing(row, name) for row in rows[:PAGE_SIZE]],
                              "next_offset": int(offset) + PAGE_SIZE if len(rows) > PAGE_SIZE else None})


def marketplace_api(handler, route, post, name, party):
    conn, now = handler.connection, handler.app.now()
    if route == "marketplace":
        if not post:
            return browse(handler, name)
        data = handler.body()
        category = required_text(data, "category", 24, "a category")
        if category not in CATEGORIES:
            raise HTTPError(400, "Choose a marketplace category")
        title = required_text(data, "title", 120, "a title")
        description = required_text(data, "description", 1200, "a description")
        budget = price(data, "budget_wei")
        count = conn.execute("SELECT COUNT(*) FROM pqe_market_requests WHERE requester=%s", (name,)).fetchone()[0]
        if count >= 50:
            raise HTTPError(429, "Your account has reached its 50 request limit")
        listing_id = secrets.token_hex(16)
        conn.execute("""INSERT INTO pqe_market_requests(id,requester,category,title,description,budget_wei,created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s)""", (listing_id, name, category, title, description, budget, now))
        return handler.send(201, {"id": listing_id})

    match = re.fullmatch(r"marketplace/([0-9a-f]{32})(?:/(offer|accept|close|save|messages))?", route)
    if not match:
        raise HTTPError(404, "Marketplace action not found")
    listing_id, action = match.groups()
    listing = conn.execute("SELECT * FROM pqe_market_requests WHERE id=%s", (listing_id,)).fetchone()
    if not listing:
        raise HTTPError(404, "Work request not found")
    owner = listing["requester"] == name
    if action == "messages":
        return conversation(handler, listing, name, post)
    if not post and action is None:
        offers = conn.execute("""SELECT seller,amount_wei,hours,note,created_at FROM pqe_market_offers
            WHERE request_id=%s AND (%s OR seller=%s) ORDER BY created_at,seller""", (listing_id, owner, name)).fetchall()
        return handler.send(200, {"request": visible_listing(listing, name), "offers": offers, "categories": CATEGORIES})
    if not post or action is None:
        raise HTTPError(405, "Use the marketplace form for this action")
    if action == "save":
        saved = handler.body().get("saved")
        if type(saved) is not bool:
            raise HTTPError(400, "Choose whether to save the request")
        if saved:
            conn.execute("INSERT INTO pqe_market_saved VALUES (%s,%s) ON CONFLICT DO NOTHING", (name, listing_id))
        else:
            conn.execute("DELETE FROM pqe_market_saved WHERE member=%s AND request_id=%s", (name, listing_id))
        return handler.send(200, {"saved": saved})
    if action == "offer" and owner:
        raise HTTPError(403, "You cannot offer work on your own request")
    if action != "offer" and not owner:
        raise HTTPError(403, "Only the requester can choose an offer or close the request")
    if listing["status"] != "open":
        raise HTTPError(409, "This request is no longer open")
    data = handler.body()
    if action == "close":
        conn.execute("UPDATE pqe_market_requests SET status='closed' WHERE id=%s", (listing_id,))
        return handler.send(200, {"ok": True})
    if action == "offer":
        amount = price(data, "amount_wei")
        hours = data.get("hours")
        note = required_text(data, "note", 500, "an offer summary")
        if int(amount) > int(listing["budget_wei"]) or type(hours) is not int or not 1 <= hours <= 168:
            raise HTTPError(400, "Stay within the request budget and allow 1–168 hours")
        # Offers are immutable so a requester can sign exactly what was shown.
        result = conn.execute("""INSERT INTO pqe_market_offers VALUES (%s,%s,%s,%s,%s,%s)
            ON CONFLICT DO NOTHING RETURNING seller""", (listing_id, name, amount, hours, note, now)).fetchone()
        if not result:
            raise HTTPError(409, "You already sent an offer for this request")
        requester = handler.app.accounts.party(listing["requester"], public_only=True)
        requester.store.log("marketplace_offer_received", data={"actor": name, "request_id": listing_id, "title": listing["title"]})
        return handler.send(201, {"ok": True})
    seller = required_text(data, "seller", 20, "a seller username")
    offer = conn.execute("SELECT * FROM pqe_market_offers WHERE request_id=%s AND seller=%s", (listing_id, seller)).fetchone()
    if not offer:
        raise HTTPError(404, "This offer could not be found")
    description = f"{listing['title']}\n\n{listing['description']}\n\nSeller’s offer: {offer['note']}"
    record = handler.create_agreement(party, {"seller": seller, "amount_wei": offer["amount_wei"],
                                              "description": description, "expires_at": now + offer["hours"] * 3600})
    conn.execute("UPDATE pqe_market_requests SET status='matched',seller=%s,escrow_id=%s WHERE id=%s",
                 (seller, record.escrow_id, listing_id))
    return handler.send(201, {"escrow_id": record.escrow_id})


def conversation(handler, listing, name, post):
    conn = handler.connection
    listing_id, buyer = listing["id"], listing["requester"]
    seller = request.args.get("seller", "") if name == buyer else name
    if not re.fullmatch(r"[a-z0-9_]{3,20}", seller):
        raise HTTPError(404, "Conversation not found")
    if not conn.execute("SELECT 1 FROM pqe_market_offers WHERE request_id=%s AND seller=%s",
                        (listing_id, seller)).fetchone():
        raise HTTPError(404, "Conversation not found")
    if not post:
        messages = conn.execute("""SELECT id,sender,message,created_at FROM pqe_market_messages
            WHERE request_id=%s AND seller=%s ORDER BY id""", (listing_id, seller)).fetchall()
        return handler.send(200, {"messages": messages})
    if listing["status"] == "closed" or (listing["status"] == "matched" and listing["seller"] != seller):
        raise HTTPError(409, "This conversation is read-only")
    message = required_text(handler.body(), "message", 1600, "a message")
    count = conn.execute("SELECT COUNT(*) FROM pqe_market_messages WHERE request_id=%s AND seller=%s",
                         (listing_id, seller)).fetchone()[0]
    if count >= 100:
        raise HTTPError(429, "This conversation has reached 100 messages")
    conn.execute("""INSERT INTO pqe_market_messages(request_id,seller,sender,message,created_at)
        VALUES (%s,%s,%s,%s,%s)""", (listing_id, seller, name, message, handler.app.now()))
    recipient = seller if name == buyer else buyer
    handler.app.accounts.party(recipient, public_only=True).store.log("marketplace_message_received", data={
        "actor": name, "request_id": listing_id, "title": listing["title"], "seller": seller,
    })
    return handler.send(201, {"ok": True})
