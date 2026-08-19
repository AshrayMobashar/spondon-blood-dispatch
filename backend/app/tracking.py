"""Live En-Route Tracker — the maths behind the family's moving donor icon.

This module holds no I/O on purpose. Everything here is a pure function of a
trip's stored points and a clock, which is what makes the corner case testable:
"donor's phone loses its connection mid-trip" is just `now - last_seen_at`
crossing a threshold, and it can be asserted without a network.

Three rules run through all of it:

  * **Last known, never extrapolated.** The icon is drawn where the donor
    actually was. Advancing it along a guessed heading would make the tracker
    most confident exactly when it knows least.
  * **A stale ETA is frozen, not aged.** Once the signal drops, the ETA holds
    the value it had and is flagged. Counting it down against wall-clock time
    would walk it to "arriving now" for a donor nobody has heard from.
  * **Reject before you trust.** A fix that implies 200 km/h, or one measured
    before a fix already stored, is dropped rather than allowed to teleport the
    icon or rewind the trail.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from . import config
from .integrations import haversine_km
from .models import SIGNAL_LIVE, SIGNAL_LOST, Trip, TripPoint

log = logging.getLogger("spondon.tracking")

SIGNAL_LOST_MESSAGE = "Donor signal lost, relying on last known location"


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    """Mongo hands datetimes back naive; everything stored is UTC."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _now(now: Optional[datetime] = None) -> datetime:
    return _aware(now) or datetime.now(timezone.utc)


# ── Accepting a fix ──────────────────────────────────────────────────
def vet_point(trip: Trip, point: TripPoint) -> tuple[bool, str]:
    """Should this fix be allowed to move the icon? Returns (ok, reason).

    Both rejections are real situations rather than defensive padding:

      * **Out of order.** A phone that lost signal in an underpass buffers its
        fixes and flushes them all at once on reconnect. Applied in arrival
        order the trail jumps backwards; compared on `recorded_at` the stale
        ones are simply older than what we already have.
      * **Implausible.** Urban GPS drifts hundreds of metres when it reacquires
        a lock, and a single bad sample would fling the donor across Dhaka and
        recompute the ETA off that lie.
    """
    previous = trip.last_point
    if previous is None:
        return True, "First fix of the trip."

    prev_at = _aware(previous.recorded_at)
    at = _aware(point.recorded_at)
    if prev_at and at and at <= prev_at:
        return False, "Fix is older than the last one already recorded (out-of-order replay)."

    km = haversine_km(previous.lat, previous.lng, point.lat, point.lng)
    seconds = (at - prev_at).total_seconds() if (at and prev_at) else 0.0
    if seconds <= 0:
        return True, "No measurable interval — accepted without a speed check."
    implied_kmh = km / (seconds / 3600.0)
    if implied_kmh > config.TRIP_IMPLAUSIBLE_SPEED_KMH:
        return False, (
            f"Fix implies {implied_kmh:.0f} km/h since the previous one — GPS drift "
            "or a spoofed position, not travel."
        )
    return True, "Accepted."


def measured_speed_kmh(trip: Trip, samples: int = 5) -> Optional[float]:
    """Recent average speed from the trail, or None if it cannot be measured.

    Averaged over several points rather than taken from the last pair, because
    a donor stopped at one signal would otherwise read as 0 km/h and push the
    ETA to infinity the moment the light turned red.
    """
    trail = [p for p in trip.trail[-(samples + 1):]]
    if len(trail) < 2:
        return None
    km, seconds = 0.0, 0.0
    for a, b in zip(trail, trail[1:]):
        at, bt = _aware(a.recorded_at), _aware(b.recorded_at)
        if not (at and bt):
            continue
        gap = (bt - at).total_seconds()
        if gap <= 0:
            continue
        km += haversine_km(a.lat, a.lng, b.lat, b.lng)
        seconds += gap
    if seconds <= 0:
        return None
    return km / (seconds / 3600.0)


def usable_speed_kmh(trip: Trip) -> float:
    """The speed the ETA is computed at — measured where possible, clamped always."""
    speed = measured_speed_kmh(trip)
    if speed is None:
        return config.TRIP_DEFAULT_SPEED_KMH
    return max(config.TRIP_MIN_SPEED_KMH, min(config.TRIP_MAX_SPEED_KMH, speed))


