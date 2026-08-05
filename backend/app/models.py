"""Beanie (async MongoDB ODM) document models for the Spondon backend.

Two feature areas share these collections:
  Feature 1 - Smart Ping: Donor (sleep_mode, commute_route, current_location) + PingLog
  Feature 2 - Concurrency & Accountability: BloodRequest, Donor.reliability, Appeal
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


class CommuteRoute(BaseModel):
    segments: List[str] = []             # named road segments on the daily route
    label: Optional[str] = None
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


# Account moderation states set by an admin (see admin router).
ACTIVE = "ACTIVE"
BANNED = "BANNED"              # account blocked outright — cannot use the system
SHADOW_BANNED = "SHADOW_BANNED"  # requests look active to the user but never broadcast


# ── Collections ──────────────────────────────────────────────────────
class Donor(Document):
    name: str
    blood_type: str
    phone: Optional[str] = None
    fcm_token: Optional[str] = None
    sleep_mode: SleepMode = Field(default_factory=SleepMode)
    commute_route: Optional[CommuteRoute] = None
    current_location: Optional[GeoPoint] = None
    reliability: Reliability = Field(default_factory=Reliability)
    # ── Account moderation (admin-controlled) ──
    status: str = ACTIVE                  # ACTIVE | BANNED | SHADOW_BANNED
    status_reason: Optional[str] = None
    status_by: Optional[str] = None       # admin username who set it
    status_at: Optional[datetime] = None
    flagged_fake_requests: int = 0        # abuse counter shown to admins
    created_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "donors"


class BloodRequest(Document):
    patient_name: str
    hospital: str
    blood_type: str
    severity: str = "NORMAL"             # NORMAL | CRITICAL | LIFE_THREATENING
    road_segment: Optional[str] = None   # road segment the request sits on
    status: str = "OPEN"                 # OPEN | LOCKED | FULFILLED | NO_SHOW
    secured_donor_id: Optional[str] = None
    secured_donor_name: Optional[str] = None
    secured_at: Optional[datetime] = None
    # ── Requester link (for shadow-ban) ──
    requester_id: Optional[str] = None    # Donor account that submitted the request
    requester_name: Optional[str] = None
    broadcast: bool = True                # False = silently withheld from the donor network
    # ── Doctor's-slip OCR verification (admin can override) ──
    slip_status: str = "PENDING"          # PENDING | OCR_CONFIRMED | NEEDS_REVIEW | VERIFIED | REJECTED
    ocr_confidence: Optional[float] = None   # 0.0–1.0 confidence from the OCR engine
    slip_reviewed_by: Optional[str] = None
    slip_reviewed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)

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
    decision: str        # PINGED | ROUTE_MATCH | EMERGENCY_BREAKTHROUGH | SKIPPED_SLEEP | SKIPPED_OFF_ROUTE
    reason: str
    pinged: bool         # was an actual FCM push sent
    fcm_priority: str = "normal"    # normal | high
    fcm_bypass_dnd: bool = False    # high-priority push flagged to pierce OS DND
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
