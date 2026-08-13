"""Shared helpers: id parsing, serialization, and the per-donor ping decision."""
from datetime import datetime, timedelta, timezone
from typing import Optional

from beanie import PydanticObjectId
from fastapi import HTTPException

from . import config
from .models import Account, BloodRequest


def to_oid(value: str) -> PydanticObjectId:
    """Convert a path/body string to a Mongo ObjectId or raise 400."""
    try:
        return PydanticObjectId(value)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid id: {value!r}")
def _fix_naive_datetimes(value):
    """Recursively stamp naive datetimes as UTC before JSON serialization,
    and stringify any Mongo/Beanie ObjectId left in the tree.

    MongoDB round-trips strip tzinfo off datetimes it returns (it stores
    everything as UTC internally but hands back naive Python objects), so a
    freshly-read document loses the timezone marker that a freshly-created
    one still has. Everything this app stores is UTC (see `models.utcnow`),
    so re-attaching `tzinfo=utc` here is correct, not a guess.
    """
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, PydanticObjectId):
        return str(value)
    if isinstance(value, dict):
        return {k: _fix_naive_datetimes(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_fix_naive_datetimes(v) for v in value]
    return value

def serialize(doc) -> dict:
    """JSON-safe dict with `id` (str) instead of the raw ObjectId `_id`."""
    if doc is None:
        return None
    from pydantic_core import to_jsonable_python

    fixed = _fix_naive_datetimes(doc.model_dump(mode="python"))
    return to_jsonable_python(fixed)
    #return doc.model_dump(mode="json")


# ── Local wall-clock time ────────────────────────────────────────────
def local_now(now: Optional[datetime] = None) -> datetime:
    """`now` in the deployment's local zone (Asia/Dhaka by default)."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(config.TZ)


def local_hhmm(now: Optional[datetime] = None) -> str:
    """Wall-clock HH:MM a donor would read off their own phone.

    Sleep Mode windows are set in local time. Evaluating "23:00–07:00" against
    UTC on a UTC+6 deployment silences pings from 05:00 to 13:00 local — the
    middle of the working day — while letting them through at 2 a.m.
    """
    return local_now(now).strftime("%H:%M")


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


def gps_is_fresh(donor: Account, now: Optional[datetime] = None) -> bool:
    """Is the donor's last position recent enough to mean "they are there now"?

    Without this an eight-hour-old fix would still read as "on the segment",
    which is exactly the stale-location case a route ping must not fire on.
    """
    loc = donor.current_location
    if loc is None:
        return False
    now = now or datetime.now(timezone.utc)
    stamped = loc.updated_at
    if stamped is None:
        return False
    if stamped.tzinfo is None:
        stamped = stamped.replace(tzinfo=timezone.utc)
    return now - stamped <= timedelta(minutes=config.LOCATION_STALE_AFTER_MINUTES)


def route_is_saved_for(donor: Account, req: BloodRequest) -> bool:
    """Does the request sit on a segment of this donor's (active) saved route?"""
    route = donor.commute_route
    return bool(
        route
        and route.enabled
        and req.road_segment
        and req.road_segment in route.segments
    )


def on_route_now(
    donor: Account, req: BloodRequest, *, now: Optional[datetime] = None
) -> bool:
    """Is the donor physically on the request's segment at this moment?

    This is the condition the spec attaches the proactive commute ping to —
    "only while the donor is actually on the matching road, never for a location
    they have already left" — so it needs both a saved segment and a live fix.
    """
    if not route_is_saved_for(donor, req):
        return False
    if not gps_is_fresh(donor, now):
        return False
    return donor.current_location.road_segment == req.road_segment


def decide_ping(
    donor: Account, req: BloodRequest, now_hhmm: str, *, now: Optional[datetime] = None
) -> dict:
    """Smart-Ping rule engine for a single donor + request.

    Returns a decision dict: decision, reason, pinged, fcm_priority, fcm_bypass_dnd.
    Assumes the caller has already established that this donor is dispatchable
    and within reach (see app.dispatch).

    The commute route is an *upgrade*, never a filter: a donor sitting on the
    request's road segment is promoted to a high-priority proactive ping, and a
    donor who has driven past it simply falls through to the standard ping they
    would have received had they saved no route at all. Treating a route as a
    filter would make saving one strictly worse than not saving one.
    """
    sm = donor.sleep_mode
    emergency = req.severity == LIFE_THREATENING
    sleeping = sm.enabled and in_sleep_window(now_hhmm, sm.start, sm.end)

    # 0) Eligibility gate (Feature 3).
    # A donor whose eligibility flag is locked (cooldown or low weight) is
    # excluded from EVERY ping — geo-ripple and rare-blood alike — no matter
    # how urgent the request is. This runs before all other checks.
    if not donor.eligibility.eligible:
        return {
            "decision": "SKIPPED_INELIGIBLE",
            "reason": "Donor's eligibility flag is locked (cooldown or weight) — excluded from all pings.",
            "pinged": False,
            "fcm_priority": "normal",
            "fcm_bypass_dnd": False,
        }

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

    # 2) Commute-aware matching (donor is awake) — an upgrade, not a gate.
    on_saved_route = route_is_saved_for(donor, req)
    if on_saved_route:
        fresh = gps_is_fresh(donor, now)
        if on_route_now(donor, req, now=now):
            return {
                "decision": "ROUTE_MATCH",
                "reason": (
                    f"Request sits on '{req.road_segment}', a segment on the donor's saved "
                    "route, and their live GPS is on it right now — zero extra travel."
                ),
                "pinged": True,
                "fcm_priority": "high",
                "fcm_bypass_dnd": False,
            }
        # On the saved route but not on it at this moment (or the fix is stale):
        # no proactive route ping — fall through to the standard ping below.
        note = (
            f" The donor's last GPS fix is older than "
            f"{config.LOCATION_STALE_AFTER_MINUTES} min, so 'on the segment now' cannot be "
            "assumed."
            if not fresh else
            f" Their live GPS has already left '{req.road_segment}'."
        )
    else:
        note = ""

    # 3) Standard proximity ping
    return {
        "decision": "PINGED",
        "reason": "Standard ping — donor is awake, eligible, in range and blood type matches."
                  + note,
        "pinged": True,
        "fcm_priority": "high" if emergency else "normal",
        "fcm_bypass_dnd": False,
    }


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
