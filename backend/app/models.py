"""Beanie (async MongoDB ODM) document models for the Spondon backend.

Collections, by the feature that owns them:
  Common     - Account (registration/OTP identity), OtpChallenge
  Module 1.1 - Account.health + Account.eligibility, MedicalCertificate
  Module 1.2 - Account.sleep_mode / commute_route / current_location, PingLog
  Module 1.3 - BloodRequest.dispatch_mode, Escalation
  Module 2.1 - BloodRequest.hospital_location (expanding geo-ripple)
  Module 2.2 - BloodRequest lock fields, Account.reliability, Appeal
  Module 2.3 - BloodRequest slip_* fields (doctor's-slip OCR)
  Admin      - Admin, Account.status (ban / shadow ban)
"""
from datetime import datetime, timezone
from typing import Optional, List

from beanie import Document
from pydantic import BaseModel, Field


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ── Embedded sub-documents ───────────────────────────────────────────
class SleepMode(BaseModel):
    enabled: bool = False
    start: str = "23:00"                 # HH:MM, 24h — window start
    end: str = "07:00"                   # HH:MM — window end (may cross midnight)
    allow_extreme_emergencies: bool = False   # "wake me for emergencies" box
    dnd_on: bool = False                 # phone OS Do-Not-Disturb currently on


class RoutePoint(BaseModel):
    """A waypoint the donor dropped when drawing their commute on the map.

    Purely for redrawing the line: matching still runs on the segment *names*
    (see `services.seg_key`), because a request carries a road name rather than
    a coordinate. Keeping the two apart means a donor who drags a pin slightly
    does not silently stop matching the road they typed.
    """
    lat: float
    lng: float
    name: Optional[str] = None


class CommuteRoute(BaseModel):
    """The donor's saved daily route.

    `enabled` is a pause switch, not a delete: a donor who turns commute
    matching off keeps their segments and can turn it back on without retyping
    the route. Clearing the route entirely is a separate action.
    """
    segments: List[str] = []             # named road segments on the daily route
    points: List[RoutePoint] = []        # optional map coordinates for those segments
    label: Optional[str] = None
    enabled: bool = True                 # route-aware matching on/off
    saved_at: datetime = Field(default_factory=utcnow)


class GeoPoint(BaseModel):
    lat: float
    lng: float
    road_segment: Optional[str] = None   # road segment the donor is on right now
    updated_at: datetime = Field(default_factory=utcnow)


class TripPoint(BaseModel):
    """One GPS fix reported by a donor already travelling to the hospital.

    Two clocks, deliberately: `recorded_at` is when the donor's phone took the
    fix, `received_at` is when the server heard about it. They are the same
    thing only while the connection holds — a phone that buffers fixes through a
    tunnel and flushes them on reconnect has to be replayed in the order it
    *measured* them, not the order they arrived, or the trail zig-zags backwards.
    """
    lat: float
    lng: float
    accuracy_m: Optional[float] = None
    speed_kmh: Optional[float] = None
    recorded_at: datetime = Field(default_factory=utcnow)
    received_at: datetime = Field(default_factory=utcnow)


# Trip lifecycle.
TRIP_EN_ROUTE = "EN_ROUTE"
TRIP_ARRIVED = "ARRIVED"
TRIP_CANCELLED = "CANCELLED"

# What the family's tracker is allowed to claim about the donor icon.
SIGNAL_LIVE = "LIVE"
SIGNAL_LOST = "SIGNAL_LOST"


class Trip(BaseModel):
    """The donor's journey to the hospital — what the family's live tracker draws.

    Everything here is *last known*, never extrapolated. When the donor's phone
    drops off the network the icon stops where it was and the ETA stops
    counting: an invented position is worse than an admitted gap, because a
    family who trusts a moving dot stops calling and starts waiting.
    """
    status: str = TRIP_EN_ROUTE
    started_at: datetime = Field(default_factory=utcnow)
    # Last *accepted* fix. A rejected one (implausible jump, out-of-order
    # replay) must not move the icon or refresh the freshness clock.
    last_point: Optional[TripPoint] = None
    last_seen_at: Optional[datetime] = None
    trail: List[TripPoint] = []
    updates: int = 0
    rejected_updates: int = 0
    # Distance/ETA as computed at `eta_computed_at` — held, not aged.
    distance_km: Optional[float] = None
    eta_minutes: Optional[float] = None
    eta_computed_at: Optional[datetime] = None
    speed_kmh: Optional[float] = None
    distance_source: Optional[str] = None      # driving | straight-line
    # Set when the sweep first notices the silence, cleared on reconnect. Its
    # presence is what turns the family's ETA orange.
    signal_lost_at: Optional[datetime] = None
    signal_drops: int = 0
    arrived_at: Optional[datetime] = None


