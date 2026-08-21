# Spondon — REST API Documentation

**Student ID:** 23101184 &nbsp;•&nbsp; **Server port:** `1184` (last four digits of the ID)
**Stack:** Python · FastAPI · Beanie (async MongoDB ODM) · MongoDB
**Base URL:** `http://localhost:1184`

Two features are implemented, each with its own router:

1. **Feature 1 — Smart Ping: Sleep Mode & Commute-Aware Matching**
2. **Feature 2 — Concurrency Lock & Flake-Out Accountability**

All request/response bodies are JSON. IDs are MongoDB ObjectIds returned as the `id`
field. Interactive Swagger docs are auto-generated at `http://localhost:1184/docs`.

---

## How to run

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # Windows
pip install -r requirements.txt
python -m app.main                # serves on http://localhost:1184
```

MongoDB must be running on `mongodb://localhost:27017` (configurable in `.env`).

---

# FEATURE 1 — Smart Ping: Sleep Mode & Commute-Aware Matching

Donors control two independent settings that decide when/why they are pinged: a **Sleep
Mode** window (with an optional life-threatening-emergency override) and a saved
**commute route** (a request is only route-pinged while the donor's live GPS is actually
on the matching road segment).

---

## 1.1 Register a donor

| | |
|---|---|
| **URL** | `POST http://localhost:1184/api/donors` |
| **Headers** | `Content-Type: application/json` |

**Body**
```json
{ "name": "Rafiul Islam", "blood_type": "O+", "fcm_token": "fcm_rafiul_9f21" }
```

**Code snippet**
```python
@router.post("/donors", status_code=201)
async def create_donor(body: DonorCreate):
    donor = Donor(name=body.name, blood_type=body.blood_type, fcm_token=body.fcm_token)
    await donor.insert()
    return serialize(donor)
```

**Sample response `201`**
```json
{
  "id": "6a59ca06f7d34e35aee72f9e",
  "name": "Rafiul Islam", "blood_type": "O+", "fcm_token": "fcm_rafiul_9f21",
  "sleep_mode": { "enabled": false, "start": "23:00", "end": "07:00",
                  "allow_extreme_emergencies": false, "dnd_on": false },
  "commute_route": null, "current_location": null,
  "reliability": { "no_show_count": 0, "no_show_dates": [], "in_priority_pool": true, "removed_at": null }
}
```

---

## 1.2 List donors

| | |
|---|---|
| **URL** | `GET http://localhost:1184/api/donors` |
| **Headers** | *(none)* |
| **Params** | *(none)* |

```python
@router.get("/donors")
async def list_donors():
    donors = await Donor.find_all().to_list()
    return [serialize(d) for d in donors]
```

---

## 1.3 Get one donor

| | |
|---|---|
| **URL** | `GET http://localhost:1184/api/donors/{donor_id}` |
| **Headers** | *(none)* |
| **Params** | Path: `donor_id` — the donor's ObjectId, e.g. `6a59ca06f7d34e35aee72f9e` |

```python
@router.get("/donors/{donor_id}")
async def get_donor(donor_id: str):
    return serialize(await _get_donor(donor_id))
```

---

## 1.4 Get sleep-mode settings

| | |
|---|---|
| **URL** | `GET http://localhost:1184/api/donors/{donor_id}/sleep-mode` |
| **Headers** | *(none)* |
| **Params** | Path: `donor_id` — the donor's ObjectId |

```python
@router.get("/donors/{donor_id}/sleep-mode")
async def get_sleep_mode(donor_id: str):
    donor = await _get_donor(donor_id)
    return {"donor_id": str(donor.id), "sleep_mode": donor.sleep_mode.model_dump()}
```

---

## 1.5 Update sleep-mode settings

| | |
|---|---|
| **URL** | `PUT http://localhost:1184/api/donors/{donor_id}/sleep-mode` |
| **Headers** | `Content-Type: application/json` |

**Body** — `allow_extreme_emergencies` is the "wake me for emergencies" box; `dnd_on`
reflects the phone's OS Do-Not-Disturb state.
```json
{ "enabled": true, "start": "23:00", "end": "07:00",
  "allow_extreme_emergencies": true, "dnd_on": true }
```

```python
@router.put("/donors/{donor_id}/sleep-mode")
async def update_sleep_mode(donor_id: str, body: SleepModeUpdate):
    donor = await _get_donor(donor_id)
    donor.sleep_mode.enabled = body.enabled
    donor.sleep_mode.start = body.start
    donor.sleep_mode.end = body.end
    donor.sleep_mode.allow_extreme_emergencies = body.allow_extreme_emergencies
    donor.sleep_mode.dnd_on = body.dnd_on
    await donor.save()
    return {"donor_id": str(donor.id), "message": "Sleep Mode updated",
            "sleep_mode": donor.sleep_mode.model_dump()}
```

---

## 1.6 Save / replace commute route

| | |
|---|---|
| **URL** | `PUT http://localhost:1184/api/donors/{donor_id}/commute-route` |
| **Headers** | `Content-Type: application/json` |

**Body**
```json
{ "segments": ["Mirpur-Rd", "Kazipara", "Shewrapara"], "label": "Home to Office", "enabled": true }
```

`points` is optional: when the donor draws their route on the Leaflet map the
client also sends `[{ "lat": 23.806, "lng": 90.368, "name": "Kazipara" }, …]` so
the line can be redrawn later. The **names** are still the only thing the engine
matches on — `points` are display coordinates, nothing more.

```python
@router.put("/donors/{donor_id}/commute-route")
async def save_route(donor_id: str, body: RouteUpdate):
    donor = await _get_donor(donor_id)
    donor.commute_route = CommuteRoute(
        segments=body.segments, label=body.label, enabled=body.enabled
    )
    await donor.save()
    return {"donor_id": str(donor.id), "message": "Commute route saved",
            "commute_route": donor.commute_route.model_dump(mode="json")}
```

