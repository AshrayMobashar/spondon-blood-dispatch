"""End-to-end verification against a running server on port 1184.

Unlike a print-everything script, every check here asserts, so a regression
fails the run instead of scrolling past. Each check names the requirement it
covers.

    python -m app.main        # in one terminal
    python smoke_test.py      # in another
"""
import asyncio
import base64
import json
import sys
from contextlib import suppress
from datetime import datetime, timedelta, timezone

import httpx
import websockets

BASE = "http://localhost:1184"

PASSED, FAILED = [], []


def check(label: str, condition: bool, detail: str = "") -> bool:
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append((label, detail))
        print(f"  FAIL  {label}\n        {detail}")
    return condition


def section(title: str) -> None:
    print(f"\n{'=' * 72}\n{title}\n{'=' * 72}")


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def phone_for(stamp: str, seq: int) -> str:
    """A unique, well-formed BD mobile: 01 + 9 digits."""
    return f"01{seq}{stamp}00"[:11]


async def register(c: httpx.AsyncClient, phone: str, **kw) -> dict:
    """Full OTP registration, returning the auth payload."""
    r = await c.post("/api/auth/otp/request", json={"phone": phone, "purpose": "REGISTER"})
    r.raise_for_status()
    code = r.json()["dev_code"]
    r = await c.post("/api/auth/register", json={"phone": phone, "code": code, **kw})
    r.raise_for_status()
    return r.json()


