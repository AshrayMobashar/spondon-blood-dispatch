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
