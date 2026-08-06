"""Pydantic request-body schemas (the shapes Postman/clients POST/PUT)."""
from typing import Optional, List
from pydantic import BaseModel, Field


# ── Feature 1 — Smart Ping ───────────────────────────────────────────
class DonorCreate(BaseModel):
    name: str = Field(..., examples=["Rafiul Islam"])
    blood_type: str = Field(..., examples=["O+"])
    fcm_token: Optional[str] = Field(None, examples=["fcm_rafiul_9f21"])


class SleepModeUpdate(BaseModel):
    enabled: bool = True
    start: str = Field("23:00", examples=["23:00"])
    end: str = Field("07:00", examples=["07:00"])
    allow_extreme_emergencies: bool = False
    dnd_on: bool = False


class RouteUpdate(BaseModel):
    segments: List[str] = Field(..., examples=[["Mirpur-Rd", "Kazipara", "Shewrapara"]])
    label: Optional[str] = Field(None, examples=["Home → Office"])


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
    severity: str = Field("CRITICAL", examples=["LIFE_THREATENING"])
    road_segment: Optional[str] = Field(None, examples=["Kazipara"])


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
    severity: Optional[str] = Field(None, description="NORMAL | CRITICAL | LIFE_THREATENING")
    status: Optional[str] = Field(None, description="OPEN | LOCKED | FULFILLED | NO_SHOW")
    broadcast: Optional[bool] = None


class DonorModerate(BaseModel):
    action: str = Field(..., description="BAN | SHADOW_BAN | REINSTATE")
    reason: Optional[str] = Field(None, examples=["Repeated fake requests"])


class DonorPatch(BaseModel):
    name: Optional[str] = None
    blood_type: Optional[str] = None
    phone: Optional[str] = None


# ── Feature 3 — Eligibility Cooldown & Auto-Pause Engine ─────────────
class WeightUpdate(BaseModel):
    weight_kg: float = Field(..., examples=[68.0], description="Most recent weight in kg")


class DonationRecord(BaseModel):
    donation_type: str = Field(
        "WHOLE_BLOOD",
        description="WHOLE_BLOOD (120-day lock) | PLATELET (14-day lock)",
        examples=["WHOLE_BLOOD"],
    )
    donation_date: Optional[str] = Field(
        None,
        description="ISO date of the donation; defaults to now if omitted",
        examples=["2025-01-15T00:00:00Z"],
    )


class CertificateUpload(BaseModel):
    file_url: str = Field(..., examples=["https://files.spondon.app/cert/abc123.pdf"])
    note: Optional[str] = Field(None, examples=["I mistyped my donation date as 2025 instead of 2024."])
    claimed_donation_date: Optional[str] = Field(
        None, description="The corrected donation date, if the donor knows it",
        examples=["2024-01-15T00:00:00Z"],
    )


class CertificateReview(BaseModel):
    action: str = Field(..., description="APPROVE | REJECT")
    corrected_donation_date: Optional[str] = Field(
        None,
        description="On APPROVE, optionally fix the donation date the cooldown recomputes from",
        examples=["2024-01-15T00:00:00Z"],
    )
    note: Optional[str] = Field(None, examples=["Certificate legible; hospital stamp valid."])
