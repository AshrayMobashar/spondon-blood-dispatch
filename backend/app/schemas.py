"""Pydantic request-body schemas (the shapes Postman/clients POST/PUT)."""
from datetime import datetime, timedelta, timezone
from typing import Optional, List
from pydantic import BaseModel, Field, field_validator

PHONE_PATTERN = r"^01\d{9}$"      # Bangladeshi mobile, as typed without +880
HHMM_PATTERN = r"^([01]\d|2[0-3]):[0-5]\d$"   # 00:00–23:59, 24-hour

# A donation is an event that has already happened, so a date in the future is
# not a valid record — it would arm a cooldown that only starts counting down
# later, or clear one that should still be locked. Small clock skew between a
# phone and the server is tolerated; anything beyond that is rejected.
FUTURE_DATE_TOLERANCE = timedelta(minutes=5)


def reject_future_date(value: Optional[datetime], label: str) -> Optional[datetime]:
    """Allow past and present datetimes only. `None` passes through untouched."""
    if value is None:
        return value
    moment = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    if moment > datetime.now(timezone.utc) + FUTURE_DATE_TOLERANCE:
        raise ValueError(f"{label} cannot be in the future — use today's date or earlier.")
    return value


# ── Registration, Authentication & Profile ───────────────────────────
class HealthProfileIn(BaseModel):
    """Donor health-profiling step. Weight plausibility is enforced by the
    eligibility engine, which rejects a typo rather than storing it."""
    weight_kg: Optional[float] = Field(None, examples=[68.0])
    last_donation_date: Optional[datetime] = Field(None, examples=["2026-04-02T00:00:00Z"])
    last_donation_type: Optional[str] = Field(
        None, description="WHOLE_BLOOD | PLATELETS", examples=["WHOLE_BLOOD"]
    )

    @field_validator("last_donation_date")
    @classmethod
    def _not_future(cls, v):
        return reject_future_date(v, "Last donation date")


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
    university: Optional[str] = Field(
        None,
        description="Campus this donor scores for on the Varsity Node Leaderboard. "
                    "Full name or short name; omit for a non-student.",
        examples=["BRAC University"],
    )
    fcm_token: Optional[str] = None
    health: Optional[HealthProfileIn] = None


class WeightUpdate(BaseModel):
    weight_kg: float = Field(..., examples=[68.0])


class DonationRecord(BaseModel):
    """Logged after a donation — the event that arms the cooldown."""
    donation_type: str = Field(..., description="WHOLE_BLOOD | PLATELETS", examples=["PLATELETS"])
    donated_at: Optional[datetime] = Field(
        None, description="Defaults to now. Must not be in the future."
    )

    @field_validator("donated_at")
    @classmethod
    def _not_future(cls, v):
        return reject_future_date(v, "Donation date")


class HealthProfileUpdate(BaseModel):
    """Donor edits their own records. Any subset."""
    weight_kg: Optional[float] = None
    last_donation_date: Optional[datetime] = Field(
        None, description="Past or present only — a donation cannot be dated ahead."
    )
    last_donation_type: Optional[str] = Field(None, description="WHOLE_BLOOD | PLATELETS")

    @field_validator("last_donation_date")
    @classmethod
    def _not_future(cls, v):
        return reject_future_date(v, "Last donation date")


class CertificateCreate(BaseModel):
    """Appeal an over-long cooldown with a timestamped medical certificate."""
    note: Optional[str] = Field(None, examples=["Donation date was mistyped as January."])
    image: Optional[str] = Field(None, description="data: URI of the scanned certificate")
    issued_at: Optional[datetime] = Field(None, description="Timestamp printed on the document")
    corrected_donation_date: Optional[datetime] = None

    @field_validator("issued_at")
    @classmethod
    def _issued_not_future(cls, v):
        return reject_future_date(v, "Certificate issue date")

    @field_validator("corrected_donation_date")
    @classmethod
    def _corrected_not_future(cls, v):
        return reject_future_date(v, "Corrected donation date")


class CertificateReview(BaseModel):
    action: str = Field(..., description="APPROVE | REJECT")
    note: Optional[str] = None

class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    university: Optional[str] = Field(
        None, description='Varsity node to score for; "" leaves the node.'
    )


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


class RoutePointIn(BaseModel):
    """A geo-located waypoint the donor dropped on their map."""
    lat: float = Field(..., examples=[23.8069])
    lng: float = Field(..., examples=[90.3687])
    name: Optional[str] = Field(None, examples=["Mirpur-Rd"])


class RouteUpdate(BaseModel):
    segments: List[str] = Field(..., examples=[["Mirpur-Rd", "Kazipara", "Shewrapara"]])
    points: Optional[List[RoutePointIn]] = Field(
        None,
        description="Optional map coordinates for the segments — drawing only, matching still uses names",
    )
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


class DeclineBody(BaseModel):
    donor_id: str = Field(..., description="Donor tapping Decline")


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


# ── Feature 3.1 — Live En-Route Tracker ──────────────────────────────
class TripPointIn(BaseModel):
    """One GPS fix from a donor already on the way.

    `recorded_at` is optional but matters: a phone that buffered fixes through a
    dead zone should send the time each was *measured*, so the server can order
    the flush correctly instead of drawing the trail in arrival order.
    """
    lat: float = Field(..., examples=[23.7806])
    lng: float = Field(..., examples=[90.4074])
    accuracy_m: Optional[float] = Field(None, examples=[12.0])
    speed_kmh: Optional[float] = Field(None, examples=[24.0])
    recorded_at: Optional[datetime] = Field(
        None, description="When the phone took the fix. Defaults to now."
    )


class TripBatchIn(BaseModel):
    """Fixes flushed together after a reconnect, oldest first."""
    points: List[TripPointIn] = Field(..., min_length=1)


# ── Feature 3.2 — Direct-Connect Masked Calling ──────────────────────
class CallFallbackIn(BaseModel):
    """Evidence that the VOIP leg is failing, sent when the client gives up on it.

    The measurements are recorded so a fallback is auditable rather than a
    mystery: a support question about why a call moved to GSM has an answer.
    """
    reason: str = Field(
        "POOR_NETWORK",
        description="POOR_NETWORK | NO_MEDIA | USER_REQUESTED",
        examples=["POOR_NETWORK"],
    )
    mos: Optional[float] = Field(
        None, ge=1.0, le=5.0, description="Measured call quality, ITU 1–5", examples=[1.9]
    )
    packet_loss_pct: Optional[float] = Field(None, ge=0.0, le=100.0, examples=[22.0])
    rtt_ms: Optional[float] = Field(None, ge=0.0, examples=[840.0])


class CallEndIn(BaseModel):
    reason: str = Field("COMPLETED", description="COMPLETED | CANCELLED", examples=["COMPLETED"])


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
