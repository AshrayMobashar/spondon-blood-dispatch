"""Module 3, Feature 1 — the Live En-Route Tracker.

Once a donor is locked in, the family gets a moving map instead of a wait. The
donor's phone posts fixes here; the family reads them back (or watches the
private `/ws/trip` socket) and sees a continuously-updating ETA.

Who may see what is decided in `_participants`, and it is narrow on purpose: the
requester who opened the emergency and the donor who accepted it, nobody else.
The public radar continues to see zone names and counts only — a donor's street
position is shown to the one family they are travelling to, and to no one else.

The corner case — the donor's phone losing its connection mid-trip — is handled
in two halves. This router refuses to invent movement (see `app.tracking`), and
the sweep in `main.py` announces the silence on the server's own clock so a
family with a perfectly good connection is told, rather than left watching an
icon that quietly stopped being true.
"""
import logging
from datetime import timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from .. import config, integrations
from .. import tracking as trip_rules
from ..models import (
    Account, BloodRequest, Trip, TripPoint,
    SIGNAL_LOST, TRIP_ARRIVED, TRIP_CANCELLED, TRIP_EN_ROUTE,
)
from ..realtime import feed, trip_room
from ..schemas import TripBatchIn, TripPointIn
from ..security import get_current_account
from ..services import to_oid, utcnow
from ..zones import zone_of

log = logging.getLogger("spondon.tracking.router")

router = APIRouter()

ROLE_DONOR_PARTY = "donor"
ROLE_FAMILY_PARTY = "family"


async def _participants(request_id: str, account: Account) -> tuple[BloodRequest, str]:
    """Load the request and establish which side of the call this account is on.

    A 403 here is the feature's privacy boundary. Knowing a request id is not
    authorisation to watch a stranger travel: ids appear in admin lists and
    dispatch logs, and if possession of one were enough, every donor's route
    home would be readable by anyone who had ever seen one.
    """
    req = await BloodRequest.get(to_oid(request_id))
    if not req:
        raise HTTPException(status_code=404, detail="Blood request not found")

    me = str(account.id)
    if req.secured_donor_id == me:
        return req, ROLE_DONOR_PARTY
    if req.requester_id and req.requester_id == me:
        return req, ROLE_FAMILY_PARTY
    raise HTTPException(
        status_code=403,
        detail="Only the family who opened this request and the donor who accepted it "
               "can see its tracker.",
    )


async def _donor_only(request_id: str, account: Account) -> BloodRequest:
    req, role = await _participants(request_id, account)
    if role != ROLE_DONOR_PARTY:
        raise HTTPException(
            status_code=403, detail="Only the secured donor can report their position."
        )
    return req


def _require_trip(req: BloodRequest) -> Trip:
    if req.trip is None:
        raise HTTPException(
            status_code=409,
            detail="No trip has started for this request yet.",
        )
    return req.trip


# ── Starting the trip ────────────────────────────────────────────────
async def start_trip(req: BloodRequest) -> Trip:
    """Open a trip for a locked request. Safe to call twice.

    Called automatically the moment a donor accepts, so the family's tracker
    exists before the first fix arrives — with no icon yet, but honest about
    why ("waiting for the donor's first location") rather than a 404 that reads
    like the donor was never real.
    """
    if req.trip and req.trip.status == TRIP_EN_ROUTE:
        return req.trip
    req.trip = Trip(started_at=utcnow())
    await req.save()
    return req.trip


@router.post("/requests/{request_id}/trip/start", summary="Donor starts travelling")
async def trip_start(request_id: str, account: Account = Depends(get_current_account)):
    req = await _donor_only(request_id, account)
    if req.status not in ("LOCKED", "FULFILLED"):
        raise HTTPException(
            status_code=409,
            detail=f"Request is {req.status} — only a locked request has a donor en route.",
        )
    trip = await start_trip(req)
    await feed.emit_room(
        trip_room(request_id),
        "trip_started",
        {"request_id": request_id, "trip": trip_rules.public_trip(trip)},
    )
    # The public radar learns only that the donor is moving, and from which
    # zone — the same granularity it was already allowed for `donor_secured`.
    await feed.emit(
        "donor_en_route",
        {"request_id": request_id, "hospital_zone": zone_of(req.hospital_location)},
        request_id=request_id,
    )
    return {"request_id": request_id, "trip": trip_rules.public_trip(trip)}