async def main() -> int:
    now = datetime.now(timezone.utc)
    stamp = now.strftime("%H%M%S")

    async with httpx.AsyncClient(base_url=BASE, timeout=30) as c:
        cfg = (await c.get("/api/config")).json()
        integrations = cfg["integrations"]
        print(f"Integrations live: "
              f"{', '.join(k for k, v in integrations.items() if v) or 'none (all simulated)'}")

        # ── Common Workflow 1 — Registration, Auth & Profile ────────
        section("CW1 — Registration, Authentication & Profile System")

        phone_d = phone_for(stamp, 9)
        r = await c.post("/api/auth/otp/request", json={"phone": phone_d, "purpose": "REGISTER"})
        otp = r.json()
        check("OTP is issued server-side", r.status_code == 200 and "dev_code" in otp,
              f"{r.status_code} {r.text[:200]}")

        bad = await c.post("/api/auth/register", json={
            "phone": phone_d, "code": "000000", "name": "Wrong Code",
            "role": "donor", "blood_type": "O+",
        })
        check("A wrong OTP is rejected", bad.status_code == 400,
              f"expected 400, got {bad.status_code}")

        # Corner case: implausible weight at sign-up is refused.
        r = await c.post("/api/auth/otp/request", json={"phone": phone_d, "purpose": "REGISTER"})
        code = r.json()["dev_code"]
        r = await c.post("/api/auth/register", json={
            "phone": phone_d, "code": code, "name": "Typo Donor",
            "role": "donor", "blood_type": "O+", "health": {"weight_kg": 5},
        })
        check("CC: 5 kg is rejected at sign-up", r.status_code == 400,
              f"expected 400, got {r.status_code}: {r.text[:200]}")

        donor = await register(
            c, phone_d, name="Smoke Donor", role="donor", blood_type="O+",
            fcm_token="fcm_smoke_donor",
            health={"weight_kg": 70, "last_donation_date": iso(now - timedelta(days=400)),
                    "last_donation_type": "WHOLE_BLOOD"},
        )
        did, dtoken = donor["account"]["id"], donor["access_token"]
        check("Donor registers and receives a session token", bool(dtoken))
        check("Donor lands on a donor dashboard",
              donor["account"]["home"].startswith("/donor"), donor["account"]["home"])

        patient = await register(
            c, phone_for(stamp, 8), name="Smoke Patient", role="patient", blood_type="A+",
        )
        ptoken = patient["access_token"]
        check("CC: patient is routed to the patient dashboard, not the donor one",
              patient["account"]["home"].startswith("/patient"), patient["account"]["home"])

        r = await c.get("/api/auth/me", headers={"Authorization": f"Bearer {dtoken}"})
        check("Session token resolves to the account", r.status_code == 200)
        r = await c.get("/api/auth/me", headers={"Authorization": "Bearer not-a-token"})
        check("A forged token is rejected", r.status_code == 401)

        # A verified-but-unregistered number finishes sign-up on the ticket it
        # was handed, so one sign-up never costs two SMS messages.
        phone_t = phone_for(stamp, 5)
        r = await c.post("/api/auth/otp/request", json={"phone": phone_t, "purpose": "LOGIN"})
        r = await c.post("/api/auth/otp/verify",
                         json={"phone": phone_t, "code": r.json()["dev_code"]})
        ticket = r.json().get("registration_ticket")
        check("An unknown number is handed a registration ticket",
              r.json()["registered"] is False and bool(ticket), r.text[:200])
        r = await c.post("/api/auth/register", json={
            "phone": phone_t, "ticket": ticket, "name": "Ticket User",
            "role": "patient", "blood_type": "B+",
        })
        check("The ticket completes registration without a second code",
              r.status_code == 201, f"{r.status_code}: {r.text[:200]}")
        r = await c.post("/api/auth/register", json={
            "phone": phone_for(stamp, 4), "ticket": ticket, "name": "Thief",
            "role": "patient", "blood_type": "B+",
        })
        check("A ticket cannot be replayed against a different number",
              r.status_code == 400, f"got {r.status_code}")

        # ── Module 1.1 — Eligibility engine ─────────────────────────
        section("M1F1 — Eligibility Cooldown & Auto-Pause Engine")

        elig = (await c.get(f"/api/donors/{did}/eligibility")).json()
        check("Donor 400 days past a whole-blood donation is eligible", elig["eligible"],
              str(elig["reasons"]))
        check("UI rules come from the engine (120-day whole blood)",
              elig["rules"]["whole_blood_cooldown_days"] == 120)

        r = await c.post(f"/api/donors/{did}/donations", json={"donation_type": "WHOLE_BLOOD"})
        body = r.json()
        check("Whole blood locks eligibility for exactly 120 days",
              body["cooldown_days"] == 120 and not body["eligibility"]["eligible"], str(body)[:200])
        cd = body["eligibility"]["countdown"]
        check("Countdown is live, not hard-coded",
              cd["locked_by_cooldown"] and 119 <= cd["days"] <= 120, str(cd))

        r = await c.post(f"/api/donors/{did}/donations", json={"donation_type": "PLATELETS"})
        body = r.json()
        check("Platelets lock eligibility for only 14 days",
              body["cooldown_days"] == 14 and body["eligibility"]["countdown"]["days"] in (13, 14),
              str(body["eligibility"]["countdown"]))

        # Corner case A: implausible weight on the *update* path.
        before = (await c.get(f"/api/donors/{did}/health")).json()["health"]["weight_kg"]
        r = await c.put(f"/api/donors/{did}/weight", json={"weight_kg": 5})
        after = (await c.get(f"/api/donors/{did}/health")).json()["health"]["weight_kg"]
        check("CC-A: 5 kg is rejected on update and the last valid weight is kept",
              r.status_code == 400 and after == before, f"{r.status_code}, {before} -> {after}")

        r = await c.put(f"/api/donors/{did}/weight", json={"weight_kg": 46})
        check("Weight below 50 kg locks the flag as a separate medical risk",
              r.json()["eligibility"]["underweight"]
              and not r.json()["eligibility"]["eligible"])
        await c.put(f"/api/donors/{did}/weight", json={"weight_kg": 70})

        # Corner case B: certificate → admin unlock.
        r = await c.post(f"/api/donors/{did}/certificates", json={
            "note": "Donation date mistyped.", "issued_at": iso(now),
        })
        cert_id = r.json()["id"]
        check("CC-B: a medical certificate can be submitted", r.status_code == 201)

        # ── Admin console ───────────────────────────────────────────
        section("CW2 — Admin Role & Access Management")

        r = await c.post("/api/admin/login",
                         json={"email": "admin@spondon.com", "password": "spondon123"})
        check("Admin signs in", r.status_code == 200, r.text[:200])
        ah = {"Authorization": f"Bearer {r.json()['access_token']}"}

        check("Admin endpoints reject an unauthenticated caller",
              (await c.get("/api/admin/overview")).status_code == 401)
        check("A user token cannot be replayed against an admin endpoint",
              (await c.get("/api/admin/overview",
                           headers={"Authorization": f"Bearer {dtoken}"})).status_code == 401)

        overview = (await c.get("/api/admin/overview", headers=ah)).json()
        check("Overview reports live counts", overview["requests_total"] > 0, str(overview)[:200])

        r = await c.post(f"/api/admin/certificates/{cert_id}/review",
                         json={"action": "APPROVE"}, headers=ah)
        check("CC-B: approving the certificate releases the cooldown early",
              r.status_code == 200 and r.json()["eligible"], r.text[:300])

        # ── Module 2.3 — Doctor's-slip OCR gate ─────────────────────
        section("M2F3 — Doctor's-Slip OCR Verification")

        px = base64.b64encode(bytes.fromhex("ffd8ffe000104a46494600010100000100010000ffd9")).decode()
        req = (await c.post("/api/requests", json={
            "patient_name": "Slip Test", "hospital": "Dhaka Medical College",
            "blood_type": "O+", "component": "PLATELETS", "severity": "CRITICAL",
            "road_segment": "Kazipara", "hospital_lat": 23.7261, "hospital_lng": 90.3969,
        }, headers={"Authorization": f"Bearer {ptoken}"})).json()
        req_id = req["id"]
        check("Request records its requester", req["requester_id"] is not None)

        d = (await c.post("/api/dispatch/evaluate", json={"request_id": req_id})).json()
        check("No dispatch is authorised before the slip is confirmed",
              d["pinged"] == 0 and "slip" in (d["blocked_reason"] or "").lower(),
              str(d["blocked_reason"]))

        r = await c.post(f"/api/requests/{req_id}/slip",
                         json={"image": px, "mime": "image/jpeg"})
        slip = r.json()
        if integrations["ocr"]:
            check("Slip is scored by the live OCR engine", slip["ocr_confidence"] is not None)
        else:
            check("CC: an unreadable slip goes to human review, never auto-rejected",
                  slip["slip_status"] == "NEEDS_REVIEW", str(slip))

        r = await c.post(f"/api/admin/requests/{req_id}/slip",
                         json={"action": "VERIFY"}, headers=ah)
        check("Admin overrides the OCR verdict", r.json()["slip_status"] == "VERIFIED")

        # ── Module 1.2 — Smart Ping ─────────────────────────────────
        section("M1F2 — Smart Ping: Sleep Mode & Commute-Aware Matching")

        await c.put(f"/api/donors/{did}/sleep-mode", json={
            "enabled": True, "start": "23:00", "end": "07:00",
            "allow_extreme_emergencies": True, "dnd_on": True,
        })
        await c.put(f"/api/donors/{did}/location", json={
            "lat": 23.7280, "lng": 90.3990, "road_segment": "Kazipara",
        })

        d = (await c.post("/api/dispatch/evaluate",
                          json={"request_id": req_id, "now": "02:00"})).json()
        mine = [x for x in d["results"] if x["donor_id"] == did]
        check("Non-emergency inside the sleep window is suppressed",
              bool(mine) and mine[0]["decision"] == "SKIPPED_SLEEP", str(mine)[:300])

        await c.patch(f"/api/admin/requests/{req_id}",
                      json={"severity": "LIFE_THREATENING"}, headers=ah)
        d = (await c.post("/api/dispatch/evaluate",
                          json={"request_id": req_id, "now": "02:00"})).json()
        mine = [x for x in d["results"] if x["donor_id"] == did]
        check("CC-A: a life-threatening request breaks through with a DND-piercing push",
              bool(mine) and mine[0]["decision"] == "EMERGENCY_BREAKTHROUGH"
              and mine[0]["fcm_priority"] == "high" and mine[0]["fcm_bypass_dnd"],
              str(mine)[:300])

        await c.put(f"/api/donors/{did}/sleep-mode", json={
            "enabled": False, "start": "23:00", "end": "07:00",
            "allow_extreme_emergencies": True, "dnd_on": False,
        })
        await c.put(f"/api/donors/{did}/commute-route",
                    json={"segments": ["Mirpur-Rd", "Kazipara"], "label": "Home to office"})
        d = (await c.post("/api/dispatch/evaluate",
                          json={"request_id": req_id, "now": "10:00"})).json()
        mine = [x for x in d["results"] if x["donor_id"] == did]
        check("A donor on their saved segment gets a proactive route ping",
              bool(mine) and mine[0]["decision"] == "ROUTE_MATCH" and mine[0]["pinged"],
              str(mine)[:300])

        # CC-B: driven past the segment → no route ping, but NOT silenced.
        # Still well inside the 3 km ripple, so the only thing that changes is
        # which road they are on — otherwise this would test the radius instead.
        await c.put(f"/api/donors/{did}/location", json={
            "lat": 23.7285, "lng": 90.3995, "road_segment": "Panthapath",
        })
        d = (await c.post("/api/dispatch/evaluate",
                          json={"request_id": req_id, "now": "10:00"})).json()
        mine = [x for x in d["results"] if x["donor_id"] == did]
        check("CC-B: off the segment, the route ping is withheld",
              bool(mine) and mine[0]["decision"] != "ROUTE_MATCH", str(mine)[:300])
        check("A saved route never makes a donor *less* reachable than no route",
              bool(mine) and mine[0]["pinged"], str(mine)[:300])

        # The proactive route ping is not a proximity ping, so the ripple radius
        # must not veto it: a donor 8 km from the hospital who is *on* the road
        # the request sits on has zero extra travel and is exactly who the
        # feature exists to reach.
        await c.put(f"/api/donors/{did}/location", json={
            "lat": 23.8000, "lng": 90.3969, "road_segment": "Kazipara",
        })
        d = (await c.post("/api/dispatch/evaluate",
                          json={"request_id": req_id, "now": "10:00"})).json()
        mine = [x for x in d["results"] if x["donor_id"] == did]
        check("A donor on the segment is pinged even outside the ripple radius",
              bool(mine) and mine[0]["decision"] == "ROUTE_MATCH"
              and mine[0]["distance_km"] > d["radius_km"],
              f"radius={d['radius_km']} mine={str(mine)[:300]}")

        # Pausing route matching keeps the saved route — a donor who switches it
        # off must not have to retype their commute to switch it back on.
        r = await c.post(f"/api/donors/{did}/commute-route/toggle?enabled=false")
        route = r.json()["commute_route"]
        check("Pausing route matching preserves the saved segments",
              route["enabled"] is False and len(route["segments"]) == 2, str(route))
        d = (await c.post("/api/dispatch/evaluate",
                          json={"request_id": req_id, "now": "10:00"})).json()
        check("A paused route stops earning the out-of-radius ping",
              did in [x["donor_id"] for x in d.get("out_of_range", [])],
              str(d.get("out_of_range"))[:300])

        r = await c.post(f"/api/donors/{did}/commute-route/toggle?enabled=true")
        check("Resuming needs no re-entry of the route",
              r.json()["commute_route"]["segments"] == ["Mirpur-Rd", "Kazipara"],
              str(r.json())[:200])
        await c.put(f"/api/donors/{did}/location", json={
            "lat": 23.7285, "lng": 90.3995, "road_segment": "Kazipara",
        })

        # GET symmetry: the saved route can be read back on its own.
        r = await c.get(f"/api/donors/{did}/commute-route")
        check("The saved commute route can be read back via GET",
              r.status_code == 200 and r.json()["commute_route"]["segments"] == ["Mirpur-Rd", "Kazipara"],
              str(r.json())[:200])

        # Robustness: segment matching is forgiving of case and stray whitespace.
        # A donor whose GPS reports "  kazipara " must still match a request on
        # "Kazipara" — otherwise the whole feature silently fails to fire.
        await c.put(f"/api/donors/{did}/location", json={
            "lat": 23.7285, "lng": 90.3995, "road_segment": "  kazipara ",
        })
        d = (await c.post("/api/dispatch/evaluate",
                          json={"request_id": req_id, "now": "10:00"})).json()
        mine = [x for x in d["results"] if x["donor_id"] == did]
        check("Segment matching ignores case and whitespace (kazipara == Kazipara)",
              bool(mine) and mine[0]["decision"] == "ROUTE_MATCH", str(mine)[:300])
        await c.put(f"/api/donors/{did}/location", json={
            "lat": 23.7285, "lng": 90.3995, "road_segment": "Kazipara",
        })

        # Robustness: a malformed sleep-window time is refused at the boundary,
        # not swallowed into the sleep-window maths where it would 500 dispatch.
        bad_time = await c.put(f"/api/donors/{did}/sleep-mode", json={
            "enabled": True, "start": "7am", "end": "07:00",
        })
        check("A malformed sleep-window time is rejected with 422, not a 500",
              bad_time.status_code == 422, f"got {bad_time.status_code}")

        # An all-blank commute route is a client error, not a silently inert one.
        blank = await c.put(f"/api/donors/{did}/commute-route",
                            json={"segments": ["", "   "]})
        check("An all-blank commute route is refused (422)",
              blank.status_code == 422, f"got {blank.status_code}")

        # Per-donor ping preview: a side-effect-free dry run of the rules. A
        # life-threatening request at 2 a.m. with the emergency box ticked WOULD
        # wake this donor — surfaced before any real emergency tests it.
        await c.put(f"/api/donors/{did}/sleep-mode", json={
            "enabled": True, "start": "23:00", "end": "07:00",
            "allow_extreme_emergencies": True, "dnd_on": True,
        })
        await c.patch(f"/api/admin/requests/{req_id}",
                      json={"severity": "LIFE_THREATENING"}, headers=ah)
        logs_before = len((await c.get(f"/api/ping-logs?request_id={req_id}")).json())
        prev = (await c.post(f"/api/donors/{did}/ping-preview",
                             json={"request_id": req_id, "now": "02:00"})).json()
        check("Ping preview shows a 2 a.m. life-threatening request WOULD wake the donor",
              prev["would_ping"] and prev["decision"] == "EMERGENCY_BREAKTHROUGH"
              and prev["fcm_bypass_dnd"], str(prev)[:300])
        logs_after = len((await c.get(f"/api/ping-logs?request_id={req_id}")).json())
        check("Ping preview writes no PingLog and dispatches to no one (dry run)",
              logs_after == logs_before, f"{logs_before} -> {logs_after}")
        await c.put(f"/api/donors/{did}/sleep-mode", json={
            "enabled": False, "start": "23:00", "end": "07:00",
            "allow_extreme_emergencies": True, "dnd_on": False,
        })

        # Going offline clears the fix, so the proactive route ping stops firing.
        await c.delete(f"/api/donors/{did}/location")
        d = (await c.post("/api/dispatch/evaluate",
                          json={"request_id": req_id, "now": "10:00"})).json()
        mine = [x for x in d["results"] if x["donor_id"] == did]
        check("Clearing the live fix stops the route ping (no stale position)",
              bool(mine) and mine[0]["decision"] != "ROUTE_MATCH", str(mine)[:300])
        await c.put(f"/api/donors/{did}/location", json={
            "lat": 23.7285, "lng": 90.3995, "road_segment": "Kazipara",
        })

        # ── Module 1.3 — Rare-blood override ────────────────────────
        section("M1F3 — Rare-Blood City-Wide Override")

        rare = (await c.post("/api/requests", json={
            "patient_name": "Rare Test", "hospital": "Square Hospital",
            "blood_type": "O-", "severity": "LIFE_THREATENING",
            "hospital_lat": 23.7529, "hospital_lng": 90.3789,
        })).json()
        await c.post(f"/api/admin/requests/{rare['id']}/slip",
                     json={"action": "VERIFY"}, headers=ah)
        d = (await c.post("/api/dispatch/evaluate", json={"request_id": rare["id"]})).json()
        check("A rare negative type triggers the city-wide override",
              d["rare_blood_override"] and d["dispatch_mode"] == "CITYWIDE_RARE", str(d)[:200])
        check("The city-wide override applies no radius at all",
              d["radius_km"] is None and not d.get("out_of_range"), str(d["radius_km"]))

        common = (await c.post("/api/requests", json={
            "patient_name": "Common Test", "hospital": "Dhaka Medical College",
            "blood_type": "O+", "severity": "CRITICAL",
            "hospital_lat": 23.7261, "hospital_lng": 90.3969,
        })).json()
        await c.post(f"/api/admin/requests/{common['id']}/slip",
                     json={"action": "VERIFY"}, headers=ah)
        d = (await c.post("/api/dispatch/evaluate", json={"request_id": common["id"]})).json()
        check("A common type uses the 3 km expanding ripple instead",
              d["dispatch_mode"] == "RIPPLE" and d["radius_km"] == 3.0, str(d["radius_km"]))

        # Triage, the city-wide radar feed, and the privacy rule on it.
        radar = (await c.get(f"/api/requests/{rare['id']}/radar")).json()
        check("Triage routes a rare type to the city-wide service",
              radar["dispatch_mode"] == "CITYWIDE_RARE" and radar["rare_blood_override"],
              str(radar)[:200])
        check("The radar reports zone aggregates, never positions",
              all(set(z) == {"zone", "eligible", "excluded"} for z in radar["zones"]),
              str(radar["zones"])[:200])
        check("The radar carries the ripple comparison as counts only",
              len(radar["ripple_preview"]) == 3
              and all(isinstance(s["count"], int) for s in radar["ripple_preview"]),
              str(radar["ripple_preview"]))

        public = (await c.get("/api/donors")).json()
        leaked = [k for k in ("phone", "current_location", "fcm_token") if any(k in d for d in public)]
        check("The public donor roster exposes no phone number or coordinates",
              not leaked, f"leaked: {leaked}")
        check("...but still carries a generalised zone", all("zone" in d for d in public))

        # A live WebSocket sees the broadcast as it happens.
        events = []
        async with websockets.connect(
            f"{BASE.replace('http', 'ws')}/ws/dispatch?request_id={rare['id']}"
        ) as ws:
            hello = json.loads(await ws.recv())
            check("The radar socket accepts a subscriber",
                  hello["event"] == "connected" and len(hello["zones"]) > 0, str(hello)[:200])

            async def drain():
                with suppress(Exception):
                    while True:
                        events.append(json.loads(await asyncio.wait_for(ws.recv(), timeout=8)))

            task = asyncio.create_task(drain())
            await asyncio.sleep(0.3)
            d = (await c.post("/api/dispatch/evaluate", json={"request_id": rare["id"]})).json()
            await asyncio.sleep(1.2)
            task.cancel()

        kinds = [e["event"] for e in events]
        check("Every donor reached is streamed to the radar as it happens",
              kinds.count("donor_pinged") == d["pinged"] and "broadcast_started" in kinds
              and "broadcast_complete" in kinds, str(kinds))
        blob = json.dumps(events)
        identities = [x["donor_name"] for x in d["results"] if x["donor_name"] in blob]
        identities += [x["donor_id"] for x in d["results"] if x["donor_id"] in blob]
        check("CC-privacy: the feed leaks no donor identity or coordinate",
              not identities and '"lat"' not in blob and '"lng"' not in blob,
              f"leaked: {identities}")

        r = await c.post(f"/api/requests/{rare['id']}/escalate")
        check("CC: a dead-end rare request escalates to blood banks and NGO hotlines",
              r.status_code == 201 and len(r.json()["channels"]) == 2, r.text[:300])

        # ── Module 2.2 — Concurrency & bans ─────────────────────────
        section("M2F2 — Concurrency Lock, Ban Enforcement & Shadow Ban")

        d2 = await register(c, phone_for(stamp, 7), name="Racer Two", role="donor",
                            blood_type="O+", health={"weight_kg": 65})
        did2 = d2["account"]["id"]

        first, second = await asyncio.gather(
            c.post(f"/api/requests/{common['id']}/accept", json={"donor_id": did}),
            c.post(f"/api/requests/{common['id']}/accept", json={"donor_id": did2}),
        )
        codes = sorted([first.status_code, second.status_code])
        check("Exactly one of two simultaneous accepts wins", codes == [200, 409],
              f"got {codes}")

        # Ban enforcement.
        await c.post(f"/api/admin/donors/{did2}/moderate",
                     json={"action": "BAN", "reason": "Smoke test"}, headers=ah)
        banned_req = (await c.post("/api/requests", json={
            "patient_name": "Ban Test", "hospital": "Dhaka Medical College",
            "blood_type": "O+", "severity": "CRITICAL",
        })).json()
        await c.post(f"/api/admin/requests/{banned_req['id']}/slip",
                     json={"action": "VERIFY"}, headers=ah)
        d = (await c.post("/api/dispatch/evaluate",
                          json={"request_id": banned_req["id"]})).json()
        check("A banned donor is excluded from the ping pool",
              did2 not in [x["donor_id"] for x in d["results"]],
              str([x["donor_name"] for x in d["results"]]))
        r = await c.post(f"/api/requests/{banned_req['id']}/accept", json={"donor_id": did2})
        check("A banned donor cannot lock a request", r.status_code == 403,
              f"got {r.status_code}")

        # Shadow ban — the corner case that was previously inert.
        sb = await register(c, phone_for(stamp, 6), name="Shadow User", role="patient",
                            blood_type="O+")
        sb_id, sb_token = sb["account"]["id"], sb["access_token"]
        await c.post(f"/api/admin/donors/{sb_id}/moderate",
                     json={"action": "SHADOW_BAN", "reason": "Fake requests"}, headers=ah)
        shadow_req = (await c.post("/api/requests", json={
            "patient_name": "Shadow Test", "hospital": "Ibn Sina Hospital",
            "blood_type": "O+", "severity": "CRITICAL",
        }, headers={"Authorization": f"Bearer {sb_token}"})).json()
        await c.post(f"/api/admin/requests/{shadow_req['id']}/slip",
                     json={"action": "VERIFY"}, headers=ah)

        own_view = (await c.get(f"/api/requests/{shadow_req['id']}")).json()
        check("Shadow-banned user's request still reads OPEN on their own screen",
              own_view["status"] == "OPEN", own_view["status"])
        d = (await c.post("/api/dispatch/evaluate",
                          json={"request_id": shadow_req["id"]})).json()
        check("CC: but it is never broadcast to a single donor",
              d["pinged"] == 0 and d["broadcast"] is False and not d["results"],
              str(d)[:300])

        # Retro-mute of already-open requests.
        r = await c.post(f"/api/admin/donors/{sb_id}/moderate",
                         json={"action": "REINSTATE"}, headers=ah)
        check("Moderation propagates to the account's open requests",
              r.json()["requests_affected"] >= 1, str(r.json()))

    section("SUMMARY")
    print(f"  {len(PASSED)} passed, {len(FAILED)} failed")
    for label, detail in FAILED:
        print(f"    FAILED: {label}\n            {detail}")
    return 1 if FAILED else 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except httpx.ConnectError:
        print("Cannot reach the API — start it first:  python -m app.main")
        sys.exit(2)
