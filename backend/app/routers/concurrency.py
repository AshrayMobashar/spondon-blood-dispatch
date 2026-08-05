"""Feature 2 — Concurrency Lock & Flake-Out Accountability.

The first donor to tap Accept atomically locks the request ("Donor Secured" to
everyone else). No-shows are tracked: two within a single year quietly drop a
donor from the priority pool. Genuine no-shows can be appealed and cleared by an
admin.
"""
from datetime import timedelta

from fastapi import APIRouter, HTTPException
from pymongo import ReturnDocument

from ..db import get_collection
from ..models import Donor, BloodRequest, Appeal
from ..schemas import RequestCreate, AcceptBody, ArrivalBody, AppealCreate, AppealResolve
from ..services import to_oid, serialize, utcnow

router = APIRouter()

ONE_YEAR = timedelta(days=365)


async def _get_request(request_id: str) -> BloodRequest:
    req = await BloodRequest.get(to_oid(request_id))
    if not req:
        raise HTTPException(status_code=404, detail="Blood request not found")
    return req


async def _get_donor(donor_id: str) -> Donor:
    donor = await Donor.get(to_oid(donor_id))
    if not donor:
        raise HTTPException(status_code=404, detail="Donor not found")
    return donor


# ── Requests ─────────────────────────────────────────────────────────
@router.post("/requests", status_code=201, summary="Create a blood request (OPEN)")
async def create_request(body: RequestCreate):
    req = BloodRequest(
        patient_name=body.patient_name,
        hospital=body.hospital,
        blood_type=body.blood_type,
        severity=body.severity,
        road_segment=body.road_segment,
    )
    await req.insert()
    return serialize(req)


@router.get("/requests", summary="List blood requests")
async def list_requests():
    reqs = await BloodRequest.find_all().sort(-BloodRequest.created_at).to_list()
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

    collection = get_collection(BloodRequest)
    updated = await collection.find_one_and_update(
        {"_id": oid, "status": "OPEN"},              # compare
        {"$set": {                                   # ...and swap, atomically
            "status": "LOCKED",
            "secured_donor_id": str(donor.id),
            "secured_donor_name": donor.name,
            "secured_at": utcnow(),
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

    return {
        "message": "You've secured this request",
        "request_id": str(updated["_id"]),
        "status": "LOCKED",
        "secured_donor_id": updated["secured_donor_id"],
        "secured_donor_name": updated["secured_donor_name"],
        "secured_at": updated["secured_at"].isoformat(),
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
        req.status = "FULFILLED"
        await req.save()
        return {
            "request_id": str(req.id),
            "donor_id": str(donor.id),
            "status": "FULFILLED",
            "message": "Donor showed up — request fulfilled.",
        }

    # No-show → record it and apply the 2-in-a-year rule.
    now = utcnow()
    req.status = "NO_SHOW"
    await req.save()

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

    donor = await Donor.get(to_oid(appeal.donor_id))
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
def _within_year(dt, now):
    """Compare tolerating naive/aware timestamps read back from Mongo."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=now.tzinfo)
    return dt > now - ONE_YEAR
