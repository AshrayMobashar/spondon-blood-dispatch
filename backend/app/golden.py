"""Module 3, Feature 3 — Golden Donor Verification.

Three confirmed donations earn a donor a verified **Golden Donor** badge, and
that badge buys them one concrete thing: when an ICU case is dispatched, they
are pinged before everybody else. The most proven donors are reached first in
the highest-stakes situations.

Two ideas are kept deliberately apart, and the whole feature turns on the
distinction:

    the badge      — earned at three confirmed donations, never revoked
    the priority   — the dispatch privilege, suspended whenever the donor
                     stops looking reachable, restored the moment they do

**Why only confirmed donations count.** The counter this reads
(`health.donation_count`) is incremented in exactly one place: the arrival
endpoint, when a hospital confirms the donor actually turned up. Accepting a
request does not move it. So the badge cannot be farmed by tapping Accept.

**The ghost-donor corner case.** A Golden Donor who relocates out of Dhaka, or
who stops opening the app for six months, has their *priority* suspended. This
is not a punishment — it is the point of the feature. Priority placement means
the dispatcher spends its first seconds on that donor. Spending them on a phone
in another city, or one nobody has opened since February, costs a patient in
intensive care the very seconds the priority was supposed to buy them. The
badge stays (they did donate three times; that is history and history does not
expire), and the priority comes back automatically the moment the donor opens
the app or their location resolves back inside the city — no appeal, no admin,
no re-earning.

`recalculate()` is the only writer here, the same contract `app.eligibility`
keeps for the eligibility flag: every caller recomputes and re-reads rather
than setting fields by hand, so the badge and the reasons behind it can never
disagree.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from . import config
from .integrations import haversine_km
from .models import (
    Account, BloodRequest, GoldenStatus, GOLDEN_ACTIVE, GOLDEN_NOT_EARNED,
    GOLDEN_SUSPENDED, ROLE_DONOR, utcnow,
)

# Sort tiers used by the dispatcher. Lower is pinged first.
TIER_GOLDEN = 0
TIER_STANDARD = 1

TIER_LABELS = {
    TIER_GOLDEN: "GOLDEN_PRIORITY",
    TIER_STANDARD: "STANDARD",
}

RULE_SUMMARY = (
    f"{config.GOLDEN_DONOR_MIN_DONATIONS} confirmed donations earn a verified "
    f"Golden Donor badge and priority placement on ICU dispatches. Priority is "
    f"suspended while a donor is outside {config.GOLDEN_HOME_CITY} or has not "
    f"opened the app for {config.GOLDEN_DORMANT_AFTER_DAYS} days, and restores "
    f"itself as soon as they are active again."
)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    """Mongo hands datetimes back naive; normalise before any comparison."""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


# ── Which requests trigger the priority ──────────────────────────────
def is_icu_critical(req: BloodRequest) -> bool:
    """Is this the kind of case Golden Donor priority exists for?

    An explicit `icu` flag from the hospital wins outright. Severity is the
    fallback for a request logged by a family who would not know to tick it —
    a life-threatening case is treated as ICU-grade even without the flag,
    because guessing low here is the expensive direction to be wrong in.
    """
    if getattr(req, "icu", False):
        return True
    return (req.severity or "").strip().upper() in config.GOLDEN_PRIORITY_SEVERITIES


def priority_reason(req: BloodRequest) -> str:
    """Human-readable note on why (or why not) this request reorders its pings."""
    if getattr(req, "icu", False):
        return "Flagged as an ICU case — proven donors are pinged first."
    severity = (req.severity or "").strip().upper()
    if severity in config.GOLDEN_PRIORITY_SEVERITIES:
        return (
            f"Severity {severity.replace('_', ' ').title()} is treated as ICU-grade "
            "— proven donors are pinged first."
        )
    return (
        "Not an ICU case — every reachable donor is pinged in the usual "
        "distance order, with no Golden Donor reordering."
    )


# ── Activity and location ────────────────────────────────────────────
def last_seen(account: Account) -> Optional[datetime]:
    """When the donor was last observed using the app.

    The later of their last login and their last in-app heartbeat. Login alone
    is the wrong clock: a user token lasts 30 days on a phone, so a donor who
    opens the app daily might not have "logged in" since the spring. Judging
    dormancy by login would suspend the most active donors on the platform.
    """
    candidates = [
        _aware(account.last_login_at),
        _aware(account.golden.last_active_at),
        _aware(account.created_at),
    ]
    seen = [c for c in candidates if c is not None]
    return max(seen) if seen else None


def days_since_seen(account: Account, *, now: Optional[datetime] = None) -> Optional[int]:
    now = now or utcnow()
    seen = last_seen(account)
    if seen is None:
        return None
    return max(0, (now - seen).days)


def is_dormant(account: Account, *, now: Optional[datetime] = None) -> bool:
    days = days_since_seen(account, now=now)
    # No activity record at all is not evidence of absence — a freshly seeded
    # account has never logged in and must not be suspended for it.
    return days is not None and days >= config.GOLDEN_DORMANT_AFTER_DAYS


def distance_from_city_km(account: Account) -> Optional[float]:
    """How far the donor's last known fix is from the city the pool serves."""
    loc = account.current_location
    if loc is None:
        return None
    return haversine_km(
        config.GOLDEN_CITY_LAT, config.GOLDEN_CITY_LNG, loc.lat, loc.lng
    )


