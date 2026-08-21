"""Feature 2 — Concurrency Lock & Flake-Out Accountability.

The first donor to tap Accept atomically locks the request ("Donor Secured" to
everyone else). No-shows are tracked: two within a single year quietly drop a
donor from the priority pool. Genuine no-shows can be appealed and cleared by an
admin.
"""
import base64
import binascii
import hashlib
from datetime import timedelta, datetime
from difflib import SequenceMatcher
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pymongo import ReturnDocument

from .. import config, integrations
from .. import golden as golden_engine
from ..db import get_collection
from ..dispatch import is_dispatchable, run_dispatch
from ..eligibility import recalculate
from ..models import (
    Account, BloodRequest, Appeal, GeoPoint, PingLog, SHADOW_BANNED,
    TRIP_ARRIVED, TRIP_CANCELLED,
)
from ..schemas import (
    RequestCreate, AcceptBody, DeclineBody, ArrivalBody, AppealCreate, AppealResolve,
    SlipUpload,
)
from ..realtime import feed
from ..security import get_optional_account, get_current_account
from ..services import to_oid, serialize, utcnow
from ..tracking import public_trip
from ..zones import zone_of
from .calling import close_sessions_for_request, open_session
from .tracking import start_trip

router = APIRouter()

ONE_YEAR = timedelta(days=365)


async def _get_request(request_id: str) -> BloodRequest:
    req = await BloodRequest.get(to_oid(request_id))
    if not req:
        raise HTTPException(status_code=404, detail="Blood request not found")
    return req


async def _get_donor(donor_id: str) -> Account:
    donor = await Account.get(to_oid(donor_id))
    if not donor:
        raise HTTPException(status_code=404, detail="Donor not found")
    return donor


# ── Requests ─────────────────────────────────────────────────────────
@router.post("/requests", status_code=201, summary="Create a blood request (OPEN)")
async def create_request(
    body: RequestCreate, requester: Optional[Account] = Depends(get_optional_account)
):
    """Log an emergency.

    The requester is taken from the bearer token when there is one — that link
    is what lets a later shadow ban reach this request. A banned account cannot
    get this far: `get_optional_account` rejects it at the door.
    """
    if requester is None and body.requester_id:
        requester = await Account.get(to_oid(body.requester_id))

    location = None
    if body.hospital_lat is not None and body.hospital_lng is not None:
        location = GeoPoint(
            lat=body.hospital_lat, lng=body.hospital_lng, road_segment=body.road_segment
        )

    req = BloodRequest(
        patient_name=body.patient_name,
        hospital=body.hospital,
        blood_type=body.blood_type.strip().upper(),
        component=body.component.upper(),
        units=body.units,
        severity=body.severity.upper(),
        icu=body.icu,
        road_segment=body.road_segment,
        hospital_location=location,
        requester_id=str(requester.id) if requester else None,
        requester_name=requester.name if requester else None,
        # The shadow ban applies at creation, not just retroactively: a flagged
        # account's new requests are born muted while still reading OPEN.
        broadcast=not (requester is not None and requester.status == SHADOW_BANNED),
    )
    await req.insert()
    return serialize(req)