class Reliability(BaseModel):
    no_show_count: int = 0               # lifetime, informational
    no_show_dates: List[datetime] = []   # timestamps — used for the 1-year rule
    in_priority_pool: bool = True
    removed_at: Optional[datetime] = None


class HealthProfile(BaseModel):
    """Captured at donor sign-up and editable afterwards.

    `weight_kg` only ever holds a *plausible* value: an implausible entry (a
    mistyped 5 kg) is rejected by the API and the previous value is kept.
    """
    weight_kg: Optional[float] = None
    weight_updated_at: Optional[datetime] = None
    last_donation_date: Optional[datetime] = None
    last_donation_type: Optional[str] = None     # WHOLE_BLOOD | PLATELETS
    donation_count: int = 0


class Eligibility(BaseModel):
    """The single live eligibility flag, recomputed by app.eligibility.

    Never edited by hand — `recalculate()` is the only writer, so the flag and
    the reasons behind it can never disagree.
    """
    eligible: bool = True
    reasons: List[str] = []                      # human-readable lock reasons
    cooldown_until: Optional[datetime] = None    # from the last donation
    cooldown_source: Optional[str] = None        # WHOLE_BLOOD | PLATELETS
    underweight: bool = False                    # independent medical-risk lock
    cooldown_waived_at: Optional[datetime] = None   # admin cleared it early
    cooldown_waived_by: Optional[str] = None
    recalculated_at: Optional[datetime] = None


# Account moderation states set by an admin (see admin router).
ACTIVE = "ACTIVE"
BANNED = "BANNED"              # account blocked outright — cannot use the system
SHADOW_BANNED = "SHADOW_BANNED"  # requests look active to the user but never broadcast

# Account roles.
ROLE_DONOR = "donor"
ROLE_PATIENT = "patient"


# ── Collections ──────────────────────────────────────────────────────
class Account(Document):
    """A registered end user — donor or patient/family.

    Both roles share one collection because they share one identity (a verified
    Bangladeshi phone number), one moderation model, and one login. Only donors
    carry health/eligibility/ping settings; a patient's stay at their defaults.

    Kept under the `donors` collection name, and aliased as `Donor` below, so
    existing data, endpoints and the Postman collection keep working.
    """
    name: str
    blood_type: str
    role: str = ROLE_DONOR                # donor | patient
    phone: Optional[str] = None
    phone_verified: bool = False
    fcm_token: Optional[str] = None
    # ── Module 1.1 — eligibility ──
    health: HealthProfile = Field(default_factory=HealthProfile)
    eligibility: Eligibility = Field(default_factory=Eligibility)
    # ── Module 1.2 — smart ping ──
    sleep_mode: SleepMode = Field(default_factory=SleepMode)
    commute_route: Optional[CommuteRoute] = None
    current_location: Optional[GeoPoint] = None
    vehicle_type: str = "none"            # none | bike | car (for ride bounty)
    # ── Module 2.2 — accountability ──
    reliability: Reliability = Field(default_factory=Reliability)
    # ── Account moderation (admin-controlled) ──
    status: str = ACTIVE                  # ACTIVE | BANNED | SHADOW_BANNED
    status_reason: Optional[str] = None
    status_by: Optional[str] = None       # admin username who set it
    status_at: Optional[datetime] = None
    flagged_fake_requests: int = 0        # abuse counter shown to admins
    last_login_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)

    @property
    def is_donor(self) -> bool:
        return self.role == ROLE_DONOR

    class Settings:
        name = "donors"


# Backwards-compatible alias — the same class, under its original name.
Donor = Account

# Ride Bounty states
BOUNTY_OPEN = "OPEN"
BOUNTY_ACCEPTED = "ACCEPTED"
BOUNTY_PROMO_GENERATED = "PROMO_GENERATED"

class RideBounty(Document):
    """A community bounty generated when a donor completes a platelet donation.
    Alerts nearby drivers to offer a free ride home. If no one accepts within
    15 minutes, a digital promo code is automatically generated."""
    request_id: str
    donor_id: str
    donor_name: str
    hospital: str
    hospital_location: GeoPoint
    status: str = BOUNTY_OPEN
    driver_id: Optional[str] = None
    driver_name: Optional[str] = None
    promo_code: Optional[str] = None
    accepted_at: Optional[datetime] = None
    expires_at: datetime
    created_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "ride_bounties"