def declared_elsewhere(account: Account) -> bool:
    """True when the donor has told us themselves that they have moved away."""
    city = (account.golden.home_city or "").strip()
    if not city:
        return False
    return city.casefold() != config.GOLDEN_HOME_CITY.casefold()


def has_relocated(account: Account) -> bool:
    """Out of the served city — by their own declaration, or by their last fix.

    A declaration outranks GPS in both directions. A donor who says they are
    back in Dhaka is trusted even if their phone has not reported a fix since
    they landed, because the alternative is a donor who has genuinely returned
    sitting suspended until their GPS happens to update.
    """
    city = (account.golden.home_city or "").strip()
    if city:
        return city.casefold() != config.GOLDEN_HOME_CITY.casefold()
    km = distance_from_city_km(account)
    return km is not None and km > config.GOLDEN_CITY_RADIUS_KM


# ── The one writer ───────────────────────────────────────────────────
def recalculate(account: Account, *, now: Optional[datetime] = None) -> GoldenStatus:
    """Recompute and store the account's Golden Donor status. Returns it.

    The caller is responsible for persisting the account afterwards — the same
    contract `eligibility.recalculate` keeps, so a dispatch sweep can decide
    for itself whether anything actually changed before writing.
    """
    now = now or utcnow()
    previous = account.golden
    golden = GoldenStatus(
        # Carried forward: these are history, not derived facts.
        earned_at=previous.earned_at,
        suspensions=previous.suspensions,
        suspended_at=previous.suspended_at,
        restored_at=previous.restored_at,
        last_active_at=previous.last_active_at,
        home_city=previous.home_city,
        donations_at_award=previous.donations_at_award,
    )

    # Patients are never dispatched to, so there is no priority to hold.
    if account.role != ROLE_DONOR:
        golden.status = GOLDEN_NOT_EARNED
        golden.recalculated_at = now
        account.golden = golden
        return golden

    donations = account.health.donation_count or 0
    golden.is_golden = donations >= config.GOLDEN_DONOR_MIN_DONATIONS
    golden.last_known_city_km = distance_from_city_km(account)

    if not golden.is_golden:
        # Not yet earned. Any suspension history is left intact but dormant —
        # a donor who lapsed, lost nothing, and is now working back up should
        # not have their old suspensions silently erased.
        golden.status = GOLDEN_NOT_EARNED
        golden.priority_active = False
        golden.recalculated_at = now
        account.golden = golden
        return golden

    # Stamp the award once, on the transition. Re-stamping on every recompute
    # would make a two-year-old badge look minted this morning.
    if golden.earned_at is None:
        golden.earned_at = now
        golden.donations_at_award = donations

    reasons: list[str] = []

    if has_relocated(account):
        where = (account.golden.home_city or "").strip()
        if where:
            reasons.append(
                f"Relocated to {where} — outside the {config.GOLDEN_HOME_CITY} "
                "priority pool."
            )
        else:
            km = golden.last_known_city_km
            reasons.append(
                f"Last known location is {km:.0f} km from {config.GOLDEN_HOME_CITY} "
                f"(limit {config.GOLDEN_CITY_RADIUS_KM:.0f} km)."
            )

    if is_dormant(account, now=now):
        days = days_since_seen(account, now=now)
        reasons.append(
            f"No app activity for {days} days "
            f"(suspends after {config.GOLDEN_DORMANT_AFTER_DAYS})."
        )

    was_suspended = previous.status == GOLDEN_SUSPENDED

    if reasons:
        golden.status = GOLDEN_SUSPENDED
        golden.priority_active = False
        golden.suspended_reasons = reasons
        if not was_suspended:
            # A fresh suspension, not the continuation of an old one.
            golden.suspended_at = now
            golden.suspensions = previous.suspensions + 1
    else:
        golden.status = GOLDEN_ACTIVE
        golden.priority_active = True
        golden.suspended_reasons = []
        golden.suspended_at = None
        if was_suspended:
            golden.restored_at = now

    golden.recalculated_at = now
    account.golden = golden
    return golden


