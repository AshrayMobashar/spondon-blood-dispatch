"""CBC Triage router — AI-driven platelet-trend analysis.

Patients upload successive CBC report photographs. After each upload the
OpenAI Vision adapter re-reads the image, extracts the platelet count, and
the verdict is recomputed from the full session history.

Verdicts
--------
HOLD_OFF      — trend flat or rising → natural recovery, hold off on dispatch
DISPATCH_NOW  — trend strictly falling → counts collapsing, dispatch recommended
INCONCLUSIVE  — fewer than CBC_MIN_REPORTS readable reports in this session
INVALID_IMAGE — uploaded image is not a CBC/haematology lab report

Corner cases handled here
-------------------------
• Duplicate upload (same SHA-256 hash)  → 409 with a clear message
• Non-medical image                     → INVALID_IMAGE with AI explanation
• OpenAI API key absent                 → INCONCLUSIVE, simulated=True, banner note
• Unreadable platelet value             → upload stored, excluded from trend
• Fewer than min reports                → INCONCLUSIVE, hint to upload more
"""
import hashlib
import logging
from typing import Optional

from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..integrations import analyse_cbc
from ..models import CbcReport, CbcUpload, CBC_INCONCLUSIVE, CBC_INVALID_IMAGE, utcnow
from ..security import get_current_account

log = logging.getLogger("spondon.cbc_triage")

router = APIRouter(tags=["CBC Triage"])


# ── Request / Response schemas ────────────────────────────────────────

class UploadBody(BaseModel):
    """The base64-encoded image and its MIME type."""
    image: str           # full data: URI  or  raw base64 string
    mime: str = "image/jpeg"


def _strip_data_uri(image: str) -> str:
    """Accept both a raw base64 string and a data: URI."""
    if image.startswith("data:"):
        _, _, b64 = image.partition(",")
        return b64
    return image


def _sha256(b64: str) -> str:
    raw = b64.encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _session_view(session: CbcReport) -> dict:
    """Public representation of a triage session."""
    return {
        "id": str(session.id),
        "patient_id": session.patient_id,
        "uploads": [
            {
                "image_hash": u.image_hash,
                "platelet_count": u.platelet_count,
                "report_date": u.report_date,
                "patient_name": u.patient_name,
                "trend_at_upload": u.trend_at_upload,
                "confidence": u.confidence,
                "ai_notes": u.ai_notes,
                "is_cbc_report": u.is_cbc_report,
                "simulated": u.simulated,
                "uploaded_at": u.uploaded_at.isoformat(),
            }
            for u in session.uploads
        ],
        "verdict": session.verdict,
        "verdict_reason": session.verdict_reason,
        "verdict_at": session.verdict_at.isoformat() if session.verdict_at else None,
        "created_at": session.created_at.isoformat(),
    }


# ── Endpoints ─────────────────────────────────────────────────────────

@router.post(
    "/cbc/sessions",
    summary="Create a new CBC triage session",
    status_code=201,
)
async def create_session(account=Depends(get_current_account)):
    """Start a fresh triage session for this patient.

    A session groups successive CBC uploads. The verdict starts as
    INCONCLUSIVE and is updated after each upload.
    """
    session = CbcReport(patient_id=str(account.id))
    await session.insert()
    log.info("CBC session created: %s by patient %s", session.id, account.id)
    return {"id": str(session.id), "verdict": session.verdict, "uploads": []}


@router.post(
    "/cbc/sessions/{session_id}/upload",
    summary="Upload one CBC report photo",
)
async def upload_report(
    session_id: str,
    body: UploadBody,
    account=Depends(get_current_account),
):
    """Analyse a CBC report photograph and append it to the session.

    The AI extracts the platelet count and the session verdict is
    recomputed from the full upload history.

    Returns the updated session including the new verdict and recommendation.

    Errors
    ------
    404 — session not found or belongs to a different patient
    409 — this exact image has already been uploaded to this session
    422 — invalid request body
    """
    try:
        session = await CbcReport.get(PydanticObjectId(session_id))
    except Exception:
        session = None

    if session is None or session.patient_id != str(account.id):
        raise HTTPException(status_code=404, detail="Session not found.")

    b64 = _strip_data_uri(body.image)
    image_hash = _sha256(b64)

    # ── Duplicate guard ──────────────────────────────────────────────
    for prior in session.uploads:
        if prior.image_hash == image_hash:
            raise HTTPException(
                status_code=409,
                detail=(
                    "This report has already been uploaded to this session. "
                    "Please upload a different CBC report."
                ),
            )

    # ── Gather prior readable platelet counts (oldest first) ─────────
    existing_counts = [
        u.platelet_count
        for u in session.uploads
        if u.is_cbc_report and u.platelet_count is not None
    ]

    # ── Call the OpenAI Vision adapter ───────────────────────────────
    result = await analyse_cbc(b64, body.mime, existing_counts)

    upload = CbcUpload(
        image_hash=image_hash,
        platelet_count=result.get("platelet_count"),
        report_date=result.get("report_date"),
        patient_name=result.get("patient_name"),
        trend_at_upload=result.get("trend"),
        confidence=result.get("confidence"),
        ai_notes=result.get("notes"),
        is_cbc_report=result.get("is_cbc_report") is not False,
        simulated=result.get("simulated", False),
    )

    session.uploads.append(upload)

    # ── Update session verdict ───────────────────────────────────────
    verdict = result.get("verdict", CBC_INCONCLUSIVE)
    recommendation = result.get("recommendation", "")

    # INVALID_IMAGE does not change a previously meaningful verdict
    # (e.g. a family who already has DISPATCH_NOW should not have it
    # wiped because they accidentally attached a selfie).
    if verdict != CBC_INVALID_IMAGE or session.verdict == CBC_INCONCLUSIVE:
        session.verdict = verdict
        session.verdict_reason = recommendation
        session.verdict_at = utcnow()

    await session.save()

    log.info(
        "CBC upload for session %s: platelet=%s verdict=%s",
        session_id, result.get("platelet_count"), session.verdict,
    )

    return {
        **_session_view(session),
        # Surface the per-upload AI output so the frontend can show it
        # alongside the overall session verdict.
        "last_upload": {
            "is_cbc_report": result.get("is_cbc_report"),
            "platelet_count": result.get("platelet_count"),
            "report_date": result.get("report_date"),
            "trend": result.get("trend"),
            "confidence": result.get("confidence"),
            "recommendation": recommendation,
            "notes": result.get("notes"),
            "simulated": result.get("simulated"),
        },
    }


@router.get(
    "/cbc/sessions/{session_id}",
    summary="Get a CBC triage session",
)
async def get_session(session_id: str, account=Depends(get_current_account)):
    """Fetch a triage session with all uploads and the current verdict."""
    try:
        session = await CbcReport.get(PydanticObjectId(session_id))
    except Exception:
        session = None

    if session is None or session.patient_id != str(account.id):
        raise HTTPException(status_code=404, detail="Session not found.")

    return _session_view(session)


@router.get(
    "/cbc/sessions",
    summary="List the current patient's CBC triage sessions",
)
async def list_sessions(account=Depends(get_current_account)):
    """Return all sessions for the logged-in patient, newest first."""
    sessions = (
        await CbcReport.find(CbcReport.patient_id == str(account.id))
        .sort(-CbcReport.created_at)
        .to_list()
    )
    return {"sessions": [_session_view(s) for s in sessions]}

