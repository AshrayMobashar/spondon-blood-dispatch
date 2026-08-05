"""End-to-end smoke test — exercises every endpoint against the running server
on port 1184, including both feature corner cases. Run: python smoke_test.py"""
import asyncio
import json

import httpx

BASE = "http://localhost:1184"


def show(title, r):
    try:
        body = r.json()
    except Exception:
        body = r.text
    print(f"\n### {title}\n{r.request.method} {r.request.url}  ->  {r.status_code}")
    print(json.dumps(body, indent=2, default=str))
    return body


async def main():
    async with httpx.AsyncClient(base_url=BASE, timeout=15) as c:
        print("=" * 70, "\nFEATURE 1 — SMART PING\n", "=" * 70)

        # Two O+ donors
        rafiul = show("Create donor Rafiul", await c.post("/api/donors",
            json={"name": "Rafiul Islam", "blood_type": "O+", "fcm_token": "fcm_rafiul"}))
        nadia = show("Create donor Nadia", await c.post("/api/donors",
            json={"name": "Nadia Akter", "blood_type": "O+", "fcm_token": "fcm_nadia"}))
        rid, nid = rafiul["id"], nadia["id"]

        # Rafiul: sleep mode ON, wake-for-emergencies ON, phone DND ON
        show("Rafiul sleep-mode (emergency override + DND on)",
            await c.put(f"/api/donors/{rid}/sleep-mode",
                json={"enabled": True, "start": "23:00", "end": "07:00",
                      "allow_extreme_emergencies": True, "dnd_on": True}))
        show("Get Rafiul sleep-mode", await c.get(f"/api/donors/{rid}/sleep-mode"))

        # Nadia: sleep mode ON, but NO emergency override
        show("Nadia sleep-mode (no override)",
            await c.put(f"/api/donors/{nid}/sleep-mode",
                json={"enabled": True, "start": "23:00", "end": "07:00",
                      "allow_extreme_emergencies": False, "dnd_on": False}))

        # Commute route + live GPS for Nadia (used later while awake)
        show("Nadia save commute route",
            await c.put(f"/api/donors/{nid}/commute-route",
                json={"segments": ["Mirpur-Rd", "Kazipara", "Shewrapara"], "label": "Home to Office"}))
        show("Nadia live location on Kazipara",
            await c.put(f"/api/donors/{nid}/location",
                json={"lat": 23.8069, "lng": 90.3687, "road_segment": "Kazipara"}))

        # A LIFE_THREATENING request on Kazipara
        req = show("Create LIFE_THREATENING request on Kazipara",
            await c.post("/api/requests",
                json={"patient_name": "Mehedi Hassan", "hospital": "Dhaka Medical College",
                      "blood_type": "O+", "severity": "LIFE_THREATENING", "road_segment": "Kazipara"}))
        req_id = req["id"]

        # CORNER CASE A: evaluate at 23:30 (inside sleep window)
        show("Evaluate dispatch @ 23:30  (breakthrough + DND bypass vs skip)",
            await c.post("/api/dispatch/evaluate", json={"request_id": req_id, "now": "23:30"}))

        # Evaluate again at 14:00 (awake) to show ROUTE_MATCH for Nadia
        show("Evaluate dispatch @ 14:00  (route match while on segment)",
            await c.post("/api/dispatch/evaluate", json={"request_id": req_id, "now": "14:00"}))

        # CORNER CASE A2: Nadia leaves the segment -> route ping suppressed
        show("Nadia moves to Shewrapara",
            await c.put(f"/api/donors/{nid}/location",
                json={"lat": 23.81, "lng": 90.37, "road_segment": "Shewrapara"}))
        show("Evaluate @ 14:05 (Nadia off the Kazipara segment -> SKIPPED_OFF_ROUTE)",
            await c.post("/api/dispatch/evaluate", json={"request_id": req_id, "now": "14:05"}))

        show("Ping-log audit for this request",
            await c.get(f"/api/ping-logs", params={"request_id": req_id}))

        print("\n" + "=" * 70, "\nFEATURE 2 — CONCURRENCY & ACCOUNTABILITY\n", "=" * 70)

        # Fresh request to accept
        req2 = show("Create request to be accepted",
            await c.post("/api/requests",
                json={"patient_name": "Karim Uddin", "hospital": "Square Hospital",
                      "blood_type": "O+", "severity": "CRITICAL", "road_segment": "Panthapath"}))
        req2_id = req2["id"]

        # CORNER CASE B: two donors accept simultaneously
        r1, r2 = await asyncio.gather(
            c.post(f"/api/requests/{req2_id}/accept", json={"donor_id": rid}),
            c.post(f"/api/requests/{req2_id}/accept", json={"donor_id": nid}),
        )
        show("Simultaneous accept #1", r1)
        show("Simultaneous accept #2", r2)
        winners = [x for x in (r1, r2) if x.status_code == 200]
        losers = [x for x in (r1, r2) if x.status_code == 409]
        print(f"\n>>> RACE RESULT: {len(winners)} winner, {len(losers)} polite rejection "
              f"(expected 1 and 1) — {'PASS' if len(winners)==1 and len(losers)==1 else 'FAIL'}")

        winner_id = rid if r1.status_code == 200 else nid
        show("Request status after lock (Donor Secured)",
            await c.get(f"/api/requests/{req2_id}"))

        # No-show accountability: make the winner no-show twice within a year
        show("Winner NO-SHOW #1",
            await c.post(f"/api/requests/{req2_id}/arrival",
                json={"donor_id": winner_id, "showed_up": False}))

        req3 = await c.post("/api/requests", json={"patient_name": "Sadia", "hospital": "Labaid",
                      "blood_type": "O+", "severity": "CRITICAL", "road_segment": "Dhanmondi"})
        req3_id = req3.json()["id"]
        await c.post(f"/api/requests/{req3_id}/accept", json={"donor_id": winner_id})
        show("Winner NO-SHOW #2  (2nd in a year -> removed from pool)",
            await c.post(f"/api/requests/{req3_id}/arrival",
                json={"donor_id": winner_id, "showed_up": False}))
        show("Winner reliability after 2 no-shows",
            await c.get(f"/api/donors/{winner_id}/reliability"))

        # Appeal the 2nd no-show (genuine accident) and admin clears it
        appeal = show("File appeal (road accident)",
            await c.post("/api/appeals",
                json={"donor_id": winner_id, "request_id": req3_id,
                      "reason": "Road accident on the way — hospital records attached."}))
        show("Admin CLEARS appeal -> donor restored to pool",
            await c.post(f"/api/appeals/{appeal['id']}/resolve",
                json={"action": "CLEAR", "admin": "admin.sadia"}))
        show("Winner reliability after appeal cleared",
            await c.get(f"/api/donors/{winner_id}/reliability"))

        print("\nSMOKE TEST COMPLETE.")


if __name__ == "__main__":
    asyncio.run(main())