Segment names are trimmed and de-duplicated on save (casing preserved for display),
and an all-blank list is rejected `422`. Matching against a request's road segment is
**case- and whitespace-insensitive**, so `"mirpur road"` still matches `"Mirpur Road"`.

---

## 1.6a Get commute route

Read the saved route back on its own — symmetry with 1.4 (get sleep-mode).

| | |
|---|---|
| **URL** | `GET http://localhost:1184/api/donors/{donor_id}/commute-route` |
| **Params** | Path: `donor_id` |

```python
@router.get("/donors/{donor_id}/commute-route")
async def get_route(donor_id: str):
    donor = await _get_donor(donor_id)
    return {"donor_id": str(donor.id),
            "commute_route": donor.commute_route.model_dump(mode="json") if donor.commute_route else None}
```

---

## 1.6b Pause / resume route matching

Turning commute matching off must not discard the route — a donor who pauses it
resumes without retyping their commute. Use 1.7 to actually delete it.

| | |
|---|---|
| **URL** | `POST http://localhost:1184/api/donors/{donor_id}/commute-route/toggle?enabled=false` |
| **Params** | Query: `enabled` (bool). Path: `donor_id` |

```python
@router.post("/donors/{donor_id}/commute-route/toggle")
async def toggle_route(donor_id: str, enabled: bool = True):
    donor = await _get_donor(donor_id)
    if donor.commute_route is None:
        raise HTTPException(status_code=400, detail="No commute route saved yet …")
    donor.commute_route.enabled = enabled
    await donor.save()
    return {"donor_id": str(donor.id),
            "message": f"Route-aware matching {'resumed' if enabled else 'paused'}",
            "commute_route": donor.commute_route.model_dump(mode="json")}
```

---

## 1.7 Clear commute route

| | |
|---|---|
| **URL** | `DELETE http://localhost:1184/api/donors/{donor_id}/commute-route` |
| **Headers** | *(none)* |
| **Params** | Path: `donor_id` — the donor's ObjectId |

```python
@router.delete("/donors/{donor_id}/commute-route")
async def delete_route(donor_id: str):
    donor = await _get_donor(donor_id)
    donor.commute_route = None
    await donor.save()
    return {"donor_id": str(donor.id), "message": "Commute route cleared"}
```

---

## 1.8 Update live GPS location

| | |
|---|---|
| **URL** | `PUT http://localhost:1184/api/donors/{donor_id}/location` |
| **Headers** | `Content-Type: application/json` |

**Body**
```json
{ "lat": 23.8069, "lng": 90.3687, "road_segment": "Kazipara" }
```

```python
@router.put("/donors/{donor_id}/location")
async def update_location(donor_id: str, body: LocationUpdate):
    donor = await _get_donor(donor_id)
    donor.current_location = GeoPoint(lat=body.lat, lng=body.lng, road_segment=body.road_segment)
    await donor.save()
    return {"donor_id": str(donor.id), "message": "Location updated",
            "current_location": donor.current_location.model_dump(mode="json")}
```

---

## 1.8b Clear live GPS location (go offline)

