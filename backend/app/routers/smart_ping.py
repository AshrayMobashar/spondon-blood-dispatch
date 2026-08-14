"""Feature 1 — Smart Ping: Sleep Mode & Commute-Aware Matching.

Donors control two independent settings that decide when/why they are pinged:
  • a Sleep Mode window that blocks pings (with an optional emergency override), and
  • a saved commute route that triggers a ping only while the donor's live GPS is
    actually on the road segment an active request sits on.
"""
from fastapi import APIRouter, HTTPException

from .. import config, integrations
from ..dispatch import (
    CITYWIDE_RARE, dispatch_block_reason, escalate, escalation_due,
    is_dispatchable, run_dispatch, triage,
)
from ..eligibility import recalculate
from ..models import Account, BloodRequest, HealthProfile, PingLog, CommuteRoute, GeoPoint, utcnow
from ..realtime import feed
from ..schemas import (
    DonorCreate, SleepModeUpdate, RouteUpdate, LocationUpdate, EvaluateBody,
)
from ..services import to_oid, serialize
from ..zones import zone_of

router = APIRouter()


async def _get_donor(donor_id: str) -> Account:
    donor = await Account.get(to_oid(donor_id))
    if not donor:
        raise HTTPException(status_code=404, detail="Donor not found")
    return donor


# ── Donor CRUD ───────────────────────────────────────────────────────
@router.post("/donors", status_code=201, summary="Register a donor")
async def create_donor(body: DonorCreate):
    """Direct donor creation (Postman / seeding).

    The phone-verified path for real users is `POST /api/auth/register`.
    """
    health = HealthProfile()
    if body.health:
        health.weight_kg = body.health.weight_kg
        health.weight_updated_at = utcnow() if body.health.weight_kg is not None else None
        health.last_donation_date = body.health.last_donation_date
        health.last_donation_type = (
            body.health.last_donation_type.upper() if body.health.last_donation_type else None
        )
    donor = Account(
        name=body.name,
        blood_type=body.blood_type.strip().upper(),
        phone=body.phone,
        fcm_token=body.fcm_token,
        health=health,
    )
    recalculate(donor)
    await donor.insert()
    return serialize(donor)


@router.get("/donors", summary="List donors (non-identifying projection)")
async def list_donors():
    """Public roster.

    Deliberately *not* the full document: a donor's phone number and live
    coordinates are their home address and their movements, and this endpoint
    needs no authentication. Position is generalised to a city zone, which is
    all any public view of the platform has a reason to know. An admin reads
    the full records through `/api/admin/donors`.
    """
    donors = await Account.find_all().to_list()
    return [
        {
            "id": str(d.id),
            "name": d.name,
            "blood_type": d.blood_type,
            "role": d.role,
            "status": d.status,
            "zone": zone_of(d.current_location),
            "eligibility": d.eligibility.model_dump(mode="json"),
            "health": {"donation_count": d.health.donation_count},
        }
        for d in donors
    ]


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
    donor.commute_route = CommuteRoute(
        segments=body.segments, label=body.label, enabled=body.enabled
    )
    await donor.save()
    return {
        "donor_id": str(donor.id),
        "message": "Commute route saved",
        "commute_route": donor.commute_route.model_dump(mode="json"),
    }


@router.post("/donors/{donor_id}/commute-route/toggle",
             summary="Pause/resume route matching without losing the route")
