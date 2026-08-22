"""Module 3, Feature 4 — Post-Donation Ride Community Bounty.

A platelet donor walks out of the hospital lighter by a unit of apheresis and
with a long way home. The moment their arrival is confirmed, this engine asks
the community around that hospital for a lift: every nearby account that has
declared a car or a bike gets a secondary alert, separate from the blood ping
that brought the donor in.

The corner case is the point of the feature. Goodwill is not a guarantee — at
2am, on a wet Tuesday, in a thinly-covered neighbourhood, nobody may answer. So
the ask carries a deadline (`config.BOUNTY_WINDOW_MINUTES`), and when it runs
out the server mints a subsidised ride-share promo code against the Pathao /
Uber partnerships and pushes it to the donor. Either a neighbour turns up or a
code does; the donor is never left standing outside a hospital either way.

That deadline is stored on the document, not held in an asyncio timer, for the
same reason the rare-blood escalation is swept from the database: a process
restart at minute seven must not silently cost a donor their ride home.
"""
import asyncio
import logging
from datetime import timedelta, timezone
from typing import Optional

from pymongo import ReturnDocument

from . import config, db as db_module, integrations
from .db import get_collection
from .models import (
    Account, RideBounty, ACTIVE, BOUNTY_ACCEPTED, BOUNTY_COMPLETED,
    BOUNTY_OPEN, BOUNTY_PROMO_GENERATED,
)
from .services import utcnow

log = logging.getLogger("spondon.bounty")