Drop the last known fix — the donor revoked location or the app backgrounded. With no
fresh position the proactive route ping correctly stops firing (the "never for a location
they have left" corner case, reached deliberately).

| | |
|---|---|
| **URL** | `DELETE http://localhost:1184/api/donors/{donor_id}/location` |
| **Params** | Path: `donor_id` |

```python
@router.delete("/donors/{donor_id}/location")
async def clear_location(donor_id: str):
    donor = await _get_donor(donor_id)
    donor.current_location = None
    await donor.save()
    return {"donor_id": str(donor.id), "message": "Live location cleared"}
```

---

## 1.8c Nearby pings (commute map data)  ⭐ map

Everything the donor's Leaflet map renders in one call: their saved route, their
live fix, and every **OPEN, broadcasting** request that carries a hospital
location — each tagged with the flags the map colours by.

| | |
|---|---|
| **URL** | `GET http://localhost:1184/api/donors/{donor_id}/nearby-pings` |
| **Params** | Path: `donor_id` |

**Response (shape)**
```json
{
  "donor_id": "…", "blood_type": "B+",
  "current_location": { "lat": 23.806, "lng": 90.368, "road_segment": "Kazipara" },
  "commute_route": { "segments": ["Kazipara"], "points": [{ "lat": 23.806, "lng": 90.368, "name": "Kazipara" }], "enabled": true },
  "pings": [
    {
      "request_id": "…", "hospital": "Dhaka Medical College", "blood_type": "B+",
      "severity": "LIFE_THREATENING", "road_segment": "Kazipara",
      "lat": 23.7261, "lng": 90.3969,
      "blood_type_match": true, "on_saved_route": true, "on_route_now": true,
      "distance_km": 9.36
    }
  ]
}
```

`on_route_now` (live GPS on a saved segment right now) is the zero-extra-travel
case the map paints red; `on_saved_route` is indigo; a plain blood-type match is
the donor's own type colour. A shadow-muted request (`broadcast=false`) never
appears here — the same gate that keeps it out of dispatch keeps it off the map.

---

## 1.9 Evaluate dispatch  ⭐ core engine

Decides, for every blood-type-matching donor, whether to ping — applying the Sleep Mode
gate, the life-threatening emergency breakthrough (with **FCM bypass-DND** flag), and the
commute-route + live-GPS gate. Pass `now` (`HH:MM`) to test the sleep window
deterministically.

| | |
|---|---|
| **URL** | `POST http://localhost:1184/api/dispatch/evaluate` |
| **Headers** | `Content-Type: application/json` |

**Body**
```json
{ "request_id": "6a59ca06f7d34e35aee72fa0", "now": "23:30" }
```

**Code snippet**
```python
@router.post("/dispatch/evaluate")
async def evaluate_dispatch(body: EvaluateBody):
    req = await BloodRequest.get(to_oid(body.request_id))
    if not req:
        raise HTTPException(404, "Blood request not found")
    now_hhmm = body.now or datetime.now(timezone.utc).strftime("%H:%M")
    candidates = await Donor.find(Donor.blood_type == req.blood_type).to_list()
    results, pinged = [], 0
    for donor in candidates:
        d = decide_ping(donor, req, now_hhmm)          # rule engine (services.py)
        await PingLog(request_id=str(req.id), donor_id=str(donor.id),
                      donor_name=donor.name, **d).insert()
        pinged += 1 if d["pinged"] else 0
        results.append({"donor_id": str(donor.id), "donor_name": donor.name, **d})
    return {"request_id": str(req.id), "evaluated_at": now_hhmm, "candidates": len(candidates),
            "pinged": pinged, "skipped": len(candidates) - pinged, "results": results}
```

**The rule engine** (`decide_ping` in `services.py`) — Corner cases live here:
```python
def decide_ping(donor, req, now_hhmm):
    sm = donor.sleep_mode
    emergency = req.severity == "LIFE_THREATENING"
    sleeping = sm.enabled and in_sleep_window(now_hhmm, sm.start, sm.end)
    if sleeping:
        if emergency and sm.allow_extreme_emergencies:
            bypass = sm.dnd_on          # phone DND on -> flag FCM to pierce silent mode
            return {"decision": "EMERGENCY_BREAKTHROUGH", "pinged": True,
                    "fcm_priority": "high", "fcm_bypass_dnd": bypass, "reason": ...}
        return {"decision": "SKIPPED_SLEEP", "pinged": False, ...}
    # The commute route is an UPGRADE, never a filter: on the segment now -> a
    # high-priority proactive ping; off it (or a stale fix) -> simply fall
    # through to the standard ping. A saved route never makes a donor LESS
    # reachable than saving none.
    if route_is_saved_for(donor, req) and on_route_now(donor, req):
        return {"decision": "ROUTE_MATCH", "pinged": True, "fcm_priority": "high", ...}
    return {"decision": "PINGED", "pinged": True, ...}
```

**Sample response `200`** (evaluated at 23:30 — inside the sleep window)
```json
{
  "request_id": "6a59ca06f7d34e35aee72fa0", "evaluated_at": "23:30",
  "severity": "LIFE_THREATENING", "road_segment": "Kazipara",
  "candidates": 2, "pinged": 1, "skipped": 1,
  "results": [
    { "donor_name": "Rafiul Islam", "decision": "EMERGENCY_BREAKTHROUGH",
      "pinged": true, "fcm_priority": "high", "fcm_bypass_dnd": true,
      "reason": "Life-threatening request broke through Sleep Mode ... Phone DND is ON -> high-priority FCM flagged to bypass silent mode." },
    { "donor_name": "Nadia Akter", "decision": "SKIPPED_SLEEP", "pinged": false,
      "reason": "Donor is inside their Sleep Mode window and this is not an eligible emergency breakthrough." }
  ]
}
```

---

## 1.9b Ping preview (per-donor dry run)

Answers **"would THIS donor be pinged for this request right now, and why?"** — walking the
same four stages as 1.9 (gate → pool → reach → decision) for one donor, with **no side
effects**: no PingLog written, no push sent, nobody dispatched. This is what a donor's
settings screen calls to show the concrete effect of their own Sleep-Mode / commute
choices before a real emergency ever tests them.

| | |
|---|---|
| **URL** | `POST http://localhost:1184/api/donors/{donor_id}/ping-preview` |
| **Headers** | `Content-Type: application/json` |

**Body** — `now` (`HH:MM`, optional) previews the sleep window deterministically.
```json
{ "request_id": "6a59ca06f7d34e35aee72fa0", "now": "02:00" }
```

```python
@router.post("/donors/{donor_id}/ping-preview")
async def ping_preview(donor_id: str, body: PingPreview):
    donor = await _get_donor(donor_id)
    req = await BloodRequest.get(to_oid(body.request_id))
    if not req:
        raise HTTPException(404, "Blood request not found")
    return evaluate_donor(donor, req, now_hhmm=body.now)   # dispatch.py — no writes
```

**Sample response `200`** (life-threatening request at 02:00, emergency box + phone DND on)
```json
{
  "request_id": "6a59ca06f7d34e35aee72fa0", "donor_id": "…", "donor_name": "Rafiul Islam",
  "evaluated_at": "02:00", "dispatch_mode": "RIPPLE", "radius_km": 3.0,
  "stage": "DECISION", "would_ping": true, "decision": "EMERGENCY_BREAKTHROUGH",
  "distance_km": 0.32, "on_route": false, "fcm_priority": "high", "fcm_bypass_dnd": true,
  "reason": "Life-threatening request broke through Sleep Mode … Phone DND is ON -> high-priority FCM flagged to bypass silent mode."
}
```

`stage` names where a non-ping stopped: `GATE` (request withheld), `POOL` (not
dispatchable — wrong type / banned / ineligible), `REACH` (`OUT_OF_RANGE`), or `DECISION`
(Sleep-Mode / route outcome).

---

## 1.10 Ping-log audit

| | |
|---|---|
| **URL** | `GET http://localhost:1184/api/ping-logs?request_id={request_id}` |
| **Headers** | *(none)* |
| **Params** | Query: `request_id` *(optional)* — filter the audit log to one request; omit it to return every ping decision |

```python
@router.get("/ping-logs")
async def ping_logs(request_id: str | None = None):
    query = PingLog.find(PingLog.request_id == request_id) if request_id else PingLog.find_all()
    logs = await query.sort(-PingLog.created_at).to_list()
    return [serialize(l) for l in logs]
```

---

# FEATURE 2 — Concurrency Lock & Flake-Out Accountability

The first donor to Accept atomically locks the request; all others see **"Donor Secured"**.
No-shows are tracked — two within a single year quietly remove a donor from the priority
pool. Genuine no-shows can be appealed and cleared by an admin.

---

## 2.1 Create a blood request

| | |
|---|---|
| **URL** | `POST http://localhost:1184/api/requests` |
| **Headers** | `Content-Type: application/json` |

**Body**
```json
{ "patient_name": "Karim Uddin", "hospital": "Square Hospital",
  "blood_type": "O+", "severity": "CRITICAL", "road_segment": "Panthapath" }
```

```python
@router.post("/requests", status_code=201)
async def create_request(body: RequestCreate):
    req = BloodRequest(patient_name=body.patient_name, hospital=body.hospital,
                       blood_type=body.blood_type, severity=body.severity,
                       road_segment=body.road_segment)
    await req.insert()
    return serialize(req)
```

---

## 2.2 List requests

| | |
|---|---|
| **URL** | `GET http://localhost:1184/api/requests` |
| **Headers** | *(none)* |
| **Params** | *(none)* |

```python
@router.get("/requests")
async def list_requests():
    reqs = await BloodRequest.find_all().sort(-BloodRequest.created_at).to_list()
    return [serialize(r) for r in reqs]
```

---

## 2.3 Get request status

| | |
|---|---|
| **URL** | `GET http://localhost:1184/api/requests/{request_id}` |
| **Headers** | *(none)* |
| **Params** | Path: `request_id` — the blood request's ObjectId |

```python
@router.get("/requests/{request_id}")
async def get_request(request_id: str):
    req = await _get_request(request_id)
    out = serialize(req)
    out["donor_secured"] = req.status != "OPEN"
    return out
```

---

## 2.4 Accept a request — atomic first-wins lock  ⭐ corner case

A single conditional `find_one_and_update` flips the request `OPEN → LOCKED`. MongoDB
serialises writes to a document, so out of any number of simultaneous accepts **exactly
one succeeds**; every runner-up sees the document already `LOCKED` and receives a polite
**`409 Donor Secured`** — never a broken confirmation.

| | |
|---|---|
| **URL** | `POST http://localhost:1184/api/requests/{request_id}/accept` |
| **Headers** | `Content-Type: application/json` |

**Body**
```json
{ "donor_id": "6a59ca06f7d34e35aee72f9e" }
```

**Code snippet**
```python
@router.post("/requests/{request_id}/accept")
async def accept_request(request_id: str, body: AcceptBody):
    oid = to_oid(request_id)
    donor = await _get_donor(body.donor_id)
    collection = get_collection(BloodRequest)
    updated = await collection.find_one_and_update(
        {"_id": oid, "status": "OPEN"},                      # compare
        {"$set": {"status": "LOCKED", "secured_donor_id": str(donor.id),
                  "secured_donor_name": donor.name, "secured_at": utcnow()}},  # ...swap, atomically
        return_document=ReturnDocument.AFTER,
    )
    if updated is None:                                       # already locked -> runner-up
        current = await BloodRequest.get(oid)
        if not current:
            raise HTTPException(404, "Blood request not found")
        raise HTTPException(409, detail={"message": "Donor Secured",
            "secured_donor_id": current.secured_donor_id,
            "secured_donor_name": current.secured_donor_name})
    return {"message": "You've secured this request", "status": "LOCKED",
            "secured_donor_id": updated["secured_donor_id"],
            "secured_donor_name": updated["secured_donor_name"]}
```

**Winner `200`**
```json
{ "message": "You've secured this request", "request_id": "6a59ca06f7d34e35aee72fa7",
  "status": "LOCKED", "secured_donor_id": "6a59ca06f7d34e35aee72f9e",
  "secured_donor_name": "Rafiul Islam" }
```

**Runner-up `409`**
```json
{ "detail": { "message": "Donor Secured",
    "note": "Another donor accepted first — this request is already locked.",
    "secured_donor_id": "6a59ca06f7d34e35aee72f9e", "secured_donor_name": "Rafiul Islam" } }
```

---

## 2.5 Record arrival / no-show  ⭐ 2-in-a-year rule

| | |
|---|---|
| **URL** | `POST http://localhost:1184/api/requests/{request_id}/arrival` |
| **Headers** | `Content-Type: application/json` |

**Body** — `showed_up:false` records a no-show; the **2nd within 365 days** drops the
donor from the priority pool.
```json
{ "donor_id": "6a59ca06f7d34e35aee72f9e", "showed_up": false }
```

```python
@router.post("/requests/{request_id}/arrival")
async def record_arrival(request_id: str, body: ArrivalBody):
    req = await _get_request(request_id)
    if req.secured_donor_id != body.donor_id:
        raise HTTPException(400, "This donor did not secure the request")
    donor = await _get_donor(body.donor_id)
    if body.showed_up:
        req.status = "FULFILLED"; await req.save()
        return {"status": "FULFILLED", "message": "Donor showed up — request fulfilled."}
    now = utcnow()
    req.status = "NO_SHOW"; await req.save()
    donor.reliability.no_show_count += 1
    donor.reliability.no_show_dates.append(now)
    recent = [d for d in donor.reliability.no_show_dates if _within_year(d, now)]
    if len(recent) >= 2 and donor.reliability.in_priority_pool:
        donor.reliability.in_priority_pool = False           # quietly removed
        donor.reliability.removed_at = now
    await donor.save()
    return {"status": "NO_SHOW", "no_shows_last_year": len(recent),
            "in_priority_pool": donor.reliability.in_priority_pool}
```

**Sample response `200`** (second no-show)
```json
{ "request_id": "...", "donor_id": "...", "status": "NO_SHOW",
  "no_shows_last_year": 2, "in_priority_pool": false,
  "message": "Second no-show within a year — donor quietly removed from the priority pool." }
```

---

## 2.6 Donor reliability / pool status

| | |
|---|---|
| **URL** | `GET http://localhost:1184/api/donors/{donor_id}/reliability` |
| **Headers** | *(none)* |
| **Params** | Path: `donor_id` — the donor's ObjectId |

```python
@router.get("/donors/{donor_id}/reliability")
async def get_reliability(donor_id: str):
    donor = await _get_donor(donor_id)
    now = utcnow()
    recent = [d for d in donor.reliability.no_show_dates if _within_year(d, now)]
    return {"donor_id": str(donor.id), "donor_name": donor.name,
            "no_show_count_lifetime": donor.reliability.no_show_count,
            "no_shows_last_year": len(recent),
            "in_priority_pool": donor.reliability.in_priority_pool}
```

---

## 2.7 File a no-show appeal

| | |
|---|---|
| **URL** | `POST http://localhost:1184/api/appeals` |
| **Headers** | `Content-Type: application/json` |

**Body**
```json
{ "donor_id": "6a59ca06f7d34e35aee72f9e", "request_id": "6a59ca07f7d34e35aee72fa8",
  "reason": "Road accident on the way — hospital records attached." }
```

```python
@router.post("/appeals", status_code=201)
async def create_appeal(body: AppealCreate):
    donor = await _get_donor(body.donor_id)
    appeal = Appeal(donor_id=str(donor.id), donor_name=donor.name,
                    request_id=body.request_id, reason=body.reason)
    await appeal.insert()
    return serialize(appeal)
```

---

## 2.8 Admin resolves an appeal  ⭐ corner case

`CLEAR` forgives the most recent no-show and restores the donor to the priority pool if
they now sit below the 2-per-year threshold; `REJECT` simply closes the appeal.

| | |
|---|---|
| **URL** | `POST http://localhost:1184/api/appeals/{appeal_id}/resolve` |
| **Headers** | `Content-Type: application/json` |

**Body**
```json
{ "action": "CLEAR", "admin": "admin.sadia" }
```

```python
@router.post("/appeals/{appeal_id}/resolve")
async def resolve_appeal(appeal_id: str, body: AppealResolve):
    appeal = await Appeal.get(to_oid(appeal_id))
    if not appeal: raise HTTPException(404, "Appeal not found")
    if appeal.status != "PENDING": raise HTTPException(400, f"Appeal already {appeal.status}")
    now = utcnow(); appeal.resolved_by = body.admin; appeal.resolved_at = now
    if body.action.upper() == "REJECT":
        appeal.status = "REJECTED"; await appeal.save()
        return {"appeal_id": str(appeal.id), "status": "REJECTED"}
    appeal.status = "CLEARED"; await appeal.save()
    donor = await Donor.get(to_oid(appeal.donor_id))
    if donor and donor.reliability.no_show_dates:
        donor.reliability.no_show_dates.pop()                # forgive most recent
        donor.reliability.no_show_count = max(0, donor.reliability.no_show_count - 1)
        recent = [d for d in donor.reliability.no_show_dates if _within_year(d, now)]
        if len(recent) < 2 and not donor.reliability.in_priority_pool:
            donor.reliability.in_priority_pool = True         # restored
            donor.reliability.removed_at = None
        await donor.save()
    return {"appeal_id": str(appeal.id), "status": "CLEARED", "priority_pool_restored": True}
```

**Sample response `200`**
```json
{ "appeal_id": "6a59ca07f7d34e35aee72fa9", "status": "CLEARED",
  "donor_id": "6a59ca06f7d34e35aee72f9e", "priority_pool_restored": true,
  "message": "Appeal verified and cleared. Donor restored to the priority pool." }
```

---

# FEATURE 3 — Varsity Node Leaderboard

A live, public ranking of universities by the number of emergency requests their students
**fulfilled** in a calendar month. Scoring is on arrival, not acceptance — a donor who
locks a request and never turns up scores nothing, which is what stops the board becoming
a race to tap first.

Seed the dummy dataset first: `python seed_leaderboard.py` (10 universities, ~120 student
donors, 13 months of history, with ties deliberately engineered into two of the months).

---

## 3.1 Published months

The window the board publishes: the last 12 calendar months, ending with the one in
progress. Clients build their month picker from this rather than from the device clock,
so a wrong phone date can never request a month that does not exist yet.

| | |
|---|---|
| **URL** | `GET http://localhost:1184/api/leaderboard/months` |
| **Headers** | *(none — the board is public)* |
| **Params** | *(none)* |

**Sample response `200`**
```json
{ "months": [
    { "key": "2025-09", "label": "September 2025", "short_label": "Sep",
      "year": 2025, "month": 9, "is_current": false },
    { "key": "2026-08", "label": "August 2026", "short_label": "Aug",
      "year": 2026, "month": 8, "is_current": true } ],
  "current": "2026-08", "window_months": 12 }
```

---

## 3.2 Monthly leaderboard  ⭐ core engine

| | |
|---|---|
| **URL** | `GET http://localhost:1184/api/leaderboard?month=2026-03` |
| **Headers** | *(none)* |
| **Params** | Query: `month` — `YYYY-MM`. Omit for the month in progress. |

Scoring runs as one database aggregation over the month's fulfilled requests:

```python
pipeline = [
    {"$match": {"status": "FULFILLED",
                "fulfilled_at": {"$gte": start, "$lt": end},
                "secured_donor_university": {"$nin": [None, ""]}}},
    {"$group": {"_id": "$secured_donor_university",
                "fulfilled": {"$sum": 1},
                # $avg skips nulls: a request accepted with no ping behind it
                # scores a point but casts no vote on the tie-break.
                "avg_response_seconds": {"$avg": "$response_seconds"},
                "donor_ids": {"$addToSet": "$secured_donor_id"}}},
]
```

Month boundaries are **local** (Asia/Dhaka) and converted to UTC before the query — a
donation at 2 a.m. on 1 September in Dhaka belongs to September, not to August.

**Sample response `200`** (abridged)
```json
{ "month": "2026-03", "label": "March 2026", "is_current_month": false,
  "tie_break_rule": "Universities finishing level on fulfilled requests are separated by their average ping-to-acceptance time — the faster campus ranks higher.",
  "totals": { "fulfilled": 67, "units": 82, "universities_scored": 10,
              "universities_listed": 10, "donors": 51, "avg_response_seconds": 285.6 },
  "ties": [12, 6, 5],
  "entries": [
    { "rank": 1, "university": "BRAC University", "short_name": "BRACU",
      "fulfilled": 12, "units": 15, "donors": 10, "registered_students": 17,
      "avg_response_seconds": 203.4, "avg_response_label": "3m 23s",
      "fastest_response_label": "1m 38s", "responses_measured": 12,
      "tied_with": ["Bangladesh University of Engineering and Technology",
                    "University of Dhaka"],
      "tie_broken": true,
      "tie_break_note": "Level with … on 12 fulfilled — ranked higher on a faster 3m 23s average ping-to-acceptance.",
      "previous_rank": 3, "movement": 2 } ] }
```

---

## 3.3 The tie-break  ⭐ corner case

Two universities finishing the month on the **exact same** number of fulfilled requests
are separated by their average ping-to-acceptance time — the gap between the ping landing
on a student's phone and that student securing the request — and the faster campus ranks
higher. Without it the two would be frozen in whatever order the database happened to
return, so the board would silently rank by insertion order and call it a result.

```python
def sort_key(e):
    avg = e["avg_response_seconds"]
    return (
        -e["fulfilled"],                            # points first
        avg if avg is not None else float("inf"),   # then the faster responder
        e["university"],                            # deterministic if even that ties
    )
```

A campus with no measured response times sorts last within its tie group: it has not
shown it can answer faster, so it cannot claim the higher rank on that basis. Only a
genuinely inseparable pair — same points **and** the same average — shares a rank.

Every tied entry carries `tie_broken: true` and a `tie_break_note` stating exactly why it
sits where it does, so the ranking is never something the reader has to take on trust.

---

## 3.4 Refusing an upcoming month  ⭐ corner case

A future month is **rejected**, not answered with an empty board — an empty board reads
as "nobody donated", which is a very different claim from "that month has not happened
yet".

| | |
|---|---|
| **URL** | `GET http://localhost:1184/api/leaderboard?month=2026-09` |

**Sample response `400`**
```json
{ "detail": "September 2026 has not happened yet — the leaderboard only publishes months up to August 2026." }
```

Anything older than the 12-month window is refused the same way, and a malformed month
(`?month=august`) returns a `400` naming the expected shape.

---

## 3.5 Varsity node roster

Used by the board and by the campus picker at donor sign-up. Registration matches a
submitted campus against this roster (full name **or** short name, case-insensitively)
and rejects anything else with a `400` — free text would split one node into three on the
board, each with a third of the score.

| | |
|---|---|
| **URL** | `GET http://localhost:1184/api/leaderboard/universities` |

**Sample response `200`**
```json
[ { "id": "6a59…", "name": "BRAC University", "short_name": "BRACU", "city": "Dhaka" } ]
```

---

## 3.6 One campus's month

| | |
|---|---|
| **URL** | `GET http://localhost:1184/api/leaderboard/{university}?month=2026-03` |
| **Params** | Path: `university` — full name or short name (`BRACU`) |

Returns that campus's single row plus its rank in context; `404` if it is not a
registered node.

**Privacy.** Every response here is campus totals only — the board never publishes a
donor's name, phone number or location, the same line the dispatch radar draws in
`app.zones`.

---

# FEATURE 4 — Golden Donor Verification

Three **confirmed** donations earn a donor a verified *Golden Donor* badge, and the badge
buys them exactly one thing: on an ICU dispatch they are pinged before everybody else.

Two ideas are kept deliberately apart, and the whole feature turns on the distinction:

| | earned at | revoked when |
|---|---|---|
| **the badge** (`is_golden`) | 3 confirmed donations | never — it is a record of what someone did |
| **the priority** (`priority_active`) | the same moment | the donor stops looking reachable |

**Only confirmed arrivals count.** `health.donation_count` is incremented in exactly one
place — `POST /api/requests/{id}/arrival` with `showed_up: true` — so the badge cannot be
farmed by tapping Accept and never turning up.

**The ghost-donor corner case.** A Golden Donor who relocates out of Dhaka, or who has not
opened the app for six months, has their *priority* suspended. This is the point of the
feature, not a punishment: priority placement means the dispatcher spends its first
seconds on that donor, and spending them on a phone in Chattogram — or one nobody has
opened since February — costs an ICU patient the very seconds the priority was meant to
buy. The badge stays. The priority returns automatically the moment the donor opens the
app or declares themselves back in the city; there is nothing to apply for and no admin
in the loop.

Priority **reorders and never filters**: a donor without a badge is pinged for an ICU case
exactly as they always were. The badge decides who hears *first*, not who hears.

---

## 4.1 Published rules

The terms of the scheme, served from the same constants the engine reads — so a screen can
never advertise a threshold the dispatcher does not use.

| | |
|---|---|
| **URL** | `GET http://localhost:1184/api/golden/rules` |
| **Headers** | *(none — readable before signing up)* |

**Sample response `200`**
```json
{ "min_donations": 3, "counts_only_confirmed_arrivals": true,
  "dormant_after_days": 180, "home_city": "Dhaka", "city_radius_km": 40.0,
  "priority_severities": ["LIFE_THREATENING"],
  "badge_is_permanent": true, "suspension_is_automatic": true,
  "restoration_is_automatic": true,
  "summary": "3 confirmed donations earn a verified Golden Donor badge and priority placement on ICU dispatches. Priority is suspended while a donor is outside Dhaka or has not opened the app for 180 days, and restores itself as soon as they are active again." }
```

---

## 4.2 My Golden Donor status  ⭐ core engine

| | |
|---|---|
| **URL** | `GET http://localhost:1184/api/golden/me` |
| **Headers** | `Authorization: Bearer <user token>` |

A **pure read**: it recomputes and reports but deliberately does *not* count as activity.
If opening this screen refreshed the dormancy clock, a donor could never see their own
suspension — the act of looking would clear it, and the six-month rule would be invisible
to the only person it affects. `POST /golden/me/heartbeat` is the explicit signal.

**Sample response `200`** *(a suspended holder)*
```json
{ "donor_id": "68f1", "donor_name": "Arif Rahman", "blood_type": "O+",
  "badge": { "is_golden": true, "status": "SUSPENDED", "priority_active": false,
             "verified": true, "earned_at": "2026-02-11T09:14:02+00:00",
             "suspended_reasons": ["No app activity for 210 days (suspends after 180)."] },
  "progress": { "donations": 6, "required": 3, "remaining": 0, "percent": 100 },
  "priority": { "active": false, "tier": "STANDARD",
                "explanation": "ICU dispatches reach you in the standard distance order." },
  "activity": { "last_seen_at": "2026-01-23T00:00:00+00:00", "days_since_seen": 210,
                "dormant_after_days": 180, "days_until_dormant": 0, "is_dormant": true },
  "location": { "home_city": "Dhaka", "declared": false, "served_city": "Dhaka",
                "km_from_city": 3.2, "radius_km": 40.0, "relocated": false },
  "history": { "earned_at": "2026-02-11T09:14:02+00:00", "donations_at_award": 3,
               "suspensions": 1, "suspended_at": "2026-08-21T16:14:10+00:00",
               "restored_at": null },
  "rules": { "min_donations": 3, "dormant_after_days": 180, "home_city": "Dhaka" } }
```

`403` for a patient account — *"Golden Donor status applies to donor accounts only."*

---

## 4.3 Restore a lapsed priority  ⭐ corner case

| | |
|---|---|
| **URL** | `POST http://localhost:1184/api/golden/me/heartbeat` |
| **Headers** | `Authorization: Bearer <user token>` |
| **Body** | *(none)* |

Opening the app *is* the whole proof of life the suspension was waiting on.

**Sample response `200`**
```json
{ "donor_id": "68f1", "status": "ACTIVE", "priority_active": true,
  "priority_restored": true, "still_suspended_because": [],
  "message": "Welcome back — your Golden Donor priority is active again.",
  "golden": { "badge": "the full 4.2 payload" } }
```

---

## 4.4 Declare a relocation (and a return)  ⭐ corner case

| | |
|---|---|
| **URL** | `PUT http://localhost:1184/api/golden/me/city` |
| **Headers** | `Authorization: Bearer <user token>` |
| **Body** | `{ "city": "Chattogram" }` — send `""` or `null` to clear it and fall back to GPS |

One field carries both directions. A relocation the donor could declare but not undo would
strand a returning donor outside the pool until their GPS caught up, so a declaration
outranks GPS both ways.

**Sample response `200`** *(moving away)*
```json
{ "donor_id": "68f1", "home_city": "Chattogram", "status": "SUSPENDED",
  "priority_active": false,
  "message": "Noted. Your badge is yours to keep — only ICU priority is paused while you are outside Dhaka." }
```

Without a declaration the engine falls back to the donor's last GPS fix, and a fix more
than `city_radius_km` from the city centre reads as a relocation:
`"Last known location is 212 km from Dhaka (limit 40 km)."`

---

## 4.5 How a request's pings would be ordered  ⭐ core engine

| | |
|---|---|
| **URL** | `GET http://localhost:1184/api/golden/requests/{request_id}/priority` |
| **Headers** | `Authorization: Bearer <user token>` |

A dry run: it writes nothing and pings nobody. It answers the question the feature actually
makes a claim about — for *this* emergency, in what sequence would donors be reached?

**Sample response `200`**
```json
{ "request_id": "68f2", "hospital": "Dhanmondi General", "blood_type": "O+",
  "severity": "CRITICAL", "icu": true, "icu_priority": true,
  "reason": "Flagged as an ICU case — proven donors are pinged first.",
  "order": [
    { "position": 1, "donor_name": "Arif Rahman", "tier": "GOLDEN_PRIORITY",
      "is_golden": true, "priority_active": true, "donations": 3 },
    { "position": 2, "donor_name": "Bithi Haque", "tier": "STANDARD",
      "is_golden": false, "priority_active": false, "donations": 1 },
    { "position": 3, "donor_name": "Chowdhury Kamal", "tier": "STANDARD",
      "is_golden": true, "priority_active": false, "donations": 6 } ] }
```

Position 3 is the corner case on display: a six-donation holder whose priority is
suspended sits in the standard tier, at their real distance, behind a donor with one
donation. Ask the same question of a non-ICU request and `icu_priority` comes back
`false` with the pool in plain distance order — the honest way to show that the badge
changes nothing there.

---

## 4.6 The roll of honour

| | |
|---|---|
| **URL** | `GET http://localhost:1184/api/golden/roster?status=ACTIVE` |
| **Headers** | `Authorization: Bearer <user token>` |
| **Params** | Query: `status` — `ACTIVE` or `SUSPENDED`. Omit for all holders. |

Signed-in users only: a name and a donation count is fine among members, not something to
publish to the open internet. Suspended holders are **listed rather than hidden** — they
earned the badge — but the *reason* for any individual's suspension never appears here.
"Relocated to Chattogram" and "has not opened the app since March" are both facts about
where a private person is and what they are doing.

**Sample response `200`**
```json
{ "count": 2, "active": 1, "suspended": 1, "min_donations": 3,
  "donors": [
    { "donor_id": "68f3", "donor_name": "Chowdhury Kamal", "blood_type": "O+",
      "university": "BRAC University", "is_golden": true, "status": "SUSPENDED",
      "priority_active": false, "donations": 6, "earned_at": "2025-11-02T10:00:00+00:00" },
    { "donor_id": "68f1", "donor_name": "Arif Rahman", "blood_type": "O+",
      "university": null, "is_golden": true, "status": "ACTIVE",
      "priority_active": true, "donations": 3, "earned_at": "2026-02-11T09:14:02+00:00" } ] }
```

---

## 4.7 One donor's badge

| | |
|---|---|
| **URL** | `GET http://localhost:1184/api/golden/donors/{donor_id}` |
| **Headers** | `Authorization: Bearer <user token>` |

The same thin public card as a roster row — badge and status, never the reason.

---

## 4.8 Earning the badge (the write path)

There is no endpoint that awards a badge. It is minted as a side effect of a hospital
confirming an arrival:

```
POST /api/requests/{id}/arrival    { "donor_id": "68f1", "showed_up": true }
```

whose response now carries:

```json
{ "status": "FULFILLED", "donation_type": "WHOLE_BLOOD",
  "golden_donor": { "is_golden": true, "status": "ACTIVE", "priority_active": true,
                    "label": "Golden Donor", "verified": true },
  "golden_donor_awarded": true }
```

`golden_donor_awarded` is `true` only on the dispatch that crossed the threshold — it is
the hook a client uses to show the "you are now a Golden Donor" moment exactly once.

**Flagging a request as ICU** is done at creation:

```
POST /api/requests   { "severity": "CRITICAL", "icu": true }
```

A request logged as `LIFE_THREATENING` is treated as ICU-grade even without the flag,
because a family logging an emergency would not know to tick it, and guessing low is the
expensive direction to be wrong in.

**What the dispatch response gains.** `POST /api/requests/{id}/dispatch` now reports the
ordering it used, and every result row carries its tier:

```json
{ "icu_priority": true,
  "icu_priority_reason": "Flagged as an ICU case — proven donors are pinged first.",
  "ping_order": "Golden Donors first, then nearest first.",
  "golden_donors_prioritised": 1,
  "reachable": 6, "pinged": 6,
  "results": [
    { "donor_name": "Arif Rahman", "priority_tier": "GOLDEN_PRIORITY",
      "golden_donor": true, "distance_km": 1.51, "pinged": true },
    { "donor_name": "Bithi Haque", "priority_tier": "STANDARD",
      "golden_donor": false, "distance_km": 1.51, "pinged": true } ] }
```

Both donors above are 1.51 km out; only the badge separates them.

---

## Endpoint summary

### Feature 1 — Smart Ping
| # | Method | Endpoint |
|---|--------|----------|
| 1.1 | POST | `/api/donors` |
| 1.2 | GET | `/api/donors` |
| 1.3 | GET | `/api/donors/{id}` |
| 1.4 | GET | `/api/donors/{id}/sleep-mode` |
| 1.5 | PUT | `/api/donors/{id}/sleep-mode` |
| 1.6 | PUT | `/api/donors/{id}/commute-route` |
| 1.6a | GET | `/api/donors/{id}/commute-route` |
| 1.6b | POST | `/api/donors/{id}/commute-route/toggle?enabled=` |
| 1.7 | DELETE | `/api/donors/{id}/commute-route` |
| 1.8 | PUT | `/api/donors/{id}/location` |
| 1.8b | DELETE | `/api/donors/{id}/location` |
| 1.8c | GET | `/api/donors/{id}/nearby-pings` |
| 1.9 | POST | `/api/dispatch/evaluate` |
| 1.9b | POST | `/api/donors/{id}/ping-preview` |
| 1.10 | GET | `/api/ping-logs` |

### Feature 2 — Concurrency & Accountability
| # | Method | Endpoint |
|---|--------|----------|
| 2.1 | POST | `/api/requests` |
| 2.2 | GET | `/api/requests` |
| 2.3 | GET | `/api/requests/{id}` |
| 2.4 | POST | `/api/requests/{id}/accept` |
| 2.5 | POST | `/api/requests/{id}/arrival` |
| 2.6 | GET | `/api/donors/{id}/reliability` |
| 2.7 | POST | `/api/appeals` |
| 2.8 | POST | `/api/appeals/{id}/resolve` |

### Feature 3 — Varsity Node Leaderboard
| # | Method | Endpoint |
|---|--------|----------|
| 3.1 | GET | `/api/leaderboard/months` |
| 3.2 | GET | `/api/leaderboard?month=YYYY-MM` |
| 3.5 | GET | `/api/leaderboard/universities` |
| 3.6 | GET | `/api/leaderboard/{university}?month=YYYY-MM` |

### Feature 4 — Golden Donor Verification
| # | Method | Endpoint |
|---|--------|----------|
| 4.1 | GET | `/api/golden/rules` |
| 4.2 | GET | `/api/golden/me` |
| 4.3 | POST | `/api/golden/me/heartbeat` |
| 4.4 | PUT | `/api/golden/me/city` |
| 4.5 | GET | `/api/golden/requests/{id}/priority` |
| 4.6 | GET | `/api/golden/roster?status=` |
| 4.7 | GET | `/api/golden/donors/{id}` |