def snapshot(account: Account) -> dict:
    """The status's substance, ignoring *when* it was last computed.

    Lets a caller tell a real change from a no-op recompute — without this,
    `recalculated_at` moving on every call would turn every read into a write.
    """
    return account.golden.model_dump(exclude={"recalculated_at", "last_known_city_km"})


def touch(account: Account, *, now: Optional[datetime] = None) -> GoldenStatus:
    """Record that the donor just opened the app, then recompute.

    This is the restoration path for a dormant Golden Donor: opening the app is
    the whole proof required, so a donor back from six months away gets their
    priority back on the screen they land on, with nothing to ask for.
    """
    now = now or utcnow()
    account.golden.last_active_at = now
    return recalculate(account, now=now)


def set_home_city(
    account: Account, city: Optional[str], *, now: Optional[datetime] = None
) -> GoldenStatus:
    """Record a relocation (or a return), then recompute.

    Passing None or an empty string clears the declaration and hands the
    decision back to the donor's GPS fix.
    """
    account.golden.home_city = (city or "").strip() or None
    return recalculate(account, now=now)


# ── Dispatch ordering ────────────────────────────────────────────────
def priority_tier(account: Account, req: BloodRequest) -> int:
    """Which ping tier this donor sits in for this request.

    Only an *active* badge promotes: `priority_active` already folds in both
    suspension rules, so the dispatcher never has to re-derive them and cannot
    forget one.
    """
    if not is_icu_critical(req):
        return TIER_STANDARD
    return TIER_GOLDEN if account.golden.priority_active else TIER_STANDARD


def sort_key(pair: tuple, req: BloodRequest) -> tuple:
    """Ordering key for one `(account, distance_km)` candidate.

    Golden first on ICU cases, then nearest first, with donors whose position
    is unknown last inside their own tier — an unknown distance is not a short
    one, and sorting None as zero would put an unlocatable donor ahead of one
    two streets from the hospital.
    """
    account, km = pair
    return (priority_tier(account, req), km is None, km if km is not None else 0.0)


def order_candidates(pairs: list[tuple], req: BloodRequest) -> list[tuple]:
    """Reorder the reachable pool so the most proven donors are pinged first.

    This changes the *order* of the pings and nothing else — the same donors
    are reached, and no donor is dropped because someone else holds a badge.
    Priority placement is about who hears first, not about who hears at all.
    """
    return sorted(pairs, key=lambda pair: sort_key(pair, req))


