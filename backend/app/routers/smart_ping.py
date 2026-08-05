"""Feature 1 — Smart Ping: Sleep Mode & Commute-Aware Matching.

Donors control two independent settings that decide when/why they are pinged:
  • a Sleep Mode window that blocks pings (with an optional emergency override), and
  • a saved commute route that triggers a ping only while the donor's live GPS is
    actually on the road segment an active request sits on.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from ..models import Donor, BloodRequest, PingLog, CommuteRoute, GeoPoint
from ..schemas import (
    DonorCreate, SleepModeUpdate, RouteUpdate, LocationUpdate, EvaluateBody,
)
from ..services import to_oid, serialize, decide_ping

router = APIRouter()


async def _get_donor(donor_id: str) -> Donor:
    donor = await Donor.get(to_oid(donor_id))
    if not donor:
        raise HTTPException(status_code=404, detail="Donor not found")
    return donor


# ── Donor CRUD ───────────────────────────────────────────────────────
@router.post("/donors", status_code=201, summary="Register a donor")
async def create_donor(body: DonorCreate):
    donor = Donor(name=body.name, blood_type=body.blood_type, fcm_token=body.fcm_token)
    await donor.insert()
    return serialize(donor)


@router.get("/donors", summary="List all donors")
async def list_donors():
    donors = await Donor.find_all().to_list()
    return [serialize(d) for d in donors]


@router.get("/donors/{donor_id}", summary="Get one donor")
async def get_donor(donor_id: str):
    return serialize(await _get_donor(donor_id))


# ── Sleep Mode ───────────────────────────────────────────────────────
@router.get("/donors/{donor_id}/sleep-mode", summary="Get sleep-mode settings")
async def get_sleep_mode(donor_id: str):
    donor = await _get_donor(donor_id)
    return {"donor_id": str(donor.id), "sleep_mode": donor.sleep_mode.model_dump()}


@router.put("/donors/{donor_id}/sleep-mode", summary="Update sleep-mode settings")
async def update_sleep_mode(donor_id: str, body: SleepModeUpdate):
    donor = await _get_donor(donor_id)
    donor.sleep_mode.enabled = body.enabled
    donor.sleep_mode.start = body.start
    donor.sleep_mode.end = body.end
    donor.sleep_mode.allow_extreme_emergencies = body.allow_extreme_emergencies
    donor.sleep_mode.dnd_on = body.dnd_on
    await donor.save()
    return {
        "donor_id": str(donor.id),
        "message": "Sleep Mode updated",
        "sleep_mode": donor.sleep_mode.model_dump(),
    }


# ── Commute route ────────────────────────────────────────────────────
@router.put("/donors/{donor_id}/commute-route", summary="Save/replace commute route")
async def save_route(donor_id: str, body: RouteUpdate):
    donor = await _get_donor(donor_id)
    donor.commute_route = CommuteRoute(segments=body.segments, label=body.label)
    await donor.save()
    return {
        "donor_id": str(donor.id),
        "message": "Commute route saved",
        "commute_route": donor.commute_route.model_dump(mode="json"),
    }


@router.delete("/donors/{donor_id}/commute-route", summary="Clear commute route")
async def delete_route(donor_id: str):
    donor = await _get_donor(donor_id)
    donor.commute_route = None
    await donor.save()
    return {"donor_id": str(donor.id), "message": "Commute route cleared"}


# ── Live location ────────────────────────────────────────────────────
@router.put("/donors/{donor_id}/location", summary="Update live GPS location")
async def update_location(donor_id: str, body: LocationUpdate):
    donor = await _get_donor(donor_id)
    donor.current_location = GeoPoint(
        lat=body.lat, lng=body.lng, road_segment=body.road_segment
    )
    await donor.save()
    return {
        "donor_id": str(donor.id),
        "message": "Location updated",
        "current_location": donor.current_location.model_dump(mode="json"),
    }


# ── Dispatch evaluation (the rule engine) ────────────────────────────
@router.post("/dispatch/evaluate", summary="Evaluate who gets pinged for a request")
async def evaluate_dispatch(body: EvaluateBody):
    req = await BloodRequest.get(to_oid(body.request_id))
    if not req:
        raise HTTPException(status_code=404, detail="Blood request not found")

    now_hhmm = body.now or datetime.now(timezone.utc).strftime("%H:%M")

    # candidate pool = donors whose blood type matches the request
    candidates = await Donor.find(Donor.blood_type == req.blood_type).to_list()

    results = []
    pinged_count = 0
    for donor in candidates:
        d = decide_ping(donor, req, now_hhmm)
        log = PingLog(
            request_id=str(req.id),
            donor_id=str(donor.id),
            donor_name=donor.name,
            decision=d["decision"],
            reason=d["reason"],
            pinged=d["pinged"],
            fcm_priority=d["fcm_priority"],
            fcm_bypass_dnd=d["fcm_bypass_dnd"],
        )
        await log.insert()
        if d["pinged"]:
            pinged_count += 1
        results.append({"donor_id": str(donor.id), "donor_name": donor.name, **d})

    return {
        "request_id": str(req.id),
        "evaluated_at": now_hhmm,
        "severity": req.severity,
        "road_segment": req.road_segment,
        "candidates": len(candidates),
        "pinged": pinged_count,
        "skipped": len(candidates) - pinged_count,
        "results": results,
    }


@router.get("/ping-logs", summary="Audit log of ping decisions")
async def ping_logs(request_id: str | None = None):
    query = PingLog.find(PingLog.request_id == request_id) if request_id else PingLog.find_all()
    logs = await query.sort(-PingLog.created_at).to_list()
    return [serialize(l) for l in logs]
