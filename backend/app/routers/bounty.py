"""Module 3, Feature 4 — Post-Donation Ride Community Bounty (HTTP surface).

Two audiences share these routes. A community member with a car or bike browses
`GET /bounties` and claims one with `POST /bounties/{id}/accept`. The donor the
bounty was opened for watches `GET /bounties/mine`, which is also where the
fallback promo code appears once the window closes unanswered.

The engine lives in `app.bounty`; this module is only the door.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import bounty as bounty_engine, config
from ..models import (
    Account, RideBounty, BOUNTY_ACCEPTED, BOUNTY_OPEN, BOUNTY_PROMO_GENERATED,
)
from ..security import get_current_account
from ..services import to_oid, utcnow

log = logging.getLogger("spondon.bounty.api")

router = APIRouter(prefix="/bounties", tags=["Module 3.4 — Ride Community Bounty"])


@router.get("/rules", summary="Thresholds the ride-bounty engine enforces")
async def rules():
    """Public, unauthenticated — the UI renders these numbers rather than
    hard-coding "15 minutes" in copy that would drift the moment .env changes."""
    return {
        "window_minutes": config.BOUNTY_WINDOW_MINUTES,
        "radius_km": config.BOUNTY_RADIUS_KM,
        "vehicle_types": list(config.BOUNTY_VEHICLE_TYPES),
        "trigger_component": "PLATELETS",
        "partners": config.RIDE_PARTNERS,
        "promo_value_bdt": config.BOUNTY_PROMO_VALUE_BDT,
        "promo_ttl_hours": config.BOUNTY_PROMO_TTL_HOURS,
        "summary": (
            f"Finishing a platelet donation opens a ride bounty to community "
            f"drivers within {config.BOUNTY_RADIUS_KM:g} km of the hospital. If "
            f"nobody offers a lift within {config.BOUNTY_WINDOW_MINUTES} minutes, "
            f"the donor is automatically sent a subsidised "
            f"{' / '.join(config.RIDE_PARTNERS)} ride code instead."
        ),
    }


@router.get("", summary="Open ride bounties this driver can answer")
async def list_bounties(
    account: Account = Depends(get_current_account),
    include_mine: bool = Query(True, description="Include rides you already accepted"),
):
    """Bounties a community driver can see: everything still open, plus the ones
    they have already taken on so the app can show them where to go.

    A donor's own bounty is filtered out — they are the passenger.
    """
    open_bounties = await RideBounty.find({"status": BOUNTY_OPEN}).to_list()
    rows = [b for b in open_bounties if str(b.donor_id) != str(account.id)]

    if include_mine:
        mine = await RideBounty.find(
            {"driver_id": str(account.id), "status": BOUNTY_ACCEPTED}
        ).to_list()
        seen = {str(b.id) for b in rows}
        rows += [b for b in mine if str(b.id) not in seen]

    rows.sort(key=lambda b: b.created_at, reverse=True)
    return {
        "count": len(rows),
        "can_drive": account.vehicle_type in config.BOUNTY_VEHICLE_TYPES,
        "vehicle_type": account.vehicle_type,
        "radius_km": config.BOUNTY_RADIUS_KM,
        "bounties": [bounty_engine.public_bounty(b, account) for b in rows],
    }


@router.get("/mine", summary="Ride bounties opened for the signed-in donor")
async def my_bounties(account: Account = Depends(get_current_account)):
    """The donor's side of the feature — including the promo code, which is
    serialised here and nowhere else."""
    rows = await RideBounty.find({"donor_id": str(account.id)}).to_list()
    rows.sort(key=lambda b: b.created_at, reverse=True)
    serialised = [bounty_engine.public_bounty(b, account) for b in rows]
    active = next(
        (b for b in serialised if b["status"] in (BOUNTY_OPEN, BOUNTY_ACCEPTED)), None
    )
    latest_promo = next(
        (b for b in serialised if b["status"] == BOUNTY_PROMO_GENERATED), None
    )
    return {
        "count": len(serialised),
        "active": active,
        "latest_promo": latest_promo,
        "window_minutes": config.BOUNTY_WINDOW_MINUTES,
        "bounties": serialised,
    }


@router.get("/{bounty_id}", summary="One ride bounty")
async def get_bounty(bounty_id: str, account: Account = Depends(get_current_account)):
    row = await RideBounty.get(to_oid(bounty_id))
    if not row:
        raise HTTPException(status_code=404, detail="Ride bounty not found")
    return bounty_engine.public_bounty(row, account)


@router.post("/{bounty_id}/accept", summary="Offer this donor a ride home")
async def accept_bounty(bounty_id: str, account: Account = Depends(get_current_account)):
    """Atomic claim. Exactly one driver wins; everyone else gets a 409 saying so."""
    try:
        row = await bounty_engine.accept(to_oid(bounty_id), account)
    except ValueError as exc:
        # 409 for "someone beat you to it", 400 for "you were never eligible".
        message = str(exc)
        conflict = ("already driving" in message) or ("Too late" in message) \
            or ("expired" in message)
        raise HTTPException(status_code=409 if conflict else 400, detail=message)
    return {
        "accepted": True,
        "message": f"Thank you — {row.donor_name} has been told you are on your way.",
        "bounty": bounty_engine.public_bounty(row, account),
    }


@router.post("/{bounty_id}/complete", summary="Mark the ride home as finished")
async def complete_bounty(bounty_id: str, account: Account = Depends(get_current_account)):
    try:
        row = await bounty_engine.complete(to_oid(bounty_id), account)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {
        "completed": True,
        "bounty": bounty_engine.public_bounty(row, account),
    }


@router.post("/{bounty_id}/expire-now", summary="Force the window shut (demo aid)")
async def expire_now(bounty_id: str, account: Account = Depends(get_current_account)):
    """Collapse the wait so the promo fallback can be demonstrated live.

    Restricted to the donor the bounty belongs to: it hands out a real code
    against a real partner budget, so it must not be a button any signed-in
    account can press on somebody else's ride. Sitting through the full
    15-minute window in a viva is the only alternative.
    """
    row = await RideBounty.get(to_oid(bounty_id))
    if not row:
        raise HTTPException(status_code=404, detail="Ride bounty not found")
    if str(row.donor_id) != str(account.id):
        raise HTTPException(status_code=403, detail="This is not your ride bounty.")
    if row.status != BOUNTY_OPEN:
        raise HTTPException(
            status_code=400,
            detail=f"This bounty is already {row.status.replace('_', ' ').lower()}.",
        )

    row.expires_at = utcnow()
    await row.save()
    issued = await bounty_engine.issue_promo(row)
    if not issued:
        raise HTTPException(
            status_code=409, detail="A driver accepted just before the window closed."
        )
    return {
        "expired": True,
        "message": "Window closed — a subsidised ride code was issued.",
        "bounty": bounty_engine.public_bounty(issued, account),
    }
