"""Admin Role & Access Management — the administration body's console.

An authorized administrator signs in (JWT) to a dedicated, secure panel where
they can:
  • review every active emergency ripple across the city   (GET  /admin/requests)
  • modify any request directly in the database             (PATCH/DELETE)
  • manually override slip verifications OCR could not confirm (POST /requests/{id}/slip)
  • ban accounts that abuse the system                      (POST /donors/{id}/moderate → BAN)

Corner case — SHADOW BAN: a flagged user keeps submitting requests that still
appear OPEN/active on their own screen, but those requests carry broadcast=False
and are therefore never actually pushed to the donor network. Placing a shadow
ban also retro-mutes the account's currently-open requests.
"""
from fastapi import APIRouter, Depends, HTTPException

from .. import integrations
from ..eligibility import recalculate
from ..models import (
    Account, BloodRequest, Appeal, Admin, Escalation, MedicalCertificate,
    ACTIVE, BANNED, SHADOW_BANNED,
)
from ..schemas import (
    AdminLogin, SlipReview, RequestPatch, DonorModerate, DonorPatch,
    CertificateReview, EscalationResolve,
)
from ..security import verify_password, create_access_token, get_current_admin
from ..services import to_oid, serialize, utcnow

# Kept as an alias so the rest of this module reads the way admins think about
# it — accounts under moderation.
Donor = Account

router = APIRouter(prefix="/admin", tags=["Admin — Role & Access Management"])


