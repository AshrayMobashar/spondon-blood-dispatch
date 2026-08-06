"""Common Workflow 1 — Registration, Authentication & Profile System.

Identity is a Bangladeshi mobile number proven by an SMS one-time code. There
are no passwords for end users.

The corner case this router exists to serve: someone opens the app mid-emergency
and starts typing hospital and blood details before they have an account. Those
details ride along on the OTP challenge (`pending_request`), and the moment the
code verifies, the request is created and dispatched in the same call — the
family never re-enters anything.

Codes are random server-side, stored only as a salted hash, single-use,
expiring, and attempt-limited.
"""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException

from .. import config, integrations
from ..dispatch import run_dispatch
from ..eligibility import recalculate, summary, weight_is_plausible
from ..models import (
    Account, BloodRequest, GeoPoint, HealthProfile, OtpChallenge,
    ROLE_DONOR, ROLE_PATIENT, BANNED, utcnow,
)
from ..schemas import AccountRegister, OtpRequest, OtpVerify
from ..security import (
    generate_otp, hash_otp, otp_matches, issue_user_token, get_current_account,
    issue_registration_ticket, phone_from_registration_ticket,
)
from ..services import serialize

router = APIRouter(prefix="/auth", tags=["Registration & Authentication"])


def _account_public(account: Account) -> dict:
    return {
        "id": str(account.id),
        "name": account.name,
        "role": account.role,
        "blood_type": account.blood_type,
        "phone": account.phone,
        "phone_verified": account.phone_verified,
        "status": account.status,
        # A shadow-banned user must see exactly what an ordinary user sees.
        "eligible": account.eligibility.eligible,
        # Where the client should land after signing in — a patient must never
        # be dropped on the donor dashboard.
        "home": "/donor/eligibility" if account.role == ROLE_DONOR else "/patient/ocr",
    }


async def _invalidate_outstanding(phone: str) -> None:
    """Only the newest code for a number is ever live."""
    await OtpChallenge.find(
        OtpChallenge.phone == phone, OtpChallenge.consumed == False  # noqa: E712
    ).set({"consumed": True})


# ── OTP ──────────────────────────────────────────────────────────────
@router.post("/otp/request", summary="Send a one-time code by SMS")
async def request_otp(body: OtpRequest):
    phone = body.phone.strip()
    account = await Account.find_one(Account.phone == phone)
    if account is not None and account.status == BANNED:
        # Do not hand a banned account a fresh code.
        raise HTTPException(
            status_code=403,
            detail={"message": "This account has been banned.", "reason": account.status_reason},
        )

    await _invalidate_outstanding(phone)
    code = generate_otp()
    challenge = OtpChallenge(
        phone=phone,
        code_hash=hash_otp(code, phone),
        purpose=body.purpose.upper(),
        pending_request=body.pending_request.model_dump(mode="json") if body.pending_request else None,
        expires_at=utcnow() + timedelta(seconds=config.OTP_TTL_SECONDS),
    )
    await challenge.insert()

    delivery = await integrations.send_sms(
        phone, f"Your Spondon verification code is {code}. It expires in "
               f"{config.OTP_TTL_SECONDS // 60} minutes."
    )

    out = {
        "phone": phone,
        "registered": account is not None,
        "expires_in_seconds": config.OTP_TTL_SECONDS,
        "captured_request": bool(challenge.pending_request),
        "delivery": delivery,
    }
    # Without a gateway the demo would be unusable, so the code comes back in
    # the response — and the flag says plainly that it did.
    if config.expose_otp():
        out["dev_code"] = code
        out["dev_note"] = "No SMS gateway configured — code returned for local testing only."
    return out


async def _consume(phone: str, code: str) -> OtpChallenge:
    """Validate a code and burn it. Raises 400/410/429 on failure."""
    challenge = await OtpChallenge.find(
        OtpChallenge.phone == phone, OtpChallenge.consumed == False  # noqa: E712
    ).sort(-OtpChallenge.created_at).first_or_none()

    if challenge is None:
        raise HTTPException(status_code=400, detail="No code was requested for this number.")

    expires = challenge.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=utcnow().tzinfo)
    if expires < utcnow():
        challenge.consumed = True
        await challenge.save()
        raise HTTPException(status_code=410, detail="That code has expired — request a new one.")

    if challenge.attempts >= config.OTP_MAX_ATTEMPTS:
        challenge.consumed = True
        await challenge.save()
        raise HTTPException(status_code=429, detail="Too many attempts — request a new code.")

    if not otp_matches(code, phone, challenge.code_hash):
        challenge.attempts += 1
        await challenge.save()
        remaining = max(0, config.OTP_MAX_ATTEMPTS - challenge.attempts)
        raise HTTPException(
            status_code=400,
            detail=f"Incorrect code. {remaining} attempt(s) remaining.",
        )

    challenge.consumed = True
    await challenge.save()
    return challenge