# ── Read models ──────────────────────────────────────────────────────
def badge(account: Account) -> dict:
    """The compact badge a profile screen renders."""
    g = account.golden
    return {
        "is_golden": g.is_golden,
        "status": g.status,
        "priority_active": g.priority_active,
        "label": (
            "Golden Donor" if g.is_golden else "Not yet a Golden Donor"
        ),
        "verified": g.is_golden,
        "suspended_reasons": g.suspended_reasons,
        "earned_at": g.earned_at.isoformat() if g.earned_at else None,
    }


def progress(account: Account) -> dict:
    """How far a donor is from the badge — what the profile ring fills to."""
    need = config.GOLDEN_DONOR_MIN_DONATIONS
    done = account.health.donation_count or 0
    return {
        "donations": done,
        "required": need,
        "remaining": max(0, need - done),
        "percent": min(100, round(done / need * 100)) if need else 100,
    }


def summary(account: Account, *, now: Optional[datetime] = None) -> dict:
    """Everything the Golden Donor screen renders, in one payload."""
    now = now or utcnow()
    g = account.golden
    seen = last_seen(account)
    days = days_since_seen(account, now=now)
    dormant_in = (
        max(0, config.GOLDEN_DORMANT_AFTER_DAYS - days) if days is not None else None
    )
    return {
        "donor_id": str(account.id),
        "donor_name": account.name,
        "blood_type": account.blood_type,
        "badge": badge(account),
        "progress": progress(account),
        "priority": {
            "active": g.priority_active,
            "tier": TIER_LABELS[TIER_GOLDEN if g.priority_active else TIER_STANDARD],
            "explanation": (
                "You are pinged before standard donors when an ICU case is dispatched."
                if g.priority_active
                else "ICU dispatches reach you in the standard distance order."
            ),
        },
        "activity": {
            "last_seen_at": seen.isoformat() if seen else None,
            "days_since_seen": days,
            "dormant_after_days": config.GOLDEN_DORMANT_AFTER_DAYS,
            "days_until_dormant": dormant_in,
            "is_dormant": is_dormant(account, now=now),
        },
        "location": {
            "home_city": g.home_city or config.GOLDEN_HOME_CITY,
            "declared": bool(g.home_city),
            "served_city": config.GOLDEN_HOME_CITY,
            "km_from_city": (
                round(g.last_known_city_km, 1) if g.last_known_city_km is not None else None
            ),
            "radius_km": config.GOLDEN_CITY_RADIUS_KM,
            "relocated": has_relocated(account),
        },
        "history": {
            "earned_at": g.earned_at.isoformat() if g.earned_at else None,
            "donations_at_award": g.donations_at_award,
            "suspensions": g.suspensions,
            "suspended_at": g.suspended_at.isoformat() if g.suspended_at else None,
            "restored_at": g.restored_at.isoformat() if g.restored_at else None,
        },
        "rules": {
            "min_donations": config.GOLDEN_DONOR_MIN_DONATIONS,
            "dormant_after_days": config.GOLDEN_DORMANT_AFTER_DAYS,
            "home_city": config.GOLDEN_HOME_CITY,
            "city_radius_km": config.GOLDEN_CITY_RADIUS_KM,
            "priority_severities": sorted(config.GOLDEN_PRIORITY_SEVERITIES),
            "summary": RULE_SUMMARY,
        },
        "recalculated_at": g.recalculated_at.isoformat() if g.recalculated_at else None,
    }


def public_card(account: Account) -> dict:
    """What anyone may see about another donor's badge.

    Deliberately thin: the badge and the fact of a suspension, never the reason
    for it. "Relocated to Chattogram" and "has not opened the app since March"
    are both facts about where a private person is and what they are doing, and
    neither is anyone else's business — the donor sees them on their own screen,
    and the dispatcher acts on them silently.
    """
    g = account.golden
    return {
        "donor_id": str(account.id),
        "donor_name": account.name,
        "blood_type": account.blood_type,
        "university": account.university,
        "is_golden": g.is_golden,
        "status": g.status,
        "priority_active": g.priority_active,
        "donations": account.health.donation_count or 0,
        "earned_at": g.earned_at.isoformat() if g.earned_at else None,
    }
