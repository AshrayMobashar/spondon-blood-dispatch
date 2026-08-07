"""Pydantic request-body schemas (the shapes Postman/clients POST/PUT)."""
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field, field_validator

PHONE_PATTERN = r"^01\d{9}$"      # Bangladeshi mobile, as typed without +880
HHMM_PATTERN = r"^([01]\d|2[0-3]):[0-5]\d$"   # 00:00–23:59, 24-hour


# ── Registration, Authentication & Profile ───────────────────────────
class HealthProfileIn(BaseModel):
    """Donor health-profiling step. Weight plausibility is enforced by the
    eligibility engine, which rejects a typo rather than storing it."""
    weight_kg: Optional[float] = Field(None, examples=[68.0])
    last_donation_date: Optional[datetime] = Field(None, examples=["2026-04-02T00:00:00Z"])
    last_donation_type: Optional[str] = Field(
        None, description="WHOLE_BLOOD | PLATELETS", examples=["WHOLE_BLOOD"]
    )


class PendingRequest(BaseModel):
    """Emergency details captured *before* the user was verified.

    Parked on the OTP challenge so a logged-out family never has to re-enter
    the hospital or blood details after verifying.
    """
    patient_name: str
    hospital: str
    blood_type: str
    component: str = "WHOLE_BLOOD"
    units: int = 1
    severity: str = "CRITICAL"
    road_segment: Optional[str] = None
    hospital_lat: Optional[float] = None
    hospital_lng: Optional[float] = None


class OtpRequest(BaseModel):
    phone: str = Field(..., pattern=PHONE_PATTERN, examples=["01711000001"])
    purpose: str = Field("LOGIN", description="LOGIN | REGISTER")
    pending_request: Optional[PendingRequest] = None


class OtpVerify(BaseModel):
    phone: str = Field(..., pattern=PHONE_PATTERN, examples=["01711000001"])
    code: str = Field(..., min_length=4, max_length=8, examples=["123456"])


class AccountRegister(BaseModel):
    """Completes sign-up for a phone already proven by OTP.

    Supply either `code` (an unused OTP) or `ticket` (the registration ticket
    handed back when verification succeeded but no account existed yet). The
    ticket path exists so a first-time user is not made to prove the same number
    twice — and so a second SMS is never sent for one sign-up.
    """
    phone: str = Field(..., pattern=PHONE_PATTERN, examples=["01711000005"])
    code: Optional[str] = Field(None, description="The OTP just received", examples=["123456"])
    ticket: Optional[str] = Field(None, description="Registration ticket from /auth/otp/verify")
    pending_request: Optional[PendingRequest] = Field(
        None, description="Emergency details captured before verification"
    )
    name: str = Field(..., examples=["Ashray Mobashar"])
    role: str = Field("donor", description="donor | patient")
    blood_type: str = Field(..., examples=["O+"])
    fcm_token: Optional[str] = None
    health: Optional[HealthProfileIn] = None


class WeightUpdate(BaseModel):
    weight_kg: float = Field(..., examples=[68.0])


class DonationRecord(BaseModel):
    """Logged after a donation — the event that arms the cooldown."""
    donation_type: str = Field(..., description="WHOLE_BLOOD | PLATELETS", examples=["PLATELETS"])
    donated_at: Optional[datetime] = Field(None, description="Defaults to now")


class HealthProfileUpdate(BaseModel):
    """Donor edits their own records. Any subset."""
    weight_kg: Optional[float] = None
    last_donation_date: Optional[datetime] = None
    last_donation_type: Optional[str] = Field(None, description="WHOLE_BLOOD | PLATELETS")


class CertificateCreate(BaseModel):
    """Appeal an over-long cooldown with a timestamped medical certificate."""
    note: Optional[str] = Field(None, examples=["Donation date was mistyped as January."])
    image: Optional[str] = Field(None, description="data: URI of the scanned certificate")
    issued_at: Optional[datetime] = Field(None, description="Timestamp printed on the document")
    corrected_donation_date: Optional[datetime] = None


class CertificateReview(BaseModel):
    action: str = Field(..., description="APPROVE | REJECT")
    note: Optional[str] = None


# ── Feature 1 — Smart Ping ───────────────────────────────────────────
class DonorCreate(BaseModel):
    name: str = Field(..., examples=["Rafiul Islam"])
    blood_type: str = Field(..., examples=["O+"])
    phone: Optional[str] = Field(None, examples=["01711000001"])
    fcm_token: Optional[str] = Field(None, examples=["fcm_rafiul_9f21"])
    health: Optional[HealthProfileIn] = None


class SleepModeUpdate(BaseModel):
    enabled: bool = True
    start: str = Field("23:00", pattern=HHMM_PATTERN, examples=["23:00"])
    end: str = Field("07:00", pattern=HHMM_PATTERN, examples=["07:00"])
    allow_extreme_emergencies: bool = False
    dnd_on: bool = False
    # start/end are matched against HHMM_PATTERN so a malformed "7am" or "25:99"
    # is rejected with a 422 at the boundary — never reaching the sleep-window
    # maths, where int("7am") would otherwise 500 the whole dispatch evaluation.