# ── Doctor's-slip OCR verification (Module 2, Feature 3) ─────────────
@router.post("/requests/{request_id}/slip", summary="Upload the requisition slip for OCR")
async def upload_slip(request_id: str, body: SlipUpload):
    """Run the slip photo through OCR before any dispatch is authorised.

    Three outcomes, and only the first releases the dispatch automatically:

      * confident match          → OCR_CONFIRMED, request may broadcast
      * illegible / low-confidence → NEEDS_REVIEW, human queue (never auto-rejected)
      * not a medical document   → REJECTED, with a prompt for a real slip

    With no OCR engine configured every slip takes the middle path, which is the
    same queue an unreadable slip would land in.
    """
    req = await _get_request(request_id)

    raw = body.image
    mime = body.mime
    if raw.startswith("data:"):
        header, _, payload = raw.partition(",")
        mime = header[5:].split(";")[0] or mime
        raw = payload
    try:
        base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="image must be base64 or a data: URI")

    image_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    existing = await BloodRequest.find_one(BloodRequest.slip_image_hash == image_hash)
    if existing and existing.id != req.id:
        req.slip_status = "REJECTED"
        req.slip_image_hash = image_hash
        req.slip_image = f"data:{mime};base64,{raw}"
        await req.save()
        return {
            "request_id": str(req.id),
            "slip_status": "REJECTED",
            "message": "Duplicate slip detected. This exact image has already been uploaded for another request.",
            "dispatch_authorised": False
        }

    result = await integrations.read_slip(raw, mime, req.component)

    req.slip_image = f"data:{mime};base64,{raw}"
    req.slip_image_hash = image_hash
    req.ocr_confidence = result.get("confidence")
    req.ocr_notes = result.get("notes") or result.get("error")
    req.ocr_simulated = bool(result.get("simulated"))
    req.slip_reviewed_by = None
    req.slip_reviewed_at = None

    confidence = result.get("confidence")
    component = (result.get("component") or "").upper()
    date_written_str = result.get("date_written")
    has_stamp = result.get("has_stamp_or_signature")
    ocr_patient_name = result.get("patient_name") or ""

    is_expired = False
    if date_written_str:
        try:
            # handle ISO format date
            dt = datetime.fromisoformat(date_written_str.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=utcnow().tzinfo)
            if (utcnow() - dt).total_seconds() > 48 * 3600:
                is_expired = True
        except ValueError:
            pass

    name_match_ratio = SequenceMatcher(None, req.patient_name.lower(), ocr_patient_name.lower()).ratio()

    if result.get("is_medical_slip") is False:
        # Schema mismatch — halt rather than score it as a bad slip.
        req.slip_status = "REJECTED"
        message = "That does not look like a laboratory requisition slip. Please upload a clear photo of the doctor's slip."
    elif is_expired:
        req.slip_status = "NEEDS_REVIEW"
        message = "The date on the slip indicates it is older than 48 hours — sent for human review."
    elif not has_stamp and not req.ocr_simulated:
        req.slip_status = "NEEDS_REVIEW"
        message = "Could not detect an official hospital stamp or doctor's signature — sent for human review."
    elif confidence is None or confidence < config.OCR_CONFIDENCE_THRESHOLD:
        req.slip_status = "NEEDS_REVIEW"
        message = "Handwriting could not be read confidently — a human reviewer will verify it shortly."
    elif name_match_ratio < 0.6 and not req.ocr_simulated:
        req.slip_status = "NEEDS_REVIEW"
        message = f"The patient name on the slip ({ocr_patient_name}) does not match the request ({req.patient_name}) — sent for human review."
    elif component and component != req.component.upper():
        req.slip_status = "NEEDS_REVIEW"
        message = (
            f"The slip appears to reference {component} but the request is for "
            f"{req.component} — sent for human review."
        )
    else:
        req.slip_status = "OCR_CONFIRMED"
        message = "Slip verified — dispatch authorised."

    if req.slip_status in ("NEEDS_REVIEW", "REJECTED"):
        if req.ocr_notes:
            req.ocr_notes = f"{message} (OCR: {req.ocr_notes})"
        else:
            req.ocr_notes = message

    await req.save()
    return {
        "request_id": str(req.id),
        "slip_status": req.slip_status,
        "ocr_confidence": req.ocr_confidence,
        "ocr_engine": "live" if integrations.ocr_configured() else "not configured",
        "extracted": {k: result.get(k) for k in
                      ("patient_name", "hospital", "blood_type", "component", "units")},
        "dispatch_authorised": req.slip_cleared,
        "message": message,
    }


@router.post("/requests/{request_id}/dispatch", summary="Broadcast this request to donors")
async def dispatch_request(request_id: str):
    """Fire the ping. Safe to call repeatedly — that is how the ripple widens."""
    req = await _get_request(request_id)
    return await run_dispatch(req)


@router.get("/requests", summary="List blood requests")
async def list_requests():
    reqs = await BloodRequest.find_all().sort(-BloodRequest.created_at).to_list()
    return [serialize(r) for r in reqs]


@router.get("/requests/incoming", summary="Active requests dispatched to the current donor")
async def get_incoming_requests(donor: Account = Depends(get_current_account)):
    """The donor's own feed: requests they were actually pinged for and have not
    already turned down.

    Declared above `/requests/{request_id}` because FastAPI matches in
    declaration order — the other way round, "incoming" is read as a request id.
    """
    pings = await PingLog.find(
        PingLog.donor_id == str(donor.id),
        PingLog.pinged == True  # noqa: E712
    ).to_list()

    request_ids = [to_oid(p.request_id) for p in pings]
    if not request_ids:
        return []

    reqs = await BloodRequest.find(
        {"_id": {"$in": request_ids}, "status": "OPEN"}
    ).sort(-BloodRequest.created_at).to_list()

    # Exclude requests the donor has already declined
    reqs = [r for r in reqs if str(donor.id) not in r.declined_by]

    return [serialize(r) for r in reqs]