async def toggle_route(donor_id: str, enabled: bool = True):
    """Turning commute matching off must not throw the saved route away — a
    donor who pauses it should be able to resume without retyping their commute.
    """
    donor = await _get_donor(donor_id)
    if donor.commute_route is None:
        raise HTTPException(
            status_code=400,
            detail="No commute route saved yet — save one before toggling matching.",
        )
    donor.commute_route.enabled = enabled
    await donor.save()
    return {
        "donor_id": str(donor.id),
        "message": f"Route-aware matching {'resumed' if enabled else 'paused'}",
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
@router.post("/dispatch/evaluate", summary="Evaluate and deliver pings for a request")
async def evaluate_dispatch(body: EvaluateBody):
    """Run the full pipeline: gates → pool → reach → per-donor decision.

    Calling this repeatedly is how the ripple expands: the radius is derived
    from how long the request has been open, so a second call ten minutes later
    reaches 5 km, and a third at twenty minutes reaches 10 km.
    """
    req = await BloodRequest.get(to_oid(body.request_id))
    if not req:
        raise HTTPException(status_code=404, detail="Blood request not found")

    result = await run_dispatch(req, now_hhmm=body.now)

    # A rare type that nobody in the city answered is never left as a dead end.
    if escalation_due(req):
        esc = await escalate(
            req,
            f"No {req.blood_type} donor accepted city-wide within "
            f"{config.RARE_ESCALATION_SECONDS}s.",
        )
        result["escalation"] = serialize(esc)
    return result


@router.get("/requests/{request_id}/radar", summary="Zone summary for the City-Wide Radar")
async def radar_summary(request_id: str):
    """What the family's map is allowed to know before the broadcast starts.

    Every number here is an aggregate over a city zone. The distances used to
    build the ripple comparison are computed here and thrown away — they are
    never sent, because a distance from a known hospital plus a zone is enough
    to start narrowing down an individual.
    """
    req = await BloodRequest.get(to_oid(request_id))
    if not req:
        raise HTTPException(status_code=404, detail="Blood request not found")

    pool = await Account.find(Account.blood_type == req.blood_type).to_list()
    hosp = req.hospital_location

    buckets: dict[str, dict] = {}
    eligible_km: list[float] = []
    for acc in pool:
        ok, _ = is_dispatchable(acc, req)
        zone = zone_of(acc.current_location)
        b = buckets.setdefault(zone, {"zone": zone, "eligible": 0, "excluded": 0})
        b["eligible" if ok else "excluded"] += 1
        if ok and hosp is not None and acc.current_location is not None:
            eligible_km.append(integrations.haversine_km(
                hosp.lat, hosp.lng,
                acc.current_location.lat, acc.current_location.lng,
            ))

    # How far the expanding ripple would have got, as counts only.
    ripple_preview = [
        {
            "after_minutes": after,
            "radius_km": km,
            "count": sum(1 for d in eligible_km if d <= km),
        }
        for after, km in config.RIPPLE_STAGES
    ]

    zones_out = sorted(buckets.values(), key=lambda b: -b["eligible"])
    return {
        "request_id": str(req.id),
        "blood_type": req.blood_type,
        "hospital": req.hospital,
        "hospital_zone": zone_of(hosp),
        "dispatch_mode": triage(req),
        "rare_blood_override": triage(req) == CITYWIDE_RARE,
        "escalation_seconds": config.RARE_ESCALATION_SECONDS,
        "sms_alerts": config.RARE_SMS_ALERTS,
        "blocked_reason": dispatch_block_reason(req),
        "zones": zones_out,
        "totals": {
            "pool": len(pool),
            "eligible": sum(b["eligible"] for b in zones_out),
            "excluded": sum(b["excluded"] for b in zones_out),
            "zones_covered": sum(1 for b in zones_out if b["eligible"]),
        },
        "ripple_preview": ripple_preview,
        "watchers": feed.watcher_count(str(req.id)),
    }


@router.post("/requests/{request_id}/escalate", status_code=201,
             summary="Escalate to blood banks / NGO hotlines")
async def escalate_request(request_id: str):
    """Manual trigger for the rare-blood dead-end path (normally automatic)."""
    req = await BloodRequest.get(to_oid(request_id))
    if not req:
        raise HTTPException(status_code=404, detail="Blood request not found")
    if req.escalated:
        raise HTTPException(status_code=409, detail="This request has already been escalated.")
    esc = await escalate(req, "Manually escalated.")
    return serialize(esc)


@router.get("/ping-logs", summary="Audit log of ping decisions")
async def ping_logs(request_id: str | None = None, limit: int = 200):
    query = PingLog.find(PingLog.request_id == request_id) if request_id else PingLog.find_all()
    logs = await query.sort(-PingLog.created_at).limit(limit).to_list()
    return [serialize(l) for l in logs]
