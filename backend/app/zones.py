"""City zones — the only geographic granularity that leaves the server.

A family watching the City-Wide Radar must see *that* donors were reached and
roughly where, never who or exactly where. Publishing a donor's live coordinates
to a stranger's browser would expose the home address of someone whose only
involvement is volunteering to give blood.

So every realtime payload is generalised to a named zone before it is emitted.
The exact position never leaves the dispatch engine: it is used to compute the
ripple radius and then discarded.
"""
from typing import Optional

from .integrations import haversine_km

# Rough centroids of Dhaka's recognisable areas. Coarse on purpose — a zone is
# supposed to cover thousands of people, because that is what makes it
# non-identifying.
ZONES: list[tuple[str, float, float]] = [
    ("Uttara", 23.8759, 90.3795),
    ("Mirpur", 23.8069, 90.3687),
    ("Gulshan", 23.7925, 90.4078),
    ("Banani", 23.7936, 90.4043),
    ("Badda", 23.7805, 90.4267),
    ("Mohammadpur", 23.7590, 90.3580),
    ("Dhanmondi", 23.7461, 90.3742),
    ("Tejgaon", 23.7639, 90.3925),
    ("Ramna", 23.7380, 90.3950),
    ("Motijheel", 23.7330, 90.4172),
    ("Old Dhaka", 23.7104, 90.4074),
    ("Jatrabari", 23.7104, 90.4344),
    ("Savar", 23.8583, 90.2667),
    ("Keraniganj", 23.7000, 90.3700),
]

UNKNOWN_ZONE = "Unknown zone"

# Beyond this, a point is outside the zone map rather than badly matched.
_MAX_ZONE_RADIUS_KM = 12.0


def zone_for(lat: Optional[float], lng: Optional[float]) -> str:
    """Nearest named zone, or `UNKNOWN_ZONE` when there is no usable fix."""
    if lat is None or lng is None:
        return UNKNOWN_ZONE
    best, best_km = UNKNOWN_ZONE, None
    for name, zlat, zlng in ZONES:
        km = haversine_km(lat, lng, zlat, zlng)
        if best_km is None or km < best_km:
            best, best_km = name, km
    if best_km is not None and best_km > _MAX_ZONE_RADIUS_KM:
        return UNKNOWN_ZONE
    return best


def zone_of(point) -> str:
    """Zone of a GeoPoint-like object (or `UNKNOWN_ZONE` if it is None)."""
    if point is None:
        return UNKNOWN_ZONE
    return zone_for(point.lat, point.lng)


def zone_centroid(name: str) -> Optional[tuple[float, float]]:
    """Published centroid of a zone — what the radar is allowed to draw."""
    for zone, lat, lng in ZONES:
        if zone == name:
            return (lat, lng)
    return None


def public_zones() -> list[dict]:
    """The zone map the frontend renders its radar against."""
    return [{"name": n, "lat": lat, "lng": lng} for n, lat, lng in ZONES]