@router.get("/requests/{request_id}", summary="Get request status")
async def get_request(request_id: str):
    req = await _get_request(request_id)
    out = serialize(req)
    out["donor_secured"] = req.status != "OPEN"
    return out


# ── The concurrency lock (atomic first-wins) ─────────────────────────
@router.post("/requests/{request_id}/accept", summary="Accept a request (atomic lock)")
async def accept_request(request_id: str, body: AcceptBody):
    """ACID guarantee: a single conditional `find_one_and_update` flips the
    request OPEN → LOCKED. MongoDB serialises document writes, so out of any
    number of simultaneous accepts exactly ONE succeeds; every runner-up sees
    the document already LOCKED and gets a polite 409 'Donor Secured'."""
    oid = to_oid(request_id)
    donor = await _get_donor(body.donor_id)
    req = await _get_request(request_id)

    # A donor who was never pingable must not be able to lock a request by
    # posting straight to this endpoint.
    recalculate(donor)
    await donor.save()
    allowed, why = is_dispatchable(donor, req)
    if not allowed:
        raise HTTPException(
            status_code=403,
            detail={"message": "You cannot accept this request.", "reason": why},
        )

    # Leaderboard bookkeeping, resolved before the lock so it can ride along in
    # the same atomic write: the campus that will score if this donor shows up,
    # and how long they took to answer the ping — the number that breaks a
    # month-end tie between two universities on equal points.
    secured_at = utcnow()
    response_seconds = await _ping_to_acceptance(request_id, str(donor.id), secured_at)

    collection = get_collection(BloodRequest)
    updated = await collection.find_one_and_update(
        {"_id": oid, "status": "OPEN"},              # compare
        {"$set": {                                   # ...and swap, atomically
            "status": "LOCKED",
            "secured_donor_id": str(donor.id),
            "secured_donor_name": donor.name,
            "secured_donor_phone": donor.phone,
            "secured_donor_university": donor.university,
            "response_seconds": response_seconds,
            "secured_at": secured_at,
        }},
        return_document=ReturnDocument.AFTER,
    )

    if updated is None:
        # Either the request doesn't exist, or it was already locked by someone else.
        current = await BloodRequest.get(oid)
        if not current:
            raise HTTPException(status_code=404, detail="Blood request not found")
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Donor Secured",
                "note": "Another donor accepted first — this request is already locked.",
                "request_id": str(current.id),
                "secured_donor_id": current.secured_donor_id,
                "secured_donor_name": current.secured_donor_name,
            },
        )

    # Radar: the search is over. Zone only — the family learns help is coming
    # and roughly from where, not who or from what address.
    await feed.emit(
        "donor_secured",
        {
            "request_id": request_id,
            "from_zone": zone_of(donor.current_location),
            "hospital_zone": zone_of(req.hospital_location),
            "secured_at": updated["secured_at"].isoformat(),
        },
        request_id=request_id,
    )

    # Winning the lock is what unlocks the two live channels the family gets:
    # the en-route tracker and the masked call button. Both are provisioned here
    # rather than on first use, so the family's screen flips from "searching" to
    # a working dashboard in one step — a family told help is coming should not
    # then wait on a second round-trip to find out where it is or how to reach it.
    secured = await BloodRequest.get(oid)
    trip = await start_trip(secured)
    session = await open_session(secured)

    return {
        "message": "You've secured this request",
        "request_id": str(updated["_id"]),
        "status": "LOCKED",
        "secured_donor_id": updated["secured_donor_id"],
        "secured_donor_name": updated["secured_donor_name"],
        "secured_at": updated["secured_at"].isoformat(),
        "varsity_node": updated.get("secured_donor_university"),
        "response_seconds": updated.get("response_seconds"),
        "trip": public_trip(trip),
        "call_session_id": str(session.id) if session else None,
        "next_step": (
            "Start sharing your location so the family can track you, and use the "
            "masked call button to agree where to meet."
        ),
    }