class BloodRequest(Document):
    patient_name: str
    hospital: str
    blood_type: str
    component: str = "WHOLE_BLOOD"       # WHOLE_BLOOD | PLATELETS | PLASMA
    units: int = 1
    severity: str = "NORMAL"             # NORMAL | CRITICAL | LIFE_THREATENING
    road_segment: Optional[str] = None   # road segment the request sits on
    hospital_location: Optional[GeoPoint] = None   # drives the expanding ripple
    status: str = "OPEN"                 # OPEN | LOCKED | FULFILLED | NO_SHOW
    secured_donor_id: Optional[str] = None
    secured_donor_name: Optional[str] = None
    secured_at: Optional[datetime] = None
    # ── Requester link (for shadow-ban) ──
    requester_id: Optional[str] = None    # Account that submitted the request
    requester_name: Optional[str] = None
    broadcast: bool = True                # False = silently withheld from the donor network
    # ── Dispatch bookkeeping (geo-ripple / rare-blood override) ──
    dispatch_mode: Optional[str] = None   # RIPPLE | CITYWIDE_RARE
    last_radius_km: Optional[float] = None
    dispatch_rounds: int = 0
    last_dispatched_at: Optional[datetime] = None
    escalated: bool = False               # handed to blood banks / NGO hotlines
    # ── Doctor's-slip OCR verification (admin can override) ──
    slip_status: str = "PENDING"          # PENDING | OCR_CONFIRMED | NEEDS_REVIEW | VERIFIED | REJECTED
    ocr_confidence: Optional[float] = None   # 0.0–1.0 confidence from the OCR engine
    ocr_notes: Optional[str] = None
    ocr_simulated: Optional[bool] = None   # True when no OCR engine was configured
    slip_image: Optional[str] = None       # data: URI of the uploaded slip
    slip_image_hash: Optional[str] = None  # SHA-256 hash for exact-duplicate prevention
    slip_reviewed_by: Optional[str] = None
    slip_reviewed_at: Optional[datetime] = None
    # ── Live En-Route Tracker ──
    # Embedded rather than a collection of its own: a request has at most one
    # live trip (only one donor can hold the lock), and keeping them in one
    # document means the lock and the journey can never disagree about who is
    # coming.
    trip: Optional[Trip] = None
    created_at: datetime = Field(default_factory=utcnow)

    @property
    def slip_cleared(self) -> bool:
        """Only a confirmed slip authorises a broadcast to the donor network."""
        return self.slip_status in ("OCR_CONFIRMED", "VERIFIED")

    class Settings:
        name = "requests"


class Admin(Document):
    email: str                            # unique login handle
    name: str
    password_hash: str
    role: str = "admin"                   # admin | superadmin
    created_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "admins"


class PingLog(Document):
    request_id: str
    donor_id: str
    donor_name: str
    decision: str        # PINGED | ROUTE_MATCH | EMERGENCY_BREAKTHROUGH | SKIPPED_SLEEP
    reason: str
    pinged: bool         # did the engine decide to ping this donor
    fcm_priority: str = "normal"    # normal | high
    fcm_bypass_dnd: bool = False    # high-priority push flagged to pierce OS DND
    dispatch_mode: Optional[str] = None    # RIPPLE | CITYWIDE_RARE
    distance_km: Optional[float] = None    # None under the city-wide override
    delivered: bool = False          # did FCM actually accept the push
    delivery_simulated: bool = False  # True when no FCM credentials are configured
    created_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "ping_logs"


class Appeal(Document):
    donor_id: str
    donor_name: Optional[str] = None
    request_id: Optional[str] = None
    reason: str
    status: str = "PENDING"          # PENDING | CLEARED | REJECTED
    resolved_by: Optional[str] = None
    resolved_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "appeals"


class OtpChallenge(Document):
    """One SMS one-time password, hashed at rest.

    Also carries `pending_request`: the emergency details a logged-out user
    typed before being asked to verify. Parking them here is what lets the ping
    fire automatically on verification without the family re-entering anything.
    """
    phone: str
    code_hash: str
    purpose: str = "LOGIN"           # LOGIN | REGISTER
    attempts: int = 0
    consumed: bool = False
    pending_request: Optional[dict] = None
    expires_at: datetime
    created_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "otp_challenges"


class MedicalCertificate(Document):
    """A timestamped certificate uploaded to appeal an over-long cooldown.

    The corner case this serves: a donor mistypes their last donation date,
    gets locked out for months, and needs a human to unlock it early.
    """
    donor_id: str
    donor_name: Optional[str] = None
    note: Optional[str] = None
    image: Optional[str] = None              # data: URI of the certificate
    issued_at: Optional[datetime] = None     # timestamp printed on the document
    corrected_donation_date: Optional[datetime] = None   # what it should have been
    status: str = "PENDING"                  # PENDING | APPROVED | REJECTED
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    review_note: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "medical_certificates"


