"""Module 3, Feature 3 — Golden Donor Verification endpoints.

The badge, the priority it buys, and the two ways it can be temporarily
suspended. The engine itself lives in `app.golden`; this module is the seam
between it and the network, and holds no rules of its own.

Authentication is deliberately uneven, and each case has a reason:

  * `/golden/rules` is open — the thresholds are the terms of the scheme, and
    a donor deciding whether to bother should not need an account to read them.
  * `/golden/me*` needs the donor's own token. There is no `donor_id` parameter
    anywhere in this router's write paths: the account acted on is always the
    one that owns the bearer token, so no request can move another donor's
    status by guessing an id.
  * `/golden/roster` and `/golden/donors/{id}` need *a* signed-in user. The roll
    of honour is a name and a donation count — fine among members, not
    something to publish to the open internet, and never carrying the reason a
    donor's priority is suspended.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import config, golden
from ..models import Account, BloodRequest, GOLDEN_ACTIVE, GOLDEN_SUSPENDED, ROLE_DONOR
from ..schemas import GoldenCityUpdate
from ..security import get_current_account
from ..services import to_oid

router = APIRouter(prefix="/golden", tags=["Module 3 — Golden Donor Verification"])


def _require_donor(account: Account) -> Account:
    """Patients have no badge to hold — say so plainly rather than 404ing."""
    if account.role != ROLE_DONOR:
        raise HTTPException(
            status_code=403,
            detail="Golden Donor status applies to donor accounts only.",
        )
    return account


# ── The scheme itself ────────────────────────────────────────────────
@router.get("/rules", summary="Thresholds the Golden Donor engine enforces")
async def rules():
    """The published terms: what earns the badge, and what suspends it.

    Served from the same constants the engine reads, so a screen can never
    advertise a threshold the dispatcher does not actually use.
    """
    return {
        "min_donations": config.GOLDEN_DONOR_MIN_DONATIONS,
        "counts_only_confirmed_arrivals": True,
        "dormant_after_days": config.GOLDEN_DORMANT_AFTER_DAYS,
        "home_city": config.GOLDEN_HOME_CITY,
        "city_radius_km": config.GOLDEN_CITY_RADIUS_KM,
        "priority_severities": sorted(config.GOLDEN_PRIORITY_SEVERITIES),
        "badge_is_permanent": True,
        "suspension_is_automatic": True,
        "restoration_is_automatic": True,
        "summary": golden.RULE_SUMMARY,
    }


# ── The signed-in donor ──────────────────────────────────────────────
@router.get("/me", summary="The signed-in donor's Golden Donor status")
async def my_status(account: Account = Depends(get_current_account)):
    """Badge, progress, priority, and — if suspended — exactly why.

    A pure read: it recomputes and reports but does **not** count as activity.
    That is the point. If simply opening this screen refreshed the dormancy
    clock, a donor could never see their own suspension — the act of looking
    would clear it, and the six-month rule would be invisible to the only
    person it affects. `POST /golden/me/heartbeat` is the deliberate signal.
    """
    _require_donor(account)
    before = golden.snapshot(account)
    golden.recalculate(account)
    if golden.snapshot(account) != before:
        await account.save()
    return golden.summary(account)


@router.post("/me/heartbeat", summary="Record that the donor opened the app")
async def heartbeat(account: Account = Depends(get_current_account)):
    """The restoration path for a dormant Golden Donor.

    Opening the app *is* the whole proof of life required, so there is nothing
    to apply for and nobody to ask. A donor back after six months away gets
    their priority returned by the act of showing up — which is the only thing
    the suspension was ever waiting on.
    """
    _require_donor(account)
    was = account.golden.status
    golden.touch(account)
    await account.save()

    restored = was == GOLDEN_SUSPENDED and account.golden.status == GOLDEN_ACTIVE
    return {
        "donor_id": str(account.id),
        "status": account.golden.status,
        "priority_active": account.golden.priority_active,
        "priority_restored": restored,
        "still_suspended_because": account.golden.suspended_reasons,
        "message": (
            "Welcome back — your Golden Donor priority is active again."
            if restored
            else "Activity recorded."
        ),
        "golden": golden.summary(account),
    }


@router.put("/me/city", summary="Declare the city the donor is living in")
async def update_city(
    body: GoldenCityUpdate, account: Account = Depends(get_current_account)
):
    """Relocation, and return from it, through one field.

    A donor who moves out of the served city keeps their badge and loses only
    the priority; one who moves back is trusted immediately rather than waiting
    for their phone to report a fix from the new address. Sending an empty city
    clears the declaration and hands the decision back to their GPS.
    """
    _require_donor(account)
    was_active = account.golden.priority_active
    golden.set_home_city(account, body.city)
    await account.save()

    now_active = account.golden.priority_active
    if was_active and not now_active:
        message = (
            f"Noted. Your badge is yours to keep — only ICU priority is paused "
            f"while you are outside {config.GOLDEN_HOME_CITY}."
        )
    elif now_active and not was_active:
        message = "Welcome back — your Golden Donor priority is active again."
    else:
        message = "Location updated."

    return {
        "donor_id": str(account.id),
        "home_city": account.golden.home_city or config.GOLDEN_HOME_CITY,
        "status": account.golden.status,
        "priority_active": now_active,
        "message": message,
        "golden": golden.summary(account),
    }


# ── Other donors ─────────────────────────────────────────────────────
@router.get("/roster", summary="Donors who hold the Golden Donor badge")
async def roster(
    status: Optional[str] = Query(
        None, description="Filter to ACTIVE or SUSPENDED priority."
    ),
    _viewer: Account = Depends(get_current_account),
):
    """The roll of honour, most-proven first.

    Suspended holders are listed rather than hidden — they earned the badge and
    the board is a record of that. What is *not* listed is why any individual's
    priority is off: that is between the donor and the dispatcher.
    """
    holders = await Account.find(
        Account.role == ROLE_DONOR, Account.golden.is_golden == True  # noqa: E712
    ).to_list()

    wanted = (status or "").strip().upper() or None
    if wanted and wanted not in (GOLDEN_ACTIVE, GOLDEN_SUSPENDED):
        raise HTTPException(
            status_code=400,
            detail=f"status must be {GOLDEN_ACTIVE} or {GOLDEN_SUSPENDED}.",
        )

    cards = []
    for holder in holders:
        # Recomputed on read: a badge that fell dormant overnight must show as
        # suspended on this board even though nothing has dispatched since.
        before = golden.snapshot(holder)
        golden.recalculate(holder)
        if golden.snapshot(holder) != before:
            await holder.save()
        if wanted and holder.golden.status != wanted:
            continue
        cards.append(golden.public_card(holder))

    cards.sort(key=lambda c: (-c["donations"], c["donor_name"].casefold()))
    return {
        "count": len(cards),
        "active": sum(1 for c in cards if c["priority_active"]),
        "suspended": sum(1 for c in cards if not c["priority_active"]),
        "min_donations": config.GOLDEN_DONOR_MIN_DONATIONS,
        "donors": cards,
    }


@router.get("/donors/{donor_id}", summary="One donor's badge")
async def donor_badge(donor_id: str, _viewer: Account = Depends(get_current_account)):
    donor = await Account.get(to_oid(donor_id))
    if donor is None:
        raise HTTPException(status_code=404, detail="Donor not found")
    before = golden.snapshot(donor)
    golden.recalculate(donor)
    if golden.snapshot(donor) != before:
        await donor.save()
    return golden.public_card(donor)


# ── Explainability ───────────────────────────────────────────────────
@router.get(
    "/requests/{request_id}/priority",
    summary="How this request's pings would be ordered",
)
async def priority_preview(
    request_id: str, _viewer: Account = Depends(get_current_account)
):
    """A dry run of the ordering, writing nothing and pinging nobody.

    It answers the question the feature actually makes a claim about: for *this*
    emergency, in what sequence would donors be reached, and which of them are
    at the front because they are proven? Returned for any request — a
    non-ICU one comes back in plain distance order, with `icu_priority` false,
    which is the honest way to show that the badge changes nothing there.
    """
    req = await BloodRequest.get(to_oid(request_id))
    if req is None:
        raise HTTPException(status_code=404, detail="Blood request not found")

    candidates = await Account.find(
        Account.role == ROLE_DONOR, Account.blood_type == req.blood_type
    ).to_list()
    for candidate in candidates:
        golden.recalculate(candidate)

    ordered = golden.order_candidates([(c, None) for c in candidates], req)
    return {
        "request_id": str(req.id),
        "hospital": req.hospital,
        "blood_type": req.blood_type,
        "severity": req.severity,
        "icu": req.icu,
        "icu_priority": golden.is_icu_critical(req),
        "reason": golden.priority_reason(req),
        "order": [
            {
                "position": i + 1,
                "donor_id": str(c.id),
                "donor_name": c.name,
                "tier": golden.TIER_LABELS[golden.priority_tier(c, req)],
                "is_golden": c.golden.is_golden,
                "priority_active": c.golden.priority_active,
                "donations": c.health.donation_count or 0,
            }
            for i, (c, _) in enumerate(ordered)
        ],
    }
