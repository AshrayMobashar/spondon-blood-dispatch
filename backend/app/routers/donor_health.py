"""Module 1, Feature 1 — the donor-facing half of the eligibility engine.

Health records in, eligibility out. Every write here ends with a call to
`eligibility.recalculate`, which is the only thing that ever sets the flag.

Two corner cases live in this file:

  * An implausible weight (5 kg for 50) is rejected with a 400 and the donor's
    last valid weight stays exactly as it was — the bad value is never written,
    so it can never lock anyone out.
  * A donor locked out by a mistyped donation date uploads a timestamped medical
    certificate; an admin approving it waives the cooldown early (see the admin
    router for the review side).
"""
from fastapi import APIRouter, Depends, HTTPException

from .. import config
from ..eligibility import recalculate, snapshot, summary, weight_is_plausible
from ..models import Account, MedicalCertificate, ROLE_DONOR, utcnow
from ..schemas import (
    CertificateCreate, DonationRecord, HealthProfileUpdate, WeightUpdate,
)
from ..security import get_current_account
from ..services import serialize, to_oid

router = APIRouter(tags=["Module 1.1 — Eligibility Cooldown & Auto-Pause"])


async def _get_donor(donor_id: str) -> Account:
    donor = await Account.get(to_oid(donor_id))
    if not donor:
        raise HTTPException(status_code=404, detail="Donor not found")
    return donor


def _reject_implausible(kg: float) -> None:
    if weight_is_plausible(kg):
        return
    raise HTTPException(
        status_code=400,
        detail={
            "message": (
                f"{kg:g} kg is not a plausible weight — your saved weight was left unchanged. "
                "Please correct it."
            ),
            "field": "weight_kg",
            "min_kg": config.PLAUSIBLE_WEIGHT_MIN_KG,
            "max_kg": config.PLAUSIBLE_WEIGHT_MAX_KG,
        },
    )


# ── Eligibility ──────────────────────────────────────────────────────
@router.get("/donors/{donor_id}/eligibility", summary="Live eligibility flag + countdown")
async def get_eligibility(donor_id: str):
    """Recalculated on read, so a cooldown that has just expired shows as clear
    without waiting for the donor's next login."""
    donor = await _get_donor(donor_id)
    before = snapshot(donor)
    recalculate(donor)
    if snapshot(donor) != before:
        await donor.save()
    return summary(donor)


@router.get("/me/eligibility", summary="Signed-in donor's eligibility")
async def my_eligibility(account: Account = Depends(get_current_account)):
    if account.role != ROLE_DONOR:
        raise HTTPException(status_code=400, detail="This account is not a donor.")
    recalculate(account)
    await account.save()
    return summary(account)


# ── Health records ───────────────────────────────────────────────────
@router.get("/donors/{donor_id}/health", summary="Donor health profile")
async def get_health(donor_id: str):
    donor = await _get_donor(donor_id)
    return {"donor_id": str(donor.id), "health": donor.health.model_dump(mode="json")}


@router.put("/donors/{donor_id}/weight", summary="Update weight (rejects implausible values)")
async def update_weight(donor_id: str, body: WeightUpdate):
    donor = await _get_donor(donor_id)
    _reject_implausible(body.weight_kg)      # raises before anything is written

    donor.health.weight_kg = body.weight_kg
    donor.health.weight_updated_at = utcnow()
    recalculate(donor)
    await donor.save()
    return {
        "donor_id": str(donor.id),
        "weight_kg": donor.health.weight_kg,
        "message": (
            "Weight saved."
            if not donor.eligibility.underweight else
            f"Weight saved, but it is below the {config.MIN_DONOR_WEIGHT_KG:g} kg medical "
            "minimum — your eligibility flag is locked."
        ),
        "eligibility": summary(donor),
    }


@router.patch("/donors/{donor_id}/health", summary="Update health records")
async def update_health(donor_id: str, body: HealthProfileUpdate):
    """Edit any subset. A rejected weight leaves the *whole* update unapplied,
    so a donor never half-saves a form."""
    donor = await _get_donor(donor_id)
    changes = body.model_dump(exclude_unset=True)

    if "weight_kg" in changes and changes["weight_kg"] is not None:
        _reject_implausible(changes["weight_kg"])
        donor.health.weight_kg = changes["weight_kg"]
        donor.health.weight_updated_at = utcnow()
    if "last_donation_date" in changes:
        donor.health.last_donation_date = changes["last_donation_date"]
    if "last_donation_type" in changes and changes["last_donation_type"]:
        kind = changes["last_donation_type"].upper()
        if kind not in config.COOLDOWN_DAYS:
            raise HTTPException(
                status_code=400, detail="last_donation_type must be WHOLE_BLOOD or PLATELETS"
            )
        donor.health.last_donation_type = kind

    recalculate(donor)
    await donor.save()
    return {
        "donor_id": str(donor.id),
        "message": "Records updated and eligibility recalculated.",
        "eligibility": summary(donor),
    }


@router.post("/donors/{donor_id}/donations", status_code=201, summary="Record a donation")
async def record_donation(donor_id: str, body: DonationRecord):
    """Logging a donation is what arms the cooldown: 120 days for whole blood,
    14 for platelets."""
    kind = body.donation_type.upper()
    if kind not in config.COOLDOWN_DAYS:
        raise HTTPException(
            status_code=400, detail="donation_type must be WHOLE_BLOOD or PLATELETS"
        )
    donor = await _get_donor(donor_id)
    donor.health.last_donation_date = body.donated_at or utcnow()
    donor.health.last_donation_type = kind
    donor.health.donation_count += 1
    # A fresh donation supersedes any earlier waiver.
    donor.eligibility.cooldown_waived_at = None
    donor.eligibility.cooldown_waived_by = None
    recalculate(donor)
    await donor.save()
    return {
        "donor_id": str(donor.id),
        "donation_type": kind,
        "cooldown_days": config.COOLDOWN_DAYS[kind],
        "message": f"Donation recorded — eligibility locked for {config.COOLDOWN_DAYS[kind]} days.",
        "eligibility": summary(donor),
    }


# ── Medical certificates (early cooldown release) ────────────────────
@router.post("/donors/{donor_id}/certificates", status_code=201,
             summary="Upload a certificate to appeal a cooldown")
async def upload_certificate(donor_id: str, body: CertificateCreate):
    donor = await _get_donor(donor_id)
    cert = MedicalCertificate(
        donor_id=str(donor.id),
        donor_name=donor.name,
        note=body.note,
        image=body.image,
        issued_at=body.issued_at,
        corrected_donation_date=body.corrected_donation_date,
    )
    await cert.insert()
    return {
        **serialize(cert),
        "message": "Certificate submitted — an admin will review it.",
    }


@router.get("/donors/{donor_id}/certificates", summary="A donor's certificate submissions")
async def list_certificates(donor_id: str):
    certs = await MedicalCertificate.find(
        MedicalCertificate.donor_id == donor_id
    ).sort(-MedicalCertificate.created_at).to_list()
    return [serialize(c) for c in certs]

from ..schemas import VehicleUpdate

@router.patch("/donors/{donor_id}/vehicle", summary="Update registered vehicle")
async def update_vehicle(donor_id: str, body: VehicleUpdate):
    donor = await _get_donor(donor_id)
    donor.vehicle_type = body.vehicle_type.lower()
    if donor.vehicle_type not in ["none", "bike", "car"]:
        raise HTTPException(status_code=400, detail="vehicle_type must be none, bike, or car")
    await donor.save()
    return {"status": "ok", "vehicle_type": donor.vehicle_type}
