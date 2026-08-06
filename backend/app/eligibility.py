"""Module 1, Feature 1 — Eligibility Cooldown & Auto-Pause Engine.

One live flag per donor, and exactly one function that writes it. Everything
else (login, donation recording, weight edits, admin certificate approval) calls
`recalculate()` and re-reads the result, so the flag can never drift out of step
with the facts behind it.

Two independent locks:

  * Cooldown — 120 days after whole blood, 14 days after platelets. Apheresis is
    far less depleting on the body, hence the much shorter window.
  * Medical risk — weight below 50 kg. This is checked separately and can lock a
    donor who is well past their cooldown.

A donor is eligible only when neither lock applies.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from . import config
from .models import Account, Eligibility, utcnow


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    """Mongo can hand back naive datetimes; normalise before comparing."""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def cooldown_days_for(donation_type: Optional[str]) -> int:
    """Days a donation locks the flag. Unknown types get the safer long window."""
    if not donation_type:
        return config.WHOLE_BLOOD_COOLDOWN_DAYS
    return config.COOLDOWN_DAYS.get(donation_type.upper(), config.WHOLE_BLOOD_COOLDOWN_DAYS)


def weight_is_plausible(kg: float) -> bool:
    """False for typos like 5 kg or 700 kg — these are rejected outright rather
    than stored, so the donor keeps their last valid weight."""
    return config.PLAUSIBLE_WEIGHT_MIN_KG <= kg <= config.PLAUSIBLE_WEIGHT_MAX_KG


def recalculate(account: Account, *, now: Optional[datetime] = None) -> Eligibility:
    """Recompute and store the account's eligibility flag. Returns it.

    The caller is responsible for persisting the account afterwards.
    """
    now = now or utcnow()
    health = account.health
    previous = account.eligibility
    elig = Eligibility(
        cooldown_waived_at=previous.cooldown_waived_at,
        cooldown_waived_by=previous.cooldown_waived_by,
    )
    reasons: list[str] = []

    # Patients are never dispatched to, so eligibility is meaningless for them.
    if not account.is_donor:
        elig.eligible = False
        elig.reasons = ["Account is registered as a patient, not a donor."]
        elig.recalculated_at = now
        account.eligibility = elig
        return elig

    # ── Lock 1: donation cooldown ──
    last = _aware(health.last_donation_date)
    if last is not None:
        days = cooldown_days_for(health.last_donation_type)
        until = last + timedelta(days=days)
        waived = _aware(elig.cooldown_waived_at)
        # An admin-approved medical certificate clears the cooldown, but only
        # the one it was granted against — a later donation starts a new lock.
        if waived is not None and waived >= last:
            elig.cooldown_until = None
            elig.cooldown_source = None
        elif until > now:
            elig.cooldown_until = until
            elig.cooldown_source = (health.last_donation_type or config.WHOLE_BLOOD).upper()
            label = "whole-blood" if elig.cooldown_source == config.WHOLE_BLOOD else "platelet"
            remaining = (until - now).days
            reasons.append(
                f"In {label} cooldown for {remaining} more day(s) "
                f"({days}-day window from {last.date().isoformat()})."
            )

    # ── Lock 2: medical-risk weight, independent of the cooldown ──
    if health.weight_kg is None:
        reasons.append("No weight on file — complete your health profile to be eligible.")
        elig.underweight = False
    elif health.weight_kg < config.MIN_DONOR_WEIGHT_KG:
        elig.underweight = True
        reasons.append(
            f"Weight {health.weight_kg:g} kg is below the "
            f"{config.MIN_DONOR_WEIGHT_KG:g} kg medical minimum."
        )

    elig.eligible = not reasons
    elig.reasons = reasons
    elig.recalculated_at = now
    account.eligibility = elig
    return elig


def snapshot(account: Account) -> dict:
    """The flag's substance, ignoring *when* it was last computed.

    Callers use this to decide whether a recalculation actually changed
    anything: `recalculated_at` moves on every single call, so comparing the
    raw dump would make every read a database write.
    """
    return account.eligibility.model_dump(exclude={"recalculated_at"})


def next_eligible_at(account: Account) -> Optional[datetime]:
    """When the cooldown lifts, or None if there is no time-based lock.

    A weight lock has no date — it clears when the donor updates their weight,
    not when a clock runs out — so it deliberately returns None here.
    """
    return _aware(account.eligibility.cooldown_until)


def countdown(account: Account, *, now: Optional[datetime] = None) -> dict:
    """Live countdown payload for the donor's eligibility screen."""
    now = now or utcnow()
    until = next_eligible_at(account)
    if until is None or until <= now:
        return {
            "locked_by_cooldown": False,
            "next_eligible_at": None,
            "seconds_remaining": 0,
            "days": 0, "hours": 0, "minutes": 0,
        }
    delta = until - now
    secs = int(delta.total_seconds())
    return {
        "locked_by_cooldown": True,
        "next_eligible_at": until.isoformat(),
        "seconds_remaining": secs,
        "days": secs // 86400,
        "hours": (secs % 86400) // 3600,
        "minutes": (secs % 3600) // 60,
    }


def cooldown_progress(account: Account, *, now: Optional[datetime] = None) -> dict:
    """How far through the cooldown the donor is — drives the progress bar.

    `total_days` is the real window for the donation type actually recorded, so
    the UI can never show a figure the engine does not use.
    """
    now = now or utcnow()
    last = _aware(account.health.last_donation_date)
    total = cooldown_days_for(account.health.last_donation_type)
    if last is None:
        return {"elapsed_days": 0, "total_days": total, "percent": 100}
    elapsed = max(0, (now - last).days)
    return {
        "elapsed_days": min(elapsed, total),
        "total_days": total,
        "percent": min(100, round(elapsed / total * 100)) if total else 100,
    }


def summary(account: Account, *, now: Optional[datetime] = None) -> dict:
    """Everything the donor's eligibility screen renders, in one payload."""
    now = now or utcnow()
    health = account.health
    return {
        "donor_id": str(account.id),
        "donor_name": account.name,
        "blood_type": account.blood_type,
        "eligible": account.eligibility.eligible,
        "reasons": account.eligibility.reasons,
        "underweight": account.eligibility.underweight,
        "cooldown_source": account.eligibility.cooldown_source,
        "cooldown_waived_at": (
            account.eligibility.cooldown_waived_at.isoformat()
            if account.eligibility.cooldown_waived_at else None
        ),
        "recalculated_at": (
            account.eligibility.recalculated_at.isoformat()
            if account.eligibility.recalculated_at else None
        ),
        "health": {
            "weight_kg": health.weight_kg,
            "last_donation_date": (
                health.last_donation_date.isoformat() if health.last_donation_date else None
            ),
            "last_donation_type": health.last_donation_type,
            "donation_count": health.donation_count,
        },
        "countdown": countdown(account, now=now),
        "progress": cooldown_progress(account, now=now),
        "rules": {
            "whole_blood_cooldown_days": config.WHOLE_BLOOD_COOLDOWN_DAYS,
            "platelet_cooldown_days": config.PLATELET_COOLDOWN_DAYS,
            "min_weight_kg": config.MIN_DONOR_WEIGHT_KG,
        },
    }