@router.post("/requests/{request_id}/decline", summary="Decline a request")
async def decline_request(request_id: str, body: DeclineBody, logged_in: Optional[Account] = Depends(get_optional_account)):
    oid = to_oid(request_id)
    donor_id = str(logged_in.id) if logged_in else body.donor_id
    donor = await _get_donor(donor_id)
    req = await _get_request(request_id)

    if req.status != "OPEN":
        raise HTTPException(status_code=400, detail="Request is no longer open")

    collection = get_collection(BloodRequest)
    await collection.update_one(
        {"_id": oid},
        {"$addToSet": {"declined_by": str(donor.id)}}
    )

    return {
        "message": "You have declined this request",
        "request_id": str(oid),
        "donor_id": str(donor.id),
    }


# ── Arrival / no-show accountability ─────────────────────────────────
@router.post("/requests/{request_id}/arrival", summary="Record arrival or no-show")
async def record_arrival(request_id: str, body: ArrivalBody):
    req = await _get_request(request_id)
    if req.status not in ("LOCKED", "FULFILLED", "NO_SHOW"):
        raise HTTPException(status_code=400, detail="Request has not been accepted yet")
    if req.secured_donor_id != body.donor_id:
        raise HTTPException(status_code=400, detail="This donor did not secure the request")

    donor = await _get_donor(body.donor_id)

    if body.showed_up:
        now = utcnow()
        req.status = "FULFILLED"
        # The scoring event for the Varsity Node Leaderboard. It is the arrival
        # that scores, never the acceptance — otherwise a campus could climb the
        # board by tapping Accept fastest and never turning up.
        req.fulfilled_at = now
        # The journey is over, so the two live channels close with it. A tracker
        # left running keeps publishing a donor's position after the reason for
        # sharing it has passed, and a call channel left open is a standing
        # phone line between two people who met once.
        if req.trip:
            req.trip.status = TRIP_ARRIVED
            req.trip.arrived_at = req.trip.arrived_at or now
        await req.save()
        await close_sessions_for_request(str(req.id), "REQUEST_FULFILLED")

        # A fulfilled request *is* a donation, so it arms the cooldown here —
        # platelets for 14 days, anything else for 120.
        kind = config.PLATELETS if req.component.upper() == "PLATELETS" else config.WHOLE_BLOOD
        donor.health.last_donation_date = now
        donor.health.last_donation_type = kind
        donor.health.donation_count += 1
        donor.eligibility.cooldown_waived_at = None
        donor.eligibility.cooldown_waived_by = None
        recalculate(donor, now=now)
        # The Golden Donor badge is minted here and nowhere else. Turning up is
        # the whole qualification, so the count that earns it can only move on
        # a confirmed arrival — never on an acceptance.
        was_golden = donor.golden.is_golden
        golden_engine.recalculate(donor, now=now)
        await donor.save()

        return {
            "request_id": str(req.id),
            "donor_id": str(donor.id),
            "status": "FULFILLED",
            "donation_type": kind,
            "golden_donor": golden_engine.badge(donor),
            "golden_donor_awarded": donor.golden.is_golden and not was_golden,
            "cooldown_days": config.COOLDOWN_DAYS[kind],
            "next_eligible_at": (
                donor.eligibility.cooldown_until.isoformat()
                if donor.eligibility.cooldown_until else None
            ),
            "message": (
                f"Donor showed up — request fulfilled. Eligibility locked for "
                f"{config.COOLDOWN_DAYS[kind]} days."
            ),
        }

    # No-show → record it and apply the 2-in-a-year rule.
    now = utcnow()
    req.status = "NO_SHOW"
    if req.trip:
        req.trip.status = TRIP_CANCELLED
    await req.save()
    await close_sessions_for_request(str(req.id), "REQUEST_NO_SHOW")

    donor.reliability.no_show_count += 1
    donor.reliability.no_show_dates.append(now)
    recent = [d for d in donor.reliability.no_show_dates if _within_year(d, now)]
    removed = False
    if len(recent) >= 2 and donor.reliability.in_priority_pool:
        donor.reliability.in_priority_pool = False
        donor.reliability.removed_at = now
        removed = True
    await donor.save()

    return {
        "request_id": str(req.id),
        "donor_id": str(donor.id),
        "status": "NO_SHOW",
        "no_shows_last_year": len(recent),
        "in_priority_pool": donor.reliability.in_priority_pool,
        "message": (
            "Second no-show within a year — donor quietly removed from the priority pool."
            if removed else
            "No-show recorded."
        ),
    }


