"""Beanie (async MongoDB ODM) document models for the Spondon backend.

Collections, by the feature that owns them:
  Common     - Account (registration/OTP identity), OtpChallenge
  Module 1.1 - Account.health + Account.eligibility, MedicalCertificate
  Module 1.2 - Account.sleep_mode / commute_route / current_location, PingLog
  Module 1.3 - BloodRequest.dispatch_mode, Escalation
  Module 2.1 - BloodRequest.hospital_location (expanding geo-ripple)
  Module 2.2 - BloodRequest lock fields, Account.reliability, Appeal
  Module 2.3 - BloodRequest slip_* fields (doctor's-slip OCR)
  Module 3.1 - University, Account.university, BloodRequest.secured_donor_university
               / response_seconds / fulfilled_at (Varsity Node Leaderboard)
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
    """One geo-located waypoint of a saved commute route.

    Purely for drawing the route on the donor's map — the matching engine still
    runs on the `segments` names, never on these coordinates. `name` mirrors the
    segment this waypoint stands for so the map marker and the matched segment
    read the same.
    """
    lat: float
    lng: float
    name: Optional[str] = None


class CommuteRoute(BaseModel):
    """The donor's saved daily route.

    `enabled` is a pause switch, not a delete: a donor who turns commute
    matching off keeps their segments and can turn it back on without retyping
    the route. Clearing the route entirely is a separate action.

    `segments` (names) stay the single source of truth for *matching*; `points`
    are the same route expressed as map coordinates, added so the donor's Leaflet
    map can draw the actual line they travel. A route can carry names without
    points (typed on the records page) or both (drawn on the map).
    """
    segments: List[str] = []             # named road segments on the daily route
    points: List[RoutePoint] = []        # map coordinates for those segments (display only)
    label: Optional[str] = None
    enabled: bool = True                 # route-aware matching on/off
    saved_at: datetime = Field(default_factory=utcnow)


class GeoPoint(BaseModel):
    lat: float
    lng: float
    road_segment: Optional[str] = None   # road segment the donor is on right now
    updated_at: datetime = Field(default_factory=utcnow)


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
    address: Optional[str] = None
    # ── Module 3.1 — Varsity Node Leaderboard ──
    # The student's campus, by University.name. Optional by design: a donor who
    # is not a student simply never scores for anyone, and nothing else about
    # their account behaves differently.
    university: Optional[str] = None
    # ── Module 1.1 — eligibility ──
    health: HealthProfile = Field(default_factory=HealthProfile)
    eligibility: Eligibility = Field(default_factory=Eligibility)
    # ── Module 1.2 — smart ping ──
    sleep_mode: SleepMode = Field(default_factory=SleepMode)
    commute_route: Optional[CommuteRoute] = None
    current_location: Optional[GeoPoint] = None
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
    secured_donor_phone: Optional[str] = None
    secured_at: Optional[datetime] = None
    declined_by: List[str] = []
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
    # ── Varsity Node Leaderboard (Module 3, Feature 1) ──
    # Both fields are stamped at accept time and never recomputed. The campus is
    # copied rather than joined so a student transferring — or deleting their
    # account — cannot silently rewrite a month that has already been published;
    # `response_seconds` is the ping-to-acceptance gap that breaks a points tie,
    # measured from the ping this donor actually received for this request.
    secured_donor_university: Optional[str] = None
    response_seconds: Optional[float] = None
    fulfilled_at: Optional[datetime] = None   # arrival confirmed — the scoring event
    created_at: datetime = Field(default_factory=utcnow)

    @property
    def slip_cleared(self) -> bool:
        """Only a confirmed slip authorises a broadcast to the donor network."""
        return self.slip_status in ("OCR_CONFIRMED", "VERIFIED")

    class Settings:
        name = "requests"


class University(Document):
    """A campus that competes on the Varsity Node Leaderboard.

    Kept as its own collection rather than inferred from the distinct
    `Account.university` values, so a university that fielded no donors in a
    given month still appears on the board (at the bottom, honestly at zero)
    instead of vanishing from the competition entirely.
    """
    name: str                             # canonical, and what accounts store
    short_name: str                       # BRACU, NSU, DU — the board's compact label
    city: str = "Dhaka"
    created_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "universities"


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