async def _fire_pending(pending: dict | None, account: Account) -> dict | None:
    """Create and dispatch the request captured before verification."""
    p = pending
    if not p:
        return None

    location = None
    if p.get("hospital_lat") is not None and p.get("hospital_lng") is not None:
        location = GeoPoint(lat=p["hospital_lat"], lng=p["hospital_lng"],
                            road_segment=p.get("road_segment"))
    req = BloodRequest(
        patient_name=p["patient_name"],
        hospital=p["hospital"],
        blood_type=p["blood_type"],
        component=p.get("component", "WHOLE_BLOOD"),
        units=p.get("units", 1),
        severity=p.get("severity", "CRITICAL"),
        road_segment=p.get("road_segment"),
        hospital_location=location,
        requester_id=str(account.id),
        requester_name=account.name,
        # A shadow-banned requester's ping is muted at birth — the request still
        # reads OPEN on their own screen.
        broadcast=account.status != "SHADOW_BANNED",
    )
    await req.insert()

    # The slip gate still applies: a dispatch is only authorised once the
    # doctor's slip is confirmed, so this reports why it is waiting.
    result = await run_dispatch(req)
    return {
        "request": serialize(req),
        "dispatch": result,
        "note": (
            "Emergency ping fired automatically — you never re-entered the details."
            if result["broadcast"] and result["pinged"] else
            "Request created from your captured details. "
            + (result["blocked_reason"] or "No eligible donor was in range yet.")
        ),
    }


@router.post("/otp/verify", summary="Verify a code → session token")
async def verify_otp(body: OtpVerify):
    """Log an existing user in. Unknown numbers are told to register."""
    phone = body.phone.strip()
    challenge = await _consume(phone, body.code)

    account = await Account.find_one(Account.phone == phone)
    if account is None:
        # Verified, but there is no account yet. A short-lived ticket carries
        # that proof to /auth/register, so the user is not asked for a second
        # code (and no second SMS is sent) just to finish signing up.
        return {
            "verified": True,
            "registered": False,
            "phone": phone,
            "registration_ticket": issue_registration_ticket(phone),
            "pending_request": challenge.pending_request,
            "message": "Number verified — complete registration to continue.",
        }

    account.phone_verified = True
    account.last_login_at = utcnow()
    # "Recalculated automatically … again on every login."
    recalculate(account)
    await account.save()

    return {
        "verified": True,
        "registered": True,
        "access_token": issue_user_token(account),
        "token_type": "bearer",
        "account": _account_public(account),
        "eligibility": summary(account) if account.is_donor else None,
        "auto_request": await _fire_pending(challenge.pending_request, account),
    }


# ── Registration ─────────────────────────────────────────────────────
@router.post("/register", status_code=201, summary="Create an account (phone already verified)")
async def register(body: AccountRegister):
    phone = body.phone.strip()
    role = body.role.lower()
    if role not in (ROLE_DONOR, ROLE_PATIENT):
        raise HTTPException(status_code=400, detail="role must be 'donor' or 'patient'")

    if await Account.find_one(Account.phone == phone) is not None:
        raise HTTPException(
            status_code=409, detail="An account already exists for this number — sign in instead."
        )

    # Proof of ownership: a ticket from a just-completed verification, or an
    # unused OTP. Never neither.
    pending = body.pending_request.model_dump(mode="json") if body.pending_request else None
    if body.ticket:
        if phone_from_registration_ticket(body.ticket) != phone:
            raise HTTPException(
                status_code=400, detail="That registration ticket is invalid or has expired."
            )
    elif body.code:
        challenge = await _consume(phone, body.code)
        pending = pending or challenge.pending_request
    else:
        raise HTTPException(
            status_code=400, detail="Provide either the OTP code or a registration ticket."
        )

    health = HealthProfile()
    if role == ROLE_DONOR and body.health:
        # An implausible weight is rejected outright rather than stored; at
        # sign-up there is no previous value to fall back to, so we ask again.
        if body.health.weight_kg is not None:
            if not weight_is_plausible(body.health.weight_kg):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"{body.health.weight_kg:g} kg is not a plausible weight. "
                        f"Please enter a value between {config.PLAUSIBLE_WEIGHT_MIN_KG:g} and "
                        f"{config.PLAUSIBLE_WEIGHT_MAX_KG:g} kg."
                    ),
                )
            health.weight_kg = body.health.weight_kg
            health.weight_updated_at = utcnow()
        health.last_donation_date = body.health.last_donation_date
        health.last_donation_type = (
            body.health.last_donation_type.upper() if body.health.last_donation_type else None
        )

    account = Account(
        name=body.name.strip(),
        role=role,
        blood_type=body.blood_type.strip().upper(),
        phone=phone,
        phone_verified=True,
        fcm_token=body.fcm_token,
        health=health,
        last_login_at=utcnow(),
    )
    recalculate(account)
    await account.insert()

    return {
        "access_token": issue_user_token(account),
        "token_type": "bearer",
        "account": _account_public(account),
        "eligibility": summary(account) if account.is_donor else None,
        "auto_request": await _fire_pending(pending, account),
    }


# ── Session ──────────────────────────────────────────────────────────
@router.get("/me", summary="The signed-in account")
async def me(account: Account = Depends(get_current_account)):
    return {
        "account": _account_public(account),
        "eligibility": summary(account) if account.is_donor else None,
    }