# Call-channel states.
CALL_ACTIVE = "ACTIVE"
CALL_ENDED = "ENDED"
CALL_EXPIRED = "EXPIRED"

# Which leg is carrying the conversation.
CALL_MODE_VOIP = "VOIP"
CALL_MODE_GSM = "GSM_FALLBACK"


class CallSession(Document):
    """A temporary two-party call channel between a family and their donor.

    The whole point is what this document does **not** contain: neither party's
    real phone number appears anywhere in it. Participants are stored as account
    ids, and the bridge looks the numbers up from `Account` at dial time and
    discards them. So a dump of this collection reveals who spoke to whom about
    which emergency, and no way to ring either of them afterwards.

    `proxy_number` is a Spondon-owned number on loan from the pool, not a
    participant's — safe to show, and it stops resolving the moment the session
    ends.
    """
    request_id: str
    donor_id: str
    family_id: Optional[str] = None            # the requester, when there was one
    status: str = CALL_ACTIVE                  # ACTIVE | ENDED | EXPIRED
    mode: str = CALL_MODE_VOIP                 # VOIP | GSM_FALLBACK
    # Random room name for the VOIP leg. Unguessable, so knowing a request id is
    # not enough to join a stranger's call.
    room: str
    # Set only once the GSM fallback fires. Returned to the pool on teardown.
    proxy_number: Optional[str] = None
    fallback_reason: Optional[str] = None
    fallback_at: Optional[datetime] = None
    fallback_count: int = 0
    # Audit trail. Entries carry masked digits only — see app.masking.
    events: List[dict] = []
    expires_at: datetime
    ended_at: Optional[datetime] = None
    ended_reason: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "call_sessions"


class ProxyNumber(Document):
    """One rentable GSM number in the masked-calling pool.

    A collection rather than a config list because claiming one has to be
    atomic: two families whose calls degrade in the same second must not be
    handed the same number, or each would reach the other's donor. The claim is
    a single conditional `find_one_and_update`, the same primitive the donor
    lock uses.
    """
    number: str
    in_use: bool = False
    session_id: Optional[str] = None
    claimed_at: Optional[datetime] = None
    released_at: Optional[datetime] = None
    lifetime_claims: int = 0

    class Settings:
        name = "proxy_numbers"


class Escalation(Document):
    """A rare-blood request that went unanswered city-wide and was handed off
    to national blood-bank APIs and partner NGO hotlines."""
    request_id: str
    blood_type: str
    hospital: str
    reason: str
    channels: List[dict] = []        # one entry per partner attempt
    status: str = "OPEN"             # OPEN | SOURCED | CLOSED
    resolved_by: Optional[str] = None
    resolved_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "escalations"


# ── CBC Triage (platelet-trend analysis) ────────────────────────────
# Verdict constants.
CBC_HOLD_OFF      = "HOLD_OFF"       # trend flat/rising → natural recovery
CBC_DISPATCH_NOW  = "DISPATCH_NOW"   # trend strictly falling → counts collapsing
CBC_INCONCLUSIVE  = "INCONCLUSIVE"   # not enough readable reports yet
CBC_INVALID_IMAGE = "INVALID_IMAGE"  # uploaded image is not a CBC/lab report


class CbcUpload(BaseModel):
    """One photograph of a CBC report, as parsed by the AI.

    `platelet_count` is None when the AI could not read the value (blurred,
    folded, wrong page). That upload is stored for auditability but excluded
    from the trend calculation.
    """
    image_hash: str                          # SHA-256 — duplicate guard
    platelet_count: Optional[float] = None  # ×10³/µL as printed on the report
    report_date: Optional[str] = None       # ISO 8601 date string on the form
    patient_name: Optional[str] = None      # as read off this particular sheet
    trend_at_upload: Optional[str] = None   # RISING | STABLE | FALLING | INSUFFICIENT_DATA
    confidence: Optional[float] = None      # 0.0–1.0 from the AI
    ai_notes: Optional[str] = None          # raw AI commentary
    is_cbc_report: bool = True              # False = invalid image, halts processing
    simulated: bool = False                 # True when no OpenAI key is configured
    uploaded_at: datetime = Field(default_factory=utcnow)


class CbcReport(Document):
    """A triage session grouping successive CBC uploads for one patient.

    The family uploads reports one at a time; after each upload the verdict is
    recomputed from all valid readings in the session.  The session lives until
    the family closes or a new one is started — there is no automatic expiry,
    because a dengue patient's counts may need monitoring over several days.
    """
    patient_id: str                          # Account.id of the submitting user
    uploads: List[CbcUpload] = []
    verdict: str = CBC_INCONCLUSIVE          # current trend verdict
    verdict_reason: Optional[str] = None     # AI-generated explanation
    verdict_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "cbc_reports"