# ── Auth ─────────────────────────────────────────────────────────────
@router.post("/login", summary="Admin sign-in → JWT bearer token")
async def login(body: AdminLogin):
    admin = await Admin.find_one(Admin.email == body.email.lower().strip())
    if admin is None or not verify_password(body.password, admin.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(admin)
    return {
        "access_token": token,
        "token_type": "bearer",
        "admin": {"id": str(admin.id), "email": admin.email, "name": admin.name, "role": admin.role},
    }


@router.get("/me", summary="Current signed-in admin")
async def me(admin: Admin = Depends(get_current_admin)):
    return {"id": str(admin.id), "email": admin.email, "name": admin.name, "role": admin.role}


# ── Dashboard overview ───────────────────────────────────────────────
@router.get("/overview", summary="At-a-glance counts for the console")
async def overview(admin: Admin = Depends(get_current_admin)):
    requests = await BloodRequest.find_all().to_list()
    donors = await Donor.find_all().to_list()
    pending_appeals = await Appeal.find(Appeal.status == "PENDING").count()

    pending_certs = await MedicalCertificate.find(
        MedicalCertificate.status == "PENDING"
    ).count()
    open_escalations = await Escalation.find(Escalation.status == "OPEN").count()

    active_ripples = [r for r in requests if r.status in ("OPEN", "LOCKED")]
    return {
        "requests_total": len(requests),
        "active_ripples": len(active_ripples),
        "muted_ripples": len([r for r in active_ripples if not r.broadcast]),
        "slips_needs_review": len([r for r in requests if r.slip_status in ("NEEDS_REVIEW", "PENDING")]),
        "donors_total": len(donors),
        "banned": len([d for d in donors if d.status == BANNED]),
        "shadow_banned": len([d for d in donors if d.status == SHADOW_BANNED]),
        "ineligible_donors": len([d for d in donors if d.is_donor and not d.eligibility.eligible]),
        "appeals_pending": pending_appeals,
        "certificates_pending": pending_certs,
        "escalations_open": open_escalations,
        # So the console can say plainly which integrations are live and which
        # are standing in.
        "integrations": integrations.integration_status(),
    }


# ── Emergency ripples (blood requests) ───────────────────────────────
@router.get("/requests", summary="Every emergency ripple across the city")
async def list_requests(admin: Admin = Depends(get_current_admin)):
    reqs = await BloodRequest.find_all().sort(-BloodRequest.created_at).to_list()
    return [serialize(r) for r in reqs]


@router.patch("/requests/{request_id}", summary="Modify a request in the database")
async def patch_request(request_id: str, body: RequestPatch, admin: Admin = Depends(get_current_admin)):
    req = await BloodRequest.get(to_oid(request_id))
    if not req:
        raise HTTPException(status_code=404, detail="Blood request not found")
    changes = body.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(req, field, value)
    await req.save()
    return serialize(req)


@router.delete("/requests/{request_id}", summary="Remove a request")
async def delete_request(request_id: str, admin: Admin = Depends(get_current_admin)):
    req = await BloodRequest.get(to_oid(request_id))
    if not req:
        raise HTTPException(status_code=404, detail="Blood request not found")
    await req.delete()
    return {"deleted": request_id}


@router.post("/requests/{request_id}/slip", summary="Override OCR slip verification")
async def review_slip(request_id: str, body: SlipReview, admin: Admin = Depends(get_current_admin)):
    """Manually confirm or reject a doctor's slip the OCR engine couldn't verify."""
    action = body.action.upper()
    if action not in ("VERIFY", "REJECT"):
        raise HTTPException(status_code=400, detail="action must be VERIFY or REJECT")

    req = await BloodRequest.get(to_oid(request_id))
    if not req:
        raise HTTPException(status_code=404, detail="Blood request not found")

    req.slip_status = "VERIFIED" if action == "VERIFY" else "REJECTED"
    req.slip_reviewed_by = admin.email
    req.slip_reviewed_at = utcnow()
    # A rejected slip pulls the request out of the active donor network.
    if action == "REJECT":
        req.status = "NO_SHOW"
        req.broadcast = False
    await req.save()
    return {
        "request_id": str(req.id),
        "slip_status": req.slip_status,
        "reviewed_by": admin.email,
        "message": f"Slip {req.slip_status.lower()} by admin override.",
    }


# ── Accounts (donors) ────────────────────────────────────────────────
@router.get("/donors", summary="All accounts with moderation status")
async def list_donors(admin: Admin = Depends(get_current_admin)):
    donors = await Donor.find_all().sort(-Donor.created_at).to_list()
    return [serialize(d) for d in donors]


@router.patch("/donors/{donor_id}", summary="Edit an account's profile")
async def patch_donor(donor_id: str, body: DonorPatch, admin: Admin = Depends(get_current_admin)):
    donor = await Donor.get(to_oid(donor_id))
    if not donor:
        raise HTTPException(status_code=404, detail="Donor not found")
    changes = body.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(donor, field, value)
    await donor.save()
    return serialize(donor)


# ── Medical certificates (early cooldown release) ────────────────────
@router.get("/certificates", summary="Certificates awaiting review")
async def list_certificates(status: str | None = None, admin: Admin = Depends(get_current_admin)):
    query = (
        MedicalCertificate.find(MedicalCertificate.status == status.upper())
        if status else MedicalCertificate.find_all()
    )
    certs = await query.sort(-MedicalCertificate.created_at).to_list()
    return [serialize(c) for c in certs]


@router.post("/certificates/{certificate_id}/review", summary="Approve or reject a certificate")
async def review_certificate(
    certificate_id: str, body: CertificateReview, admin: Admin = Depends(get_current_admin)
):
    """Approving waives the cooldown early.

    This is the fix for a donor locked out for months by a mistyped donation
    date. If the certificate carries the corrected date we write that and let
    the engine recompute normally — which may clear the lock outright. Otherwise
    we waive the current cooldown, which is narrower than editing history: a
    later donation starts a fresh lock regardless.
    """
    action = body.action.upper()
    if action not in ("APPROVE", "REJECT"):
        raise HTTPException(status_code=400, detail="action must be APPROVE or REJECT")

    cert = await MedicalCertificate.get(to_oid(certificate_id))
    if not cert:
        raise HTTPException(status_code=404, detail="Certificate not found")
    if cert.status != "PENDING":
        raise HTTPException(status_code=400, detail=f"Certificate already {cert.status}")

    now = utcnow()
    cert.status = "APPROVED" if action == "APPROVE" else "REJECTED"
    cert.reviewed_by = admin.email
    cert.reviewed_at = now
    cert.review_note = body.note
    await cert.save()

    donor = await Donor.get(to_oid(cert.donor_id))
    if donor is None:
        return {"certificate_id": str(cert.id), "status": cert.status,
                "message": "Certificate resolved, but the account no longer exists."}

    if action == "APPROVE":
        if cert.corrected_donation_date is not None:
            donor.health.last_donation_date = cert.corrected_donation_date
        else:
            donor.eligibility.cooldown_waived_at = now
            donor.eligibility.cooldown_waived_by = admin.email
        recalculate(donor, now=now)
        await donor.save()

    return {
        "certificate_id": str(cert.id),
        "status": cert.status,
        "donor_id": str(donor.id),
        "eligible": donor.eligibility.eligible,
        "reasons": donor.eligibility.reasons,
        "message": (
            "Certificate approved — cooldown released early."
            if action == "APPROVE" else "Certificate rejected — cooldown stands."
        ),
    }


# ── Appeals ──────────────────────────────────────────────────────────
@router.get("/appeals", summary="Appeals awaiting review")
async def list_appeals(status: str | None = None, admin: Admin = Depends(get_current_admin)):
    query = (
        Appeal.find(Appeal.status == status.upper())
        if status else Appeal.find_all()
    )
    appeals = await query.sort(-Appeal.created_at).to_list()
    return [serialize(a) for a in appeals]


# ── Rare-blood escalations ───────────────────────────────────────────
@router.get("/escalations", summary="Requests handed to blood banks / NGO hotlines")
async def list_escalations(admin: Admin = Depends(get_current_admin)):
    escs = await Escalation.find_all().sort(-Escalation.created_at).to_list()
    return [serialize(e) for e in escs]


@router.post("/escalations/{escalation_id}/resolve", summary="Close out an escalation")
async def resolve_escalation(
    escalation_id: str, body: EscalationResolve, admin: Admin = Depends(get_current_admin)
):
    action = body.action.upper()
    if action not in ("SOURCED", "CLOSE"):
        raise HTTPException(status_code=400, detail="action must be SOURCED or CLOSE")
    esc = await Escalation.get(to_oid(escalation_id))
    if not esc:
        raise HTTPException(status_code=404, detail="Escalation not found")
    esc.status = "SOURCED" if action == "SOURCED" else "CLOSED"
    esc.resolved_by = admin.email
    esc.resolved_at = utcnow()
    await esc.save()
    return serialize(esc)


@router.post("/donors/{donor_id}/moderate", summary="Ban, shadow-ban, or reinstate an account")
async def moderate_donor(donor_id: str, body: DonorModerate, admin: Admin = Depends(get_current_admin)):
    action = body.action.upper()
    if action not in ("BAN", "SHADOW_BAN", "REINSTATE"):
        raise HTTPException(status_code=400, detail="action must be BAN, SHADOW_BAN or REINSTATE")

    donor = await Donor.get(to_oid(donor_id))
    if not donor:
        raise HTTPException(status_code=404, detail="Donor not found")

    now = utcnow()
    donor.status = {"BAN": BANNED, "SHADOW_BAN": SHADOW_BANNED, "REINSTATE": ACTIVE}[action]
    donor.status_reason = None if action == "REINSTATE" else body.reason
    donor.status_by = None if action == "REINSTATE" else admin.email
    donor.status_at = None if action == "REINSTATE" else now
    await donor.save()

    # Propagate the moderation to this account's open requests.
    open_reqs = await BloodRequest.find(
        BloodRequest.requester_id == str(donor.id),
        BloodRequest.status == "OPEN",
    ).to_list()
    affected = 0
    for req in open_reqs:
        if action == "SHADOW_BAN":
            # Still OPEN (looks active to the user) but silently un-broadcast.
            req.broadcast = False
        elif action == "BAN":
            req.broadcast = False
        else:  # REINSTATE
            req.broadcast = True
        await req.save()
        affected += 1

    messages = {
        "BAN": "Account banned — blocked from the system.",
        "SHADOW_BAN": "Shadow ban placed — requests still show active to the user but are never broadcast to donors.",
        "REINSTATE": "Account reinstated to good standing.",
    }
    return {
        "donor_id": str(donor.id),
        "status": donor.status,
        "requests_affected": affected,
        "message": messages[action],
    }