# ── Position reports ─────────────────────────────────────────────────
async def _apply_point(req: BloodRequest, body: TripPointIn) -> dict:
    """Vet one fix, store it if it is credible, and recompute the ETA.

    Returns a per-point result rather than raising, because a batch flushed
    after a reconnect can legitimately contain a mix of good and stale fixes and
    one bad sample must not reject the rest.
    """
    trip = req.trip
    now = utcnow()
    recorded = body.recorded_at or now
    if recorded.tzinfo is None:
        recorded = recorded.replace(tzinfo=timezone.utc)

    point = TripPoint(
        lat=body.lat,
        lng=body.lng,
        accuracy_m=body.accuracy_m,
        speed_kmh=body.speed_kmh,
        recorded_at=recorded,
        received_at=now,
    )

    ok, reason = trip_rules.vet_point(trip, point)
    if not ok:
        trip.rejected_updates += 1
        return {"accepted": False, "reason": reason}

    trip.last_point = point
    # Freshness is stamped from the server's clock, not the phone's. A device
    # with a wrong system time would otherwise be able to report itself
    # permanently fresh, or permanently stale, by accident.
    trip.last_seen_at = now
    trip.updates += 1
    trip.trail.append(point)
    if len(trip.trail) > config.TRIP_TRAIL_MAX_POINTS:
        # Thin from the front but keep the origin, so the drawn line still
        # starts where the donor did.
        trip.trail = [trip.trail[0]] + trip.trail[-(config.TRIP_TRAIL_MAX_POINTS - 1):]

    recovered = trip.signal_lost_at is not None
    if recovered:
        trip.signal_lost_at = None

    await _recompute_eta(req, trip)

    arrived = False
    hospital = req.hospital_location
    if hospital is not None:
        metres = integrations.haversine_km(
            hospital.lat, hospital.lng, point.lat, point.lng
        ) * 1000.0
        if metres <= config.TRIP_ARRIVAL_RADIUS_M:
            trip.status = TRIP_ARRIVED
            trip.arrived_at = trip.arrived_at or now
            trip.eta_minutes = 0.0
            arrived = True

    return {"accepted": True, "reason": reason, "recovered": recovered, "arrived": arrived}


async def _recompute_eta(req: BloodRequest, trip: Trip) -> None:
    """Refresh distance and ETA from the newest accepted fix.

    Driving distance where the Maps API is configured, because a donor 3 km
    from the hospital across the Buriganga is a 14 km drive and an ETA built on
    the straight line would be wrong by twenty minutes — the same reasoning that
    already governs the dispatch radius.
    """
    point, hospital = trip.last_point, req.hospital_location
    if point is None or hospital is None:
        return

    straight = integrations.haversine_km(point.lat, point.lng, hospital.lat, hospital.lng)
    distance, source = trip_rules.road_distance_km(straight), "straight-line"

    driving = await integrations.driving_distances_km(
        (point.lat, point.lng), [(hospital.lat, hospital.lng)]
    )
    if driving and driving[0] is not None:
        distance, source = driving[0], "driving"

    speed = trip_rules.usable_speed_kmh(trip)
    trip.distance_km = distance
    trip.distance_source = source
    trip.speed_kmh = speed
    trip.eta_minutes = trip_rules.eta_minutes(distance, speed)
    trip.eta_computed_at = utcnow()


async def _publish(request_id: str, req: BloodRequest, extra: Optional[dict] = None) -> dict:
    payload = trip_rules.public_trip(req.trip)
    await feed.emit_room(
        trip_room(request_id),
        "trip_update",
        {"request_id": request_id, "trip": payload, **(extra or {})},
    )
    return payload


@router.post("/requests/{request_id}/trip/location", summary="Donor reports a position")
async def trip_location(
    request_id: str, body: TripPointIn, account: Account = Depends(get_current_account)
):
    """One GPS fix from the travelling donor.

    Called every few seconds by the donor's app. A rejected fix answers 200 with
    `accepted: false` rather than an error status: the phone cannot do anything
    useful about a rejection, and turning routine GPS drift into a client-side
    error would have apps retrying a bad sample instead of sending the next
    good one.
    """
    req = await _donor_only(request_id, account)
    trip = req.trip or await start_trip(req)
    if trip.status == TRIP_CANCELLED:
        raise HTTPException(status_code=409, detail="This trip was cancelled.")

    result = await _apply_point(req, body)
    await req.save()
    payload = await _publish(request_id, req, {"accepted": result["accepted"]})

    if result.get("recovered"):
        await feed.emit_room(
            trip_room(request_id),
            "trip_signal_restored",
            {"request_id": request_id, "trip": payload},
        )
    if result.get("arrived"):
        await feed.emit_room(
            trip_room(request_id),
            "trip_arrived",
            {"request_id": request_id, "trip": payload},
        )

    return {"request_id": request_id, **result, "trip": payload}