class RouteUpdate(BaseModel):
    segments: List[str] = Field(..., examples=[["Mirpur-Rd", "Kazipara", "Shewrapara"]])
    label: Optional[str] = Field(None, examples=["Home → Office"])
    enabled: bool = Field(
        True, description="Pause route-aware matching without discarding the saved segments"
    )

    @field_validator("segments")
    @classmethod
    def _non_empty_route(cls, v: List[str]) -> List[str]:
        """A saved route with no usable segment names cannot match anything, so
        it is a client error rather than a silently inert route."""
        if not any(s and s.strip() for s in v):
            raise ValueError("A commute route needs at least one non-blank road segment.")
        return v


class PingPreview(BaseModel):
    """Dry-run the ping decision for one donor against one open request."""
    request_id: str = Field(..., description="Id of the blood request to evaluate against")
    now: Optional[str] = Field(
        None, pattern=HHMM_PATTERN,
        description="HH:MM override for deterministically previewing the sleep window",
        examples=["23:30"],
    )


class LocationUpdate(BaseModel):
    lat: float = Field(..., examples=[23.8069])
    lng: float = Field(..., examples=[90.3687])
    road_segment: Optional[str] = Field(None, examples=["Kazipara"])


class EvaluateBody(BaseModel):
    request_id: str = Field(..., description="Id of an OPEN blood request to dispatch")
    now: Optional[str] = Field(
        None,
        description="HH:MM override for deterministic testing of the sleep window",
        examples=["23:30"],
    )


# ── Feature 2 — Concurrency & Accountability ─────────────────────────
class RequestCreate(BaseModel):
    patient_name: str = Field(..., examples=["Mehedi Hassan"])
    hospital: str = Field(..., examples=["Dhaka Medical College"])
    blood_type: str = Field(..., examples=["O+"])
    component: str = Field("WHOLE_BLOOD", description="WHOLE_BLOOD | PLATELETS | PLASMA")
    units: int = Field(1, ge=1, le=20)
    severity: str = Field("CRITICAL", examples=["LIFE_THREATENING"])
    road_segment: Optional[str] = Field(None, examples=["Kazipara"])
    hospital_lat: Optional[float] = Field(None, examples=[23.7261])
    hospital_lng: Optional[float] = Field(None, examples=[90.3969])
    requester_id: Optional[str] = Field(
        None, description="Ignored when an Authorization header is present"
    )


class SlipUpload(BaseModel):
    """The requisition-slip photo, submitted before any dispatch is authorised."""
    image: str = Field(..., description="data: URI or bare base64 of the slip photo")
    mime: str = Field("image/jpeg", examples=["image/jpeg"])


class AcceptBody(BaseModel):
    donor_id: str = Field(..., description="Donor tapping Accept")


class ArrivalBody(BaseModel):
    donor_id: str
    showed_up: bool = Field(..., examples=[False])


class AppealCreate(BaseModel):
    donor_id: str
    request_id: Optional[str] = None
    reason: str = Field(..., examples=["Road accident on the way to the hospital"])


class AppealResolve(BaseModel):
    action: str = Field("CLEAR", description="CLEAR | REJECT")
    admin: str = Field("admin", examples=["admin.sadia"])


# ── Admin console ────────────────────────────────────────────────────
class AdminLogin(BaseModel):
    email: str = Field(..., examples=["admin@spondon.com"])
    password: str = Field(..., examples=["spondon123"])


class SlipReview(BaseModel):
    action: str = Field(..., description="VERIFY | REJECT — override the OCR result")
    note: Optional[str] = Field(None, examples=["Slip legible; matches hospital records."])


class RequestPatch(BaseModel):
    """Admin edit of a blood request — any subset of fields."""
    patient_name: Optional[str] = None
    hospital: Optional[str] = None
    blood_type: Optional[str] = None
    component: Optional[str] = None
    units: Optional[int] = Field(None, ge=1, le=20)
    severity: Optional[str] = Field(None, description="NORMAL | CRITICAL | LIFE_THREATENING")
    status: Optional[str] = Field(None, description="OPEN | LOCKED | FULFILLED | NO_SHOW")
    broadcast: Optional[bool] = None


class EscalationResolve(BaseModel):
    action: str = Field(..., description="SOURCED | CLOSE")
    note: Optional[str] = None


class DonorModerate(BaseModel):
    action: str = Field(..., description="BAN | SHADOW_BAN | REINSTATE")
    reason: Optional[str] = Field(None, examples=["Repeated fake requests"])


class DonorPatch(BaseModel):
    name: Optional[str] = None
    blood_type: Optional[str] = None
    phone: Optional[str] = None
