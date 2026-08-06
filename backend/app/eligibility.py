"""Feature 3 — Eligibility Cooldown & Auto-Pause Engine (pure logic).

This module holds the *rules* of the engine as plain functions, with no
database or web framework in them. Keeping the maths here (and the database
reads/writes in the router) makes every rule easy to unit-test on its own.

The rules, in plain English:
  • A whole-blood donation locks eligibility for exactly 120 days.
  • A platelet (apheresis) donation locks it for only 14 days.
  • Separately, if the donor's most recent weight is below 50 kg, the flag is
    locked as a medical-risk factor (independent of any cooldown).
  • The single live flag is the OR of those two locks: locked if EITHER applies.
  • While locked, we also report the exact next-eligible date and a countdown.

Corner case handled here:
  • An implausible weight (e.g. 5 kg) is rejected by `validate_weight` so the
    caller can keep the last valid stored value and ask the donor to correct it.
"""
from datetime import datetime, timedelta, timezone


# ── Constants (single source of truth for the rule numbers) ──────────
WHOLE_BLOOD_LOCK_DAYS = 120      # whole blood depletes the body the most
PLATELET_LOCK_DAYS = 14          # apheresis is far less depleting
MIN_WEIGHT_KG = 50.0             # WHO / Bangladesh Blood Transfusion Society floor

# Plausible human-weight band. Anything outside this is treated as a typo
# (e.g. 5 kg meant 50 kg, or 500 kg is a slipped decimal point).
PLAUSIBLE_MIN_KG = 30.0
PLAUSIBLE_MAX_KG = 250.0

# Donation-type labels (kept as plain strings to match the rest of the code).
WHOLE_BLOOD = "WHOLE_BLOOD"
PLATELET = "PLATELET"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(dt):
    """Make a datetime timezone-aware (assume UTC if it has no tzinfo).

    The database can hand back a naive datetime, and Python refuses to compare
    naive and aware datetimes. Normalising here keeps every comparison safe.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def lock_days_for(donation_type: str) -> int:
    """How many days a given donation type locks the flag for.

    Pseudocode:
        if platelet  -> 14
        otherwise    -> 120   (whole blood is the safe default)
    """
    if donation_type == PLATELET:
        return PLATELET_LOCK_DAYS
    return WHOLE_BLOOD_LOCK_DAYS


def validate_weight(new_weight_kg):
    """Corner case: reject an implausible weight.

    Returns a small dict the caller can act on:
        {"ok": True,  "weight": <float>}                      -> store it
        {"ok": False, "reason": "<message for the donor>"}    -> keep old value

    We do NOT decide eligibility here — that is `recalculate`'s job. We only
    decide whether the *number itself* is believable enough to store.

    Pseudocode:
        if not a number            -> reject
        if below plausible floor   -> reject (likely a typo like 5 instead of 50)
        if above plausible ceiling -> reject (likely a slipped decimal)
        otherwise                  -> accept
    """
    # Step 1: must be a real number.
    try:
        weight = float(new_weight_kg)
    except (TypeError, ValueError):
        return {"ok": False, "reason": "Weight must be a number in kilograms."}

    # Step 2: reject impossibly low values (the 5 kg instead of 50 kg case).
    if weight < PLAUSIBLE_MIN_KG:
        return {
            "ok": False,
            "reason": (
                f"{weight:g} kg looks too low to be a real adult weight. "
                f"Did you mean {weight * 10:g} kg? Please re-enter it."
            ),
        }

    # Step 3: reject impossibly high values (a slipped decimal point).
    if weight > PLAUSIBLE_MAX_KG:
        return {
            "ok": False,
            "reason": f"{weight:g} kg looks too high. Please re-enter your weight in kilograms.",
        }

    # Step 4: the number is believable — hand it back to be stored.
    return {"ok": True, "weight": weight}


def cooldown_end(last_donation_date, donation_type):
    """The exact date/time the cooldown lifts, or None if there's no donation.

    Pseudocode:
        if no last donation  -> no cooldown end (None)
        otherwise            -> last donation + (lock days for this type)
    """
    last_donation_date = _as_aware(last_donation_date)
    if last_donation_date is None:
        return None
    return last_donation_date + timedelta(days=lock_days_for(donation_type))


def _format_countdown(delta):
    """Turn a timedelta into a plain 'Xd : Yh : Zm' string for the UI."""
    total_minutes = int(delta.total_seconds() // 60)
    if total_minutes < 0:
        total_minutes = 0
    days = total_minutes // (24 * 60)
    hours = (total_minutes % (24 * 60)) // 60
    minutes = total_minutes % 60
    return f"{days}d : {hours:02d}h : {minutes:02d}m"


def recalculate(weight_kg, last_donation_date, donation_type, now=None):
    """The core engine: compute the single live eligibility flag.

    This is called after each donation and again on every login. It reads the
    donor's stored facts and returns a fresh status dict. It never mutates
    anything — the caller saves whatever it returns.

    Inputs:
        weight_kg          most recent stored weight (float or None)
        last_donation_date datetime of the last donation (or None if never)
        donation_type      WHOLE_BLOOD or PLATELET (of that last donation)
        now                optional datetime override, for deterministic tests

    Output dict:
        eligible            bool  — the single live flag (True = can be pinged)
        cooldown_locked     bool  — is the time-based lock active right now?
        weight_locked       bool  — is the weight-based lock active right now?
        next_eligible_date  ISO string or None
        countdown           'Xd : Yh : Zm' or '0d : 00h : 00m'
        days_remaining      whole days left on the cooldown (0 if none)
        lock_period_days    120 or 14 — which window applied
        reasons             list of short human-readable lock reasons
    """
    if now is None:
        now = utcnow()
    now = _as_aware(now)
    last_donation_date = _as_aware(last_donation_date)

    reasons = []

    # ── Lock 1: the donation cooldown (time-based) ──
    # Work out when the cooldown ends, then compare to 'now'.
    end = cooldown_end(last_donation_date, donation_type)
    cooldown_locked = False
    days_remaining = 0
    countdown = "0d : 00h : 00m"
    next_eligible_date = None

    if end is not None and now < end:
        cooldown_locked = True
        remaining = end - now
        countdown = _format_countdown(remaining)
        # Round UP to whole days so "a bit over 3 days" shows as 4, not 3.
        days_remaining = (remaining.days + (1 if remaining.seconds > 0 else 0))
        next_eligible_date = end
        period = lock_days_for(donation_type)
        reasons.append(
            f"{'Platelet' if donation_type == PLATELET else 'Whole-blood'} "
            f"cooldown active ({period}-day lock) — {days_remaining} day(s) left."
        )

    # ── Lock 2: the weight floor (independent medical-risk factor) ──
    weight_locked = False
    if weight_kg is not None and weight_kg < MIN_WEIGHT_KG:
        weight_locked = True
        reasons.append(
            f"Weight {weight_kg:g} kg is below the {MIN_WEIGHT_KG:g} kg medical minimum."
        )

    # ── The single live flag = locked if EITHER lock applies ──
    eligible = not (cooldown_locked or weight_locked)
    if eligible:
        reasons.append("Eligible — receiving geo-ripple and rare-blood pings.")

    return {
        "eligible": eligible,
        "cooldown_locked": cooldown_locked,
        "weight_locked": weight_locked,
        "next_eligible_date": next_eligible_date.isoformat() if next_eligible_date else None,
        "countdown": countdown,
        "days_remaining": days_remaining,
        "lock_period_days": lock_days_for(donation_type) if last_donation_date else None,
        "reasons": reasons,
    }