@router.post("/requests/{request_id}/trip/batch", summary="Flush buffered fixes after a reconnect")
async def trip_batch(
    request_id: str, body: TripBatchIn, account: Account = Depends(get_current_account)
):
    """Replay fixes a phone recorded while it had no connection.

    This is the other half of the dropped-connection case. The donor kept
    driving; their phone kept measuring; only the uplink was gone. Sorting by
    the phone's own `recorded_at` before applying means the trail is redrawn in
    the order it was travelled, and the ETA lands on the newest position rather
    than whichever packet happened to arrive last.
    """
    req = await _donor_only(request_id, account)
    trip = req.trip or await start_trip(req)
    if trip.status == TRIP_CANCELLED:
        raise HTTPException(status_code=409, detail="This trip was cancelled.")

    ordered = sorted(body.points, key=lambda p: p.recorded_at or utcnow())
    results = [await _apply_point(req, p) for p in ordered]
    await req.save()

    payload = await _publish(request_id, req, {"replayed": len(ordered)})
    if any(r.get("recovered") for r in results):
        await feed.emit_room(
            trip_room(request_id),
            "trip_signal_restored",
            {"request_id": request_id, "trip": payload},
        )
    if any(r.get("arrived") for r in results):
        await feed.emit_room(
            trip_room(request_id), "trip_arrived", {"request_id": request_id, "trip": payload}
        )

    return {
        "request_id": request_id,
        "submitted": len(ordered),
        "accepted": sum(1 for r in results if r["accepted"]),
        "rejected": [r["reason"] for r in results if not r["accepted"]],
        "trip": payload,
    }


# ── The family's view ────────────────────────────────────────────────
@router.get("/requests/{request_id}/trip", summary="Live tracker state")
async def get_trip(request_id: str, account: Account = Depends(get_current_account)):
    """Everything the family's dashboard draws.

    Polled as a fallback for the socket, and read once on page load. Staleness
    is evaluated here, at read time, so a family who opens the page after their
    donor already went quiet sees the frozen state immediately instead of a
    confident ETA that only corrects itself on the next sweep.
    """
    req, role = await _participants(request_id, account)
    trip = trip_rules.public_trip(req.trip)
    return {
        "request_id": request_id,
        "viewer": role,
        "request_status": req.status,
        "hospital": req.hospital,
        "hospital_location": (
            {"lat": req.hospital_location.lat, "lng": req.hospital_location.lng}
            if req.hospital_location else None
        ),
        "donor_name": req.secured_donor_name,
        "requester_name": req.requester_name,
        "patient_name": req.patient_name,
        "blood_type": req.blood_type,
        "secured_at": req.secured_at.isoformat() if req.secured_at else None,
        "trip": trip,
        "waiting_for_first_fix": bool(trip and trip.get("last_location") is None),
    }


@router.post("/requests/{request_id}/trip/arrived", summary="Donor marks arrival")
async def trip_arrived(request_id: str, account: Account = Depends(get_current_account)):
    """Close the trip.

    Distinct from `/arrival`, which is the family confirming the donation
    happened and is what arms the cooldown. This one only says the journey is
    over, so the tracker can stop and the call channel can be torn down.
    """
    req = await _donor_only(request_id, account)
    trip = _require_trip(req)
    trip.status = TRIP_ARRIVED
    trip.arrived_at = trip.arrived_at or utcnow()
    trip.eta_minutes = 0.0
    trip.eta_computed_at = utcnow()
    await req.save()

    payload = await _publish(request_id, req)
    await feed.emit_room(
        trip_room(request_id), "trip_arrived", {"request_id": request_id, "trip": payload}
    )
    return {"request_id": request_id, "trip": payload}


# ── The sweep's worker (called from main's background task) ──────────
async def mark_lost_signals() -> int:
    """Freeze any trip whose donor has gone quiet, and tell their family.

    Read-time staleness (in `public_trip`) is not enough on its own: a family
    sitting on an open tracker makes no further requests once the socket has
    gone quiet, so without this nothing would ever arrive to correct the screen.
    The freeze has to be *pushed*.

    Only the transition is announced. A donor who is out of coverage for ten
    minutes produces one banner, not one every five seconds.
    """
    frozen = 0
    requests = await BloodRequest.find(BloodRequest.status == "LOCKED").to_list()
    for req in requests:
        trip = req.trip
        if trip is None or trip.status != TRIP_EN_ROUTE:
            continue
        if trip.signal_lost_at is not None:
            continue
        if not trip_rules.signal_is_lost(trip):
            continue

        trip.signal_lost_at = utcnow()
        trip.signal_drops += 1
        await req.save()
        frozen += 1

        payload = trip_rules.public_trip(trip)
        await feed.emit_room(
            trip_room(str(req.id)),
            "trip_signal_lost",
            {
                "request_id": str(req.id),
                "signal": SIGNAL_LOST,
                "message": trip_rules.SIGNAL_LOST_MESSAGE,
                "trip": payload,
            },
        )
        log.info(
            "Trip signal lost for request %s after %.0fs of silence",
            req.id, payload.get("seconds_since_fix") or 0,
        )
    return frozen