def _aware(dt):
    """Mongo hands back naive datetimes; the rest of the app works in UTC-aware
    ones. Comparing the two raises, so every read of a stored timestamp goes
    through here — the same tolerance `concurrency._within_year` applies."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


# ── Creation ──────────────────────────────────────────────────────────
async def open_bounty(req, donor: Account) -> Optional[RideBounty]:
    """Open a ride bounty for a donor who has just given platelets.

    Returns None when the request carries no hospital coordinate — without one
    there is no centre to search around, and asking the whole city for a lift
    would be worse than asking nobody.
    """
    if not req.hospital_location:
        log.info("Request %s has no hospital location — no ride bounty opened.", req.id)
        return None

    now = utcnow()
    bounty = RideBounty(
        request_id=str(req.id),
        donor_id=str(donor.id),
        donor_name=donor.name,
        hospital=req.hospital,
        hospital_location=req.hospital_location,
        expires_at=now + timedelta(minutes=config.BOUNTY_WINDOW_MINUTES),
        created_at=now,
    )
    await bounty.insert()
    log.info("Ride bounty %s opened for %s at %s (window %dm).",
             bounty.id, donor.name, req.hospital, config.BOUNTY_WINDOW_MINUTES)
    return bounty


# ── Alerting nearby community drivers ─────────────────────────────────
async def nearby_drivers(bounty: RideBounty) -> list[tuple[Account, float]]:
    """Active accounts with a vehicle, within the bounty radius, nearest first.

    The donor themselves is excluded — they are the one being offered the ride,
    and an alert asking them to drive themselves home reads as a bug even when
    it is harmless.
    """
    centre = bounty.hospital_location
    candidates = await Account.find(
        {"vehicle_type": {"$in": list(config.BOUNTY_VEHICLE_TYPES)},
         "status": ACTIVE}
    ).to_list()

    out: list[tuple[Account, float]] = []
    for driver in candidates:
        # str() on both sides: `driver.id` is an ObjectId and `donor_id` is the
        # string form, so comparing them raw is always False and would alert the
        # donor about their own bounty.
        if str(driver.id) == str(bounty.donor_id):
            continue
        if not driver.current_location:
            continue        # no fix, no way to know if they are anywhere near
        km = integrations.haversine_km(
            centre.lat, centre.lng,
            driver.current_location.lat, driver.current_location.lng,
        )
        if km <= config.BOUNTY_RADIUS_KM:
            out.append((driver, km))

    out.sort(key=lambda pair: pair[1])
    return out


async def alert_drivers(bounty: RideBounty) -> int:
    """Push the community ask to every nearby driver. Returns how many got it.

    Deliberately *not* a dispatch ripple: this is a favour, not an emergency.
    Everyone in range is asked at once, no `bypass_dnd`, and a driver who is
    asleep stays asleep — the promo fallback exists precisely so that goodwill
    never has to be extracted from someone at 3am.
    """
    drivers = await nearby_drivers(bounty)
    alerted_ids: list[str] = []

    for driver, km in drivers:
        alerted_ids.append(str(driver.id))
        if not driver.fcm_token:
            continue
        await integrations.send_push(
            driver.fcm_token,
            "A donor near you needs a ride home",
            f"{bounty.donor_name} just finished a platelet donation at "
            f"{bounty.hospital} ({km:.1f} km away). Can you offer a lift home?",
            data={
                "type": "RIDE_BOUNTY",
                "bounty_id": str(bounty.id),
                "hospital": bounty.hospital,
                "expires_at": bounty.expires_at.isoformat(),
            },
        )

    bounty.alerted_driver_ids = alerted_ids
    bounty.alerted_count = len(alerted_ids)
    await bounty.save()
    log.info("Ride bounty %s: asked %d nearby driver(s) within %.1f km.",
             bounty.id, len(alerted_ids), config.BOUNTY_RADIUS_KM)
    return len(alerted_ids)


async def open_and_alert(req, donor: Account) -> Optional[RideBounty]:
    """Open a bounty and immediately ask the neighbourhood."""
    bounty = await open_bounty(req, donor)
    if bounty:
        await alert_drivers(bounty)
    return bounty


# ── The 15-minute fallback ────────────────────────────────────────────
async def issue_promo(bounty: RideBounty) -> Optional[RideBounty]:
    """Mint and attach a subsidised ride code. Atomic: only one can win.

    The conditional update is what makes the race safe — a driver tapping
    "Offer ride" in the same second as the sweep firing must not leave the
    donor with both a driver on the way and a code they were told to use.
    """
    promo = await integrations.generate_ride_promo(
        bounty.hospital, donor_name=bounty.donor_name
    )
    now = utcnow()
    collection = get_collection(RideBounty)
    updated = await collection.find_one_and_update(
        {"_id": bounty.id, "status": BOUNTY_OPEN},      # still unanswered?
        {"$set": {
            "status": BOUNTY_PROMO_GENERATED,
            "promo_code": promo["promo_code"],
            "promo_partner": promo["partner"],
            "promo_value_bdt": promo.get("value_bdt"),
            "promo_simulated": promo.get("simulated", True),
            "promo_issued_at": now,
            "promo_expires_at": now + timedelta(hours=promo.get(
                "ttl_hours", config.BOUNTY_PROMO_TTL_HOURS)),
        }},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        # A driver accepted between the sweep picking this up and the write.
        # Their offer stands; the code is simply never issued.
        log.info("Ride bounty %s was accepted before the promo landed.", bounty.id)
        return None

    fresh = await RideBounty.get(bounty.id)
    donor = await Account.get(bounty.donor_id)
    if donor and donor.fcm_token:
        await integrations.send_push(
            donor.fcm_token,
            "Your ride home is covered",
            f"No community driver was free tonight, so here is a "
            f"{promo['partner']} ride on us — code {promo['promo_code']}. "
            f"Thank you for donating.",
            data={
                "type": "RIDE_PROMO_ISSUED",
                "bounty_id": str(bounty.id),
                "promo_code": promo["promo_code"],
                "partner": promo["partner"],
            },
        )
    log.info("Ride bounty %s expired unanswered — issued %s code %s to %s.",
             bounty.id, promo["partner"], promo["promo_code"], bounty.donor_name)
    return fresh


async def sweep_bounties() -> list[RideBounty]:
    """Issue promo codes for every bounty whose window has now run out."""
    now = utcnow()
    due = await RideBounty.find(
        {"status": BOUNTY_OPEN, "expires_at": {"$lte": now}}
    ).to_list()
    issued = []
    for bounty in due:
        fresh = await issue_promo(bounty)
        if fresh:
            issued.append(fresh)
    return issued


async def bounty_watcher() -> None:
    """Background loop: sweep for expired ride bounties on a fixed interval.

    Mirrors `dispatch.escalation_watcher` — the fallback is a promise made to
    the donor at the moment they finished donating, so it fires on the server's
    clock whether or not anybody's app is open to notice.
    """
    while True:
        await asyncio.sleep(config.BOUNTY_SWEEP_SECONDS)
        if not db_module.ready:
            continue        # nothing to sweep until the database is connected
        try:
            for bounty in await sweep_bounties():
                log.info("Auto-issued ride promo %s for donor %s.",
                         bounty.promo_code, bounty.donor_name)
        except asyncio.CancelledError:
            raise
        except Exception:   # a transient DB error must not kill the watcher
            log.exception("Ride-bounty sweep failed; will retry next interval.")


# ── Driver accepts ────────────────────────────────────────────────────
async def accept(bounty_id, driver: Account) -> RideBounty:
    """Claim an open bounty for `driver`, atomically.

    Same shape as the blood-request lock: one conditional write decides the
    winner, so two neighbours tapping together cannot both be told they are
    driving. Raises ValueError with a human reason when the claim fails.
    """
    bounty = await RideBounty.get(bounty_id)
    if not bounty:
        raise ValueError("This ride bounty no longer exists.")
    if str(driver.id) == str(bounty.donor_id):
        raise ValueError("This is your own ride home — you cannot accept it.")
    if driver.vehicle_type not in config.BOUNTY_VEHICLE_TYPES:
        raise ValueError(
            "Add a car or bike to your profile before offering a ride home."
        )
    if _aware(bounty.expires_at) <= utcnow() and bounty.status == BOUNTY_OPEN:
        raise ValueError("This bounty has expired — the donor was sent a ride code.")

    now = utcnow()
    collection = get_collection(RideBounty)
    updated = await collection.find_one_and_update(
        {"_id": bounty.id, "status": BOUNTY_OPEN},
        {"$set": {
            "status": BOUNTY_ACCEPTED,
            "driver_id": str(driver.id),
            "driver_name": driver.name,
            "driver_phone": driver.phone,
            "driver_vehicle": driver.vehicle_type,
            "accepted_at": now,
        }},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        fresh = await RideBounty.get(bounty.id)
        if fresh and fresh.status == BOUNTY_PROMO_GENERATED:
            raise ValueError(
                "Too late — the window closed and the donor was sent a ride code."
            )
        raise ValueError("Another community member is already driving them home.")

    fresh = await RideBounty.get(bounty.id)
    donor = await Account.get(bounty.donor_id)
    if donor and donor.fcm_token:
        await integrations.send_push(
            donor.fcm_token,
            "Someone is driving you home",
            f"{driver.name} is on their way to {bounty.hospital} to give you a "
            f"lift home. Thank you for donating.",
            data={
                "type": "RIDE_BOUNTY_ACCEPTED",
                "bounty_id": str(bounty.id),
                "driver_name": driver.name,
            },
        )
    log.info("Ride bounty %s accepted by %s (%s).",
             bounty.id, driver.name, driver.vehicle_type)
    return fresh


async def complete(bounty_id, account: Account) -> RideBounty:
    """Mark the lift as finished. Either party may close it out."""
    bounty = await RideBounty.get(bounty_id)
    if not bounty:
        raise ValueError("This ride bounty no longer exists.")
    if str(account.id) not in (str(bounty.donor_id), str(bounty.driver_id or "")):
        raise ValueError("This ride is not yours to close.")
    if bounty.status != BOUNTY_ACCEPTED:
        raise ValueError("Only an accepted ride can be marked complete.")
    bounty.status = BOUNTY_COMPLETED
    bounty.completed_at = utcnow()
    await bounty.save()
    return bounty


# ── Serialisation ─────────────────────────────────────────────────────
def public_bounty(bounty: RideBounty, viewer: Optional[Account] = None) -> dict:
    """One bounty, told from the point of view of whoever is asking.

    A driver browsing open bounties has no business holding the donor's promo
    code or the assigned driver's phone number, so neither is serialised unless
    the viewer is a party to that ride. The donor's own name *is* shown — the
    ask does not work anonymously, since a stranger will not detour for "a
    donor" — but nothing else about their account travels with it.
    """
    viewer_id = str(viewer.id) if viewer else None
    is_donor = viewer_id is not None and viewer_id == str(bounty.donor_id)
    is_driver = viewer_id is not None and viewer_id == str(bounty.driver_id or "")

    now = utcnow()
    expires_at = _aware(bounty.expires_at)
    seconds_left = max(0, int((expires_at - now).total_seconds()))

    out = {
        "id": str(bounty.id),
        "request_id": bounty.request_id,
        "status": bounty.status,
        "donor_name": bounty.donor_name,
        "hospital": bounty.hospital,
        "hospital_location": {
            "lat": bounty.hospital_location.lat,
            "lng": bounty.hospital_location.lng,
        },
        "alerted_count": bounty.alerted_count,
        "window_minutes": config.BOUNTY_WINDOW_MINUTES,
        "expires_at": expires_at.isoformat(),
        "seconds_remaining": seconds_left if bounty.status == BOUNTY_OPEN else 0,
        "created_at": bounty.created_at.isoformat(),
        "driver_name": bounty.driver_name,
        "driver_vehicle": bounty.driver_vehicle,
        "accepted_at": bounty.accepted_at.isoformat() if bounty.accepted_at else None,
        "viewer_is_donor": is_donor,
        "viewer_is_driver": is_driver,
    }

    if is_donor or is_driver:
        out["driver_phone"] = bounty.driver_phone

    # The code is money. Only the donor it was minted for ever sees it.
    if is_donor:
        out["promo"] = (
            {
                "code": bounty.promo_code,
                "partner": bounty.promo_partner,
                "value_bdt": bounty.promo_value_bdt,
                "simulated": bounty.promo_simulated,
                "issued_at": (bounty.promo_issued_at.isoformat()
                              if bounty.promo_issued_at else None),
                "expires_at": (bounty.promo_expires_at.isoformat()
                               if bounty.promo_expires_at else None),
            }
            if bounty.promo_code else None
        )
    return out
