"""Feature 3 — Eligibility Cooldown & Auto-Pause Engine (HTTP layer).

This router is the web layer around `app/eligibility.py` (the pure rules). It
reads/writes the database and calls the engine to recalculate the single live
flag. Two audiences:

  Donor endpoints
    POST /donors/{id}/eligibility/login-recalc   recompute on every login
    PUT  /donors/{id}/eligibility/weight         save weight (rejects typos)
    POST /donors/{id}/eligibility/donation       record a donation → start lock
    GET  /donors/{id}/eligibility                current flag + countdown
    POST /donors/{id}/eligibility/certificate    upload a medical certificate

  Admin endpoints (JWT-protected, same pattern as the admin console)
    GET  /admin/eligibility/certificates         review queue
    POST /admin/eligibility/certificates/{id}/review   approve → early unlock

The corner cases from the spec both live here:
  • implausible weight → rejected, last valid weight kept, donor asked to fix it
  • locked-out-too-long → certificate upload → admin approves → cooldown cleared
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from ..models import Donor, Admin, EligibilityCertificate
from ..schemas import WeightUpdate, DonationRecord, CertificateUpload, CertificateReview
from ..security import get_current_admin
from ..services import to_oid, serialize
from .. import eligibility as engine

router = APIRouter()


# ── Small helpers ────────────────────────────────────────────────────
async def _get_donor(donor_id: str) -> Donor:
    donor = await Donor.get(to_oid(donor_id))
    if not donor:
        raise HTTPException(status_code=404, detail="Donor not found")
    return donor


def _parse_iso(value):
    """Parse an ISO date string to an aware datetime, or None if empty/bad."""
    if not value:
        return None
    try:
        # Accept a trailing 'Z' (UTC) which fromisoformat doesn't take directly.
        cleaned = value.replace("Z", "+00:00")
        dt = datetime.fromisoformat(cleaned)
        # Make sure it is timezone-aware (assume UTC if no offset was given).
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Bad date format: {value!r}")


def _apply_recalc(donor: Donor) -> dict:
    """Run the engine over a donor's stored facts and write the result back.

    Pseudocode:
        result = engine.recalculate(donor's weight, last donation, type)
        copy result flags onto donor.eligibility
        return result   (so the endpoint can show it to the caller)
    """
    e = donor.eligibility

    # If an admin has granted an early unlock, the cooldown lock is cleared:
    # we do that by treating the donation as if it has no active cooldown.
    if e.admin_unlocked:
        result = engine.recalculate(
            weight_kg=e.weight_kg,
            last_donation_date=None,        # cooldown cleared by admin
            donation_type=e.donation_type,
        )
    else:
        result = engine.recalculate(
            weight_kg=e.weight_kg,
            last_donation_date=e.last_donation_date,
            donation_type=e.donation_type,
        )

    # Copy the computed flags back onto the stored eligibility sub-document.
    e.eligible = result["eligible"]
    e.cooldown_locked = result["cooldown_locked"]
    e.weight_locked = result["weight_locked"]
    e.next_eligible_date = _parse_iso(result["next_eligible_date"])
    e.last_recalculated = engine.utcnow()
    return result


# ── Donor endpoints ──────────────────────────────────────────────────
@router.post("/donors/{donor_id}/eligibility/login-recalc", summary="Recalculate the flag on login")
async def login_recalc(donor_id: str):
    """Called every time the donor logs in. Recomputes the flag from stored
    facts (weight + last donation) and returns the fresh status."""
    donor = await _get_donor(donor_id)
    result = _apply_recalc(donor)
    await donor.save()
    return {"donor_id": str(donor.id), **result}


@router.get("/donors/{donor_id}/eligibility", summary="Current eligibility + countdown")
async def get_eligibility(donor_id: str):
    """Read-only view of the current flag. Also recomputes the countdown so the
    number is always fresh when the dashboard loads."""
    donor = await _get_donor(donor_id)
    result = _apply_recalc(donor)
    await donor.save()
    return {
        "donor_id": str(donor.id),
        "weight_kg": donor.eligibility.weight_kg,
        "donation_type": donor.eligibility.donation_type,
        "last_donation_date": (
            donor.eligibility.last_donation_date.isoformat()
            if donor.eligibility.last_donation_date else None
        ),
        "admin_unlocked": donor.eligibility.admin_unlocked,
        **result,
    }


@router.put("/donors/{donor_id}/eligibility/weight", summary="Update weight (rejects typos)")
async def update_weight(donor_id: str, body: WeightUpdate):
    """Corner case lives here: an implausible weight (e.g. 5 kg) is rejected,
    the last valid stored weight is kept, and the donor is asked to correct it."""
    donor = await _get_donor(donor_id)

    # Step 1: validate the number before storing anything.
    check = engine.validate_weight(body.weight_kg)
    if not check["ok"]:
        # Keep the last valid weight untouched and tell the donor to fix it.
        return {
            "donor_id": str(donor.id),
            "accepted": False,
            "reason": check["reason"],
            "kept_weight_kg": donor.eligibility.weight_kg,
        }

    # Step 2: the weight is believable — store it and recalculate the flag.
    donor.eligibility.weight_kg = check["weight"]
    result = _apply_recalc(donor)
    await donor.save()
    return {"donor_id": str(donor.id), "accepted": True, "weight_kg": check["weight"], **result}


@router.post("/donors/{donor_id}/eligibility/donation", summary="Record a donation → start cooldown")
async def record_donation(donor_id: str, body: DonationRecord):
    """Called after a donation. Stores the type + date, then recalculates so the
    cooldown lock (120 days whole blood, 14 days platelet) kicks in immediately."""
    donor = await _get_donor(donor_id)

    donation_type = body.donation_type.upper()
    if donation_type not in (engine.WHOLE_BLOOD, engine.PLATELET):
        raise HTTPException(status_code=400, detail="donation_type must be WHOLE_BLOOD or PLATELET")

    # Default the date to now if the caller didn't send one.
    donation_date = _parse_iso(body.donation_date) or engine.utcnow()

    donor.eligibility.donation_type = donation_type
    donor.eligibility.last_donation_date = donation_date
    # A fresh donation clears any previous admin early-unlock.
    donor.eligibility.admin_unlocked = False
    donor.eligibility.admin_unlocked_by = None
    donor.eligibility.admin_unlocked_at = None

    result = _apply_recalc(donor)
    await donor.save()
    return {"donor_id": str(donor.id), **result}


@router.post("/donors/{donor_id}/eligibility/certificate", summary="Upload a medical certificate")
async def upload_certificate(donor_id: str, body: CertificateUpload):
    """Corner case: locked out too long because of a mistyped date. The donor
    uploads a timestamped certificate that an admin will review to unlock early."""
    donor = await _get_donor(donor_id)
    cert = EligibilityCertificate(
        donor_id=str(donor.id),
        donor_name=donor.name,
        file_url=body.file_url,
        note=body.note,
        claimed_donation_date=_parse_iso(body.claimed_donation_date),
    )
    await cert.insert()
    return {
        "certificate_id": str(cert.id),
        "status": cert.status,
        "message": "Certificate uploaded — an admin will review it shortly.",
    }


# ── Admin endpoints (JWT-protected) ──────────────────────────────────
@router.get("/admin/eligibility/certificates", summary="Certificate review queue")
async def list_certificates(status: str | None = None, admin: Admin = Depends(get_current_admin)):
    """List uploaded certificates for admin review. Optional ?status=PENDING."""
    if status:
        query = EligibilityCertificate.find(EligibilityCertificate.status == status.upper())
    else:
        query = EligibilityCertificate.find_all()
    certs = await query.sort(-EligibilityCertificate.uploaded_at).to_list()
    return [serialize(c) for c in certs]


@router.post(
    "/admin/eligibility/certificates/{cert_id}/review",
    summary="Approve (early-unlock) or reject a certificate",
)
async def review_certificate(cert_id: str, body: CertificateReview, admin: Admin = Depends(get_current_admin)):
    """Admin decision on a certificate.

    APPROVE → clears the donor's cooldown early (optionally after fixing the
              mistyped donation date) and recalculates the flag.
    REJECT  → leaves the cooldown exactly as it was.
    """
    action = body.action.upper()
    if action not in ("APPROVE", "REJECT"):
        raise HTTPException(status_code=400, detail="action must be APPROVE or REJECT")

    cert = await EligibilityCertificate.get(to_oid(cert_id))
    if not cert:
        raise HTTPException(status_code=404, detail="Certificate not found")

    donor = await _get_donor(cert.donor_id)

    now = engine.utcnow()
    cert.status = "APPROVED" if action == "APPROVE" else "REJECTED"
    cert.reviewed_by = admin.email
    cert.reviewed_at = now
    cert.review_note = body.note

    if action == "APPROVE":
        # Option A: the admin supplies a corrected date → recompute from it.
        corrected = _parse_iso(body.corrected_donation_date) or cert.claimed_donation_date
        if corrected is not None:
            donor.eligibility.last_donation_date = corrected
            donor.eligibility.admin_unlocked = False   # normal recompute from fixed date
        else:
            # Option B: no corrected date → grant a straight early unlock.
            donor.eligibility.admin_unlocked = True
            donor.eligibility.admin_unlocked_by = admin.email
            donor.eligibility.admin_unlocked_at = now
        result = _apply_recalc(donor)
        await donor.save()
    else:
        # Rejected — flag stays as-is, but return its current state for context.
        result = _apply_recalc(donor)
        await donor.save()

    await cert.save()
    return {
        "certificate_id": str(cert.id),
        "status": cert.status,
        "donor_id": str(donor.id),
        "reviewed_by": admin.email,
        "eligibility": result,
        "message": (
            "Certificate approved — cooldown unlocked early."
            if action == "APPROVE" else
            "Certificate rejected — cooldown unchanged."
        ),
    }
