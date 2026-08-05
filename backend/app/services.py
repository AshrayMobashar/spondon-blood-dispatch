"""Shared helpers: id parsing, serialization, and the dispatch decision engine."""
from datetime import datetime, timezone

from beanie import PydanticObjectId
from fastapi import HTTPException

from .models import Donor, BloodRequest


def to_oid(value: str) -> PydanticObjectId:
    """Convert a path/body string to a Mongo ObjectId or raise 400."""
    try:
        return PydanticObjectId(value)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid id: {value!r}")


def serialize(doc) -> dict:
    """JSON-safe dict with `id` (str) instead of the raw ObjectId `_id`."""
    if doc is None:
        return None
    return doc.model_dump(mode="json")


# ── Sleep-window maths ───────────────────────────────────────────────
def _to_minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def in_sleep_window(now_hhmm: str, start: str, end: str) -> bool:
    """True if `now` falls inside [start, end), correctly handling a window
    that crosses midnight (e.g. 23:00 → 07:00)."""
    now = _to_minutes(now_hhmm)
    s, e = _to_minutes(start), _to_minutes(end)
    if s <= e:                 # same-day window
        return s <= now < e
    return now >= s or now < e  # overnight window


LIFE_THREATENING = "LIFE_THREATENING"


def decide_ping(donor: Donor, req: BloodRequest, now_hhmm: str) -> dict:
    """Core Smart-Ping rule engine for a single donor + request.

    Returns a decision dict: decision, reason, pinged, fcm_priority, fcm_bypass_dnd.
    Assumes the donor's blood type already matches the request.
    """
    sm = donor.sleep_mode
    emergency = req.severity == LIFE_THREATENING
    sleeping = sm.enabled and in_sleep_window(now_hhmm, sm.start, sm.end)

    # 1) Sleep Mode gate
    if sleeping:
        if emergency and sm.allow_extreme_emergencies:
            # Life-threatening request breaks through. If the phone's own DND is
            # on, flag the FCM push to bypass OS-level silent mode.
            bypass = sm.dnd_on
            reason = (
                "Life-threatening request broke through Sleep Mode "
                "('wake me for emergencies' enabled)."
            )
            if bypass:
                reason += " Phone DND is ON → high-priority FCM flagged to bypass silent mode."
            return {
                "decision": "EMERGENCY_BREAKTHROUGH",
                "reason": reason,
                "pinged": True,
                "fcm_priority": "high",
                "fcm_bypass_dnd": bypass,
            }
        return {
            "decision": "SKIPPED_SLEEP",
            "reason": "Donor is inside their Sleep Mode window and this is not an eligible emergency breakthrough.",
            "pinged": False,
            "fcm_priority": "normal",
            "fcm_bypass_dnd": False,
        }

    # 2) Commute-aware matching (donor is awake)
    if donor.commute_route and req.road_segment and req.road_segment in donor.commute_route.segments:
        on_segment_now = (
            donor.current_location is not None
            and donor.current_location.road_segment == req.road_segment
        )
        if on_segment_now:
            return {
                "decision": "ROUTE_MATCH",
                "reason": f"Request sits on '{req.road_segment}', a segment on the donor's saved route and their live GPS is on it now.",
                "pinged": True,
                "fcm_priority": "high" if emergency else "normal",
                "fcm_bypass_dnd": False,
            }
        return {
            "decision": "SKIPPED_OFF_ROUTE",
            "reason": f"'{req.road_segment}' is on the saved route but the donor's live GPS has already left that segment — no route ping.",
            "pinged": False,
            "fcm_priority": "normal",
            "fcm_bypass_dnd": False,
        }

    # 3) Standard proximity ping
    return {
        "decision": "PINGED",
        "reason": "Standard ping — donor is awake and blood type matches.",
        "pinged": True,
        "fcm_priority": "high" if emergency else "normal",
        "fcm_bypass_dnd": False,
    }


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