@router.get("/donors/{donor_id}/reliability", summary="Donor reliability / pool status")
async def get_reliability(donor_id: str):
    donor = await _get_donor(donor_id)
    now = utcnow()
    recent = [d for d in donor.reliability.no_show_dates if _within_year(d, now)]
    return {
        "donor_id": str(donor.id),
        "donor_name": donor.name,
        "no_show_count_lifetime": donor.reliability.no_show_count,
        "no_shows_last_year": len(recent),
        "in_priority_pool": donor.reliability.in_priority_pool,
        "removed_at": donor.reliability.removed_at.isoformat() if donor.reliability.removed_at else None,
    }


# ── Appeals ──────────────────────────────────────────────────────────
@router.post("/appeals", status_code=201, summary="File a no-show appeal")
async def create_appeal(body: AppealCreate):
    donor = await _get_donor(body.donor_id)
    appeal = Appeal(
        donor_id=str(donor.id),
        donor_name=donor.name,
        request_id=body.request_id,
        reason=body.reason,
    )
    await appeal.insert()
    return serialize(appeal)


@router.post("/appeals/{appeal_id}/resolve", summary="Admin resolves an appeal")
async def resolve_appeal(appeal_id: str, body: AppealResolve):
    appeal = await Appeal.get(to_oid(appeal_id))
    if not appeal:
        raise HTTPException(status_code=404, detail="Appeal not found")
    if appeal.status != "PENDING":
        raise HTTPException(status_code=400, detail=f"Appeal already {appeal.status}")

    action = body.action.upper()
    if action not in ("CLEAR", "REJECT"):
        raise HTTPException(status_code=400, detail="action must be CLEAR or REJECT")

    now = utcnow()
    appeal.resolved_by = body.admin
    appeal.resolved_at = now

    if action == "REJECT":
        appeal.status = "REJECTED"
        await appeal.save()
        return {"appeal_id": str(appeal.id), "status": "REJECTED", "message": "Appeal rejected."}

    # CLEAR: forgive the most recent no-show and restore the pool if now < 2/year.
    appeal.status = "CLEARED"
    await appeal.save()

    donor = await Account.get(to_oid(appeal.donor_id))
    restored = False
    if donor:
        if donor.reliability.no_show_dates:
            donor.reliability.no_show_dates.pop()            # drop most recent
            donor.reliability.no_show_count = max(0, donor.reliability.no_show_count - 1)
        recent = [d for d in donor.reliability.no_show_dates if _within_year(d, now)]
        if len(recent) < 2 and not donor.reliability.in_priority_pool:
            donor.reliability.in_priority_pool = True
            donor.reliability.removed_at = None
            restored = True
        await donor.save()

    return {
        "appeal_id": str(appeal.id),
        "status": "CLEARED",
        "donor_id": appeal.donor_id,
        "priority_pool_restored": restored,
        "message": "Appeal verified and cleared." + (" Donor restored to the priority pool." if restored else ""),
    }


# ── helpers ──────────────────────────────────────────────────────────
async def _ping_to_acceptance(
    request_id: str, donor_id: str, accepted_at: datetime
) -> Optional[float]:
    """Seconds between this donor's ping for this request and their acceptance.

    This is the number the Varsity Node Leaderboard breaks a month-end tie on.
    The *earliest* ping is the one that counts: a donor who was pinged at 02:10
    and again when the ripple widened at 02:30 was reachable from 02:10, and
    measuring from the later ping would flatter both them and their campus.
    Returns None when no ping was logged — a request accepted straight from the
    dashboard has no ping to measure from, and guessing a number there would
    quietly corrupt the tie-break.
    """
    ping = await PingLog.find(
        PingLog.request_id == request_id,
        PingLog.donor_id == donor_id,
        PingLog.pinged == True,  # noqa: E712
    ).sort(PingLog.created_at).first_or_none()
    if ping is None:
        return None

    pinged_at = ping.created_at
    if pinged_at.tzinfo is None:          # Mongo hands datetimes back naive
        pinged_at = pinged_at.replace(tzinfo=accepted_at.tzinfo)
    return max(0.0, (accepted_at - pinged_at).total_seconds())


def _within_year(dt, now):
    """Compare tolerating naive/aware timestamps read back from Mongo."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=now.tzinfo)
    return dt > now - ONE_YEAR