def eta_minutes(distance_km: float, speed_kmh: float) -> float:
    """Minutes to cover `distance_km` at `speed_kmh`, never negative."""
    if speed_kmh <= 0:
        speed_kmh = config.TRIP_DEFAULT_SPEED_KMH
    return max(0.0, (distance_km / speed_kmh) * 60.0)


def road_distance_km(straight_km: float) -> float:
    """Straight-line → road distance when the Maps API is unavailable.

    A donor 4 km away as the crow flies is not 4 km away by road, and quoting
    the crow's figure produces an ETA the donor can never meet.
    """
    return straight_km * config.TRIP_ROAD_FACTOR


# ── Freshness ────────────────────────────────────────────────────────
def seconds_since_fix(trip: Trip, now: Optional[datetime] = None) -> Optional[float]:
    last = _aware(trip.last_seen_at)
    if last is None:
        return None
    return max(0.0, (_now(now) - last).total_seconds())


def signal_is_lost(trip: Trip, now: Optional[datetime] = None) -> bool:
    """Has the donor's phone gone quiet for longer than the tolerance?

    A trip with no fix at all yet is *not* lost — it has not started reporting.
    Treating "no data yet" as "connection dropped" would greet every family with
    a failure banner in the first seconds after their donor accepts.
    """
    if trip.last_seen_at is None:
        return False
    gap = seconds_since_fix(trip, now)
    return gap is not None and gap > config.TRIP_STALE_AFTER_SECONDS


def signal_state(trip: Trip, now: Optional[datetime] = None) -> dict:
    """What the tracker is allowed to claim right now.

    The single source of truth for the corner case. `stale` is what turns the
    family's ETA orange; `message` is what is shown beneath it.
    """
    lost = signal_is_lost(trip, now)
    gap = seconds_since_fix(trip, now)
    return {
        "signal": SIGNAL_LOST if lost else SIGNAL_LIVE,
        "stale": lost,
        "seconds_since_fix": round(gap, 1) if gap is not None else None,
        "stale_after_seconds": config.TRIP_STALE_AFTER_SECONDS,
        "signal_lost_at": _aware(trip.signal_lost_at).isoformat() if trip.signal_lost_at else None,
        "message": SIGNAL_LOST_MESSAGE if lost else None,
    }


# ── The payload the family's tracker renders ─────────────────────────
def public_trip(trip: Optional[Trip], now: Optional[datetime] = None) -> Optional[dict]:
    """Serialise a trip for the family, honest about how old it is.

    Note what is withheld while the signal is lost: `eta_at`, the absolute
    arrival timestamp. A client handed one would count down to it every second,
    reinventing the live tracking this state exists to deny. The frozen
    `eta_minutes` and the timestamp it was computed at are enough to say "12
    min, as of 90 seconds ago" without pretending to know more.
    """
    if trip is None:
        return None

    now = _now(now)
    state = signal_state(trip, now)
    point = trip.last_point
    computed_at = _aware(trip.eta_computed_at)

    eta_at = None
    if not state["stale"] and trip.eta_minutes is not None and computed_at:
        eta_at = (computed_at + timedelta(minutes=trip.eta_minutes)).isoformat()

    return {
        "status": trip.status,
        "started_at": _aware(trip.started_at).isoformat() if trip.started_at else None,
        "last_location": (
            {
                "lat": point.lat,
                "lng": point.lng,
                "accuracy_m": point.accuracy_m,
                "recorded_at": _aware(point.recorded_at).isoformat(),
            }
            if point else None
        ),
        # The drawn breadcrumb trail. Coordinates only — no timestamps per point
        # are needed to draw a line, and fewer fields is less to leak.
        "trail": [{"lat": p.lat, "lng": p.lng} for p in trip.trail],
        "distance_km": round(trip.distance_km, 2) if trip.distance_km is not None else None,
        "distance_source": trip.distance_source,
        "eta_minutes": round(trip.eta_minutes) if trip.eta_minutes is not None else None,
        "eta_computed_at": computed_at.isoformat() if computed_at else None,
        "eta_at": eta_at,
        "eta_stale": state["stale"],
        "speed_kmh": round(trip.speed_kmh, 1) if trip.speed_kmh is not None else None,
        "updates": trip.updates,
        "rejected_updates": trip.rejected_updates,
        "signal_drops": trip.signal_drops,
        "arrived_at": _aware(trip.arrived_at).isoformat() if trip.arrived_at else None,
        **state,
    }
