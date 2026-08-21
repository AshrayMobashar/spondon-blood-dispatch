"""The dispatch pipeline — who gets pinged for a request, and why.

Ordering matters here, so it is explicit:

  1.  Gates      — is this request allowed to reach the donor network at all?
                   (status, doctor's slip, shadow ban)
  2.  Pool       — which accounts are dispatchable?
                   (role, blood type, moderation status, eligibility flag)
  3.  Reach      — which of those are close enough right now?
                   (rare-blood city-wide override, else the expanding ripple)
  4.  Order      — in what sequence are the reachable donors pinged?
                   (Golden Donor priority on ICU cases — see app.golden)
  5.  Preference — for each reachable donor, ping or skip?
                   (Sleep Mode, commute route — see services.decide_ping)

Stage 4 reorders and never filters. A donor without a badge is pinged for an
ICU case exactly as they always were; the badge only decides who hears first.

Gate 1 is the shadow ban's teeth: a muted request walks the whole pipeline and
returns a normal-looking result to its owner, but produces zero pings.
"""
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional

from . import config, db, integrations
from .eligibility import recalculate, snapshot
from .golden import (
    TIER_LABELS, is_icu_critical, order_candidates, priority_reason, priority_tier,
)
from .golden import recalculate as recalculate_golden
from .golden import snapshot as golden_snapshot
from .models import (
    Account, BloodRequest, Escalation, PingLog, ACTIVE, ROLE_DONOR, utcnow,
)
from .realtime import feed
from .services import decide_ping, local_hhmm, on_route_now
from .zones import zone_of

log = logging.getLogger("spondon.dispatch")


# ── Gates ────────────────────────────────────────────────────────────
def dispatch_block_reason(req: BloodRequest) -> Optional[str]:
    """Why this request must not reach the donor network, or None if it may.

    The shadow-ban branch is deliberately indistinguishable from success in
    everything the requester can see — only this string, which never leaves the
    server, names it.
    """
    if req.status != "OPEN":
        return f"Request is {req.status}, not OPEN — nothing to dispatch."
    if not req.broadcast:
        return "SHADOW_MUTED: request is withheld from the donor network."
    if not req.slip_cleared:
        return (
            f"Doctor's slip is {req.slip_status} — a dispatch is only authorised "
            "once the slip is confirmed."
        )
    return None


# ── Pool ─────────────────────────────────────────────────────────────
def is_dispatchable(account: Account, req: BloodRequest) -> tuple[bool, str]:
    """Can this account be pinged for this request? Returns (ok, reason)."""
    if account.role != ROLE_DONOR:
        return False, "Account is not a donor."
    if account.blood_type != req.blood_type:
        return False, "Blood type does not match."
    if account.status != ACTIVE:
        return False, f"Account is {account.status}."
    if not account.eligibility.eligible:
        return False, "; ".join(account.eligibility.reasons) or "Donor is not currently eligible."
    return True, "Dispatchable."


# ── Triage ───────────────────────────────────────────────────────────
RIPPLE = "RIPPLE"
CITYWIDE_RARE = "CITYWIDE_RARE"


def is_rare(blood_type: str) -> bool:
    return blood_type.strip().upper() in config.RARE_BLOOD_TYPES


def triage(req: BloodRequest) -> str:
    """Which service handles this request — the first decision made about it.

    A standard type takes the expanding-radius path; a rare negative type is
    routed to the city-wide broadcast instead, because a rare type cannot be
    assumed to exist nearby and minutes spent widening a radius are minutes
    lost. Nothing downstream re-derives this.
    """
    return CITYWIDE_RARE if is_rare(req.blood_type) else RIPPLE


def ripple_radius_km(req: BloodRequest, now: Optional[datetime] = None) -> float:
    """Current ripple radius: 3 km, widening to 5 km at 10 min and 10 km at 20."""
    now = now or utcnow()
    created = req.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=now.tzinfo)
    elapsed_min = (now - created).total_seconds() / 60.0
    radius = config.RIPPLE_STAGES[0][1]
    for after_min, km in config.RIPPLE_STAGES:
        if elapsed_min >= after_min:
            radius = km
    return radius


async def _distances(req: BloodRequest, donors: list) -> dict:
    """donor id → km from the hospital. Driving distance where Maps is available.

    Straight-line distance is wrong wherever a river sits between the two points
    — a 3 km radius across the Buriganga includes donors with no bridge for
    miles. When the Maps API is configured we use real road distance and fall
    back to great-circle only for donors it could not resolve.
    """
    loc = req.hospital_location
    if loc is None:
        return {}
    located = [d for d in donors if d.current_location is not None]
    if not located:
        return {}

    out = {
        str(d.id): integrations.haversine_km(
            loc.lat, loc.lng, d.current_location.lat, d.current_location.lng
        )
        for d in located
    }
    driving = await integrations.driving_distances_km(
        (loc.lat, loc.lng),
        [(d.current_location.lat, d.current_location.lng) for d in located],
    )
    if driving:
        for donor, km in zip(located, driving):
            if km is not None:
                out[str(donor.id)] = km
    return out


# ── Single-donor dry run (no DB writes, no pushes) ───────────────────
def evaluate_donor(
    donor: Account, req: BloodRequest, *, now: Optional[datetime] = None,
    now_hhmm: Optional[str] = None,
) -> dict:
    """Would *this* donor be pinged for *this* request right now, and why?

    Walks the same four stages as `run_dispatch` — gate, pool, reach, decision —
    using the identical helpers, but for one donor and with no side effects: it
    writes no PingLog, sends no push, and mutates nothing. It powers the
    `ping-preview` endpoint, which lets a donor see the concrete effect of their
    own Sleep-Mode and commute settings ("a life-threatening request at 2 a.m.
    *would* wake you") without a real emergency being dispatched.
    """
    now = now or utcnow()
    now_hhmm = now_hhmm or local_hhmm(now)
    recalculate(donor, now=now)             # in-memory only; caller decides to save
    recalculate_golden(donor, now=now)

    mode = triage(req)
    rare = mode == CITYWIDE_RARE
    radius = None if rare else ripple_radius_km(req, now)

    result = {
        "request_id": str(req.id),
        "donor_id": str(donor.id),
        "donor_name": donor.name,
        "evaluated_at": now_hhmm,
        "dispatch_mode": mode,
        "rare_blood_override": rare,
        "radius_km": radius,
        "icu_priority": is_icu_critical(req),
        "priority_tier": TIER_LABELS[priority_tier(donor, req)],
        "golden_donor": donor.golden.is_golden,
        "golden_priority_active": donor.golden.priority_active,
        "would_ping": False,
    }

    # 1) Gate — is the request allowed to reach the network at all?
    blocked = dispatch_block_reason(req)
    if blocked:
        return {**result, "stage": "GATE", "decision": "BLOCKED", "reason": blocked}

    # 2) Pool — is this account dispatchable for this request?
    ok, why = is_dispatchable(donor, req)
    if not ok:
        return {**result, "stage": "POOL", "decision": "EXCLUDED", "reason": why}

    # 3) Reach — rare goes city-wide; otherwise inside the ripple OR on-route.
    distance_km = None
    on_route = on_route_now(donor, req, now=now)
    if not rare:
        loc, hosp = donor.current_location, req.hospital_location
        if loc is not None and hosp is not None:
            distance_km = integrations.haversine_km(hosp.lat, hosp.lng, loc.lat, loc.lng)
        in_radius = distance_km is not None and distance_km <= radius
        # Unknown position is kept in (matches run_dispatch), so only a known,
        # too-far fix that is also off-route is out of range.
        if distance_km is not None and not in_radius and not on_route:
            return {
                **result, "stage": "REACH", "decision": "OUT_OF_RANGE",
                "distance_km": round(distance_km, 2), "on_route": on_route,
                "reason": (
                    f"{round(distance_km, 2)} km from the hospital, beyond the "
                    f"{radius} km radius, and not on the request's road segment."
                ),
            }
    result["distance_km"] = round(distance_km, 2) if distance_km is not None else None
    result["on_route"] = on_route

    # 4) Decision — Sleep Mode / commute preference.
    d = decide_ping(donor, req, now_hhmm, now=now)
    return {**result, "stage": "DECISION", "would_ping": d["pinged"], **d}


# ── The pipeline ─────────────────────────────────────────────────────
async def run_dispatch(
    req: BloodRequest,
    *,
    now: Optional[datetime] = None,
    now_hhmm: Optional[str] = None,
    send_pushes: bool = True,
) -> dict:
    """Evaluate and (optionally) deliver pings for one request."""
    now = now or utcnow()
    # Sleep windows are wall-clock times the donor set locally, so this must be
    # local time, not UTC.
    now_hhmm = now_hhmm or local_hhmm(now)

    blocked = dispatch_block_reason(req)
    mode = triage(req)
    rare = mode == CITYWIDE_RARE
    radius = None if rare else ripple_radius_km(req, now)

    base = {
        "request_id": str(req.id),
        "evaluated_at": now_hhmm,
        "timezone": config.APP_TIMEZONE,
        "severity": req.severity,
        "blood_type": req.blood_type,
        "road_segment": req.road_segment,
        "dispatch_mode": mode,
        "rare_blood_override": rare,
        "radius_km": radius,
        "icu_priority": is_icu_critical(req),
        "icu_priority_reason": priority_reason(req),
    }

    if blocked:
        # Withheld. No candidates are even loaded, so nothing can leak out.
        return {
            **base,
            "broadcast": False,
            "blocked_reason": blocked,
            "candidates": 0, "reachable": 0, "pinged": 0, "skipped": 0,
            "results": [],
        }

    accounts = await Account.find(Account.blood_type == req.blood_type).to_list()

    pool, excluded = [], []
    for acc in accounts:
        # The flag is recomputed here as well as on login: a cooldown that
        # expired an hour ago must not keep a willing donor out of the pool.
        before, before_golden = snapshot(acc), golden_snapshot(acc)
        recalculate(acc, now=now)
        # The badge is recomputed on the same pass for the same reason the
        # eligibility flag is: a Golden Donor who crossed the six-month line
        # last night must not be given priority tonight because nothing
        # happened to trigger a refresh.
        recalculate_golden(acc, now=now)
        if snapshot(acc) != before or golden_snapshot(acc) != before_golden:
            await acc.save()
        ok, why = is_dispatchable(acc, req)
        (pool if ok else excluded).append((acc, why))

    # Reach: rare types skip the ripple entirely and go city-wide at once.
    distances = {} if rare else await _distances(req, [a for a, _ in pool])
    reachable, out_of_range = [], []
    for acc, _ in pool:
        if rare:
            reachable.append((acc, None))
            continue
        km = distances.get(str(acc.id))
        if km is None:
            # Unknown position — keep them in rather than silently dropping a
            # donor the engine simply has no fix for.
            reachable.append((acc, None))
        elif km <= radius:
            reachable.append((acc, km))
        elif on_route_now(acc, req, now=now):
            # Already driving the road this request sits on. A ripple radius
            # measured from the hospital must not drop them: the spec pings a
            # donor whenever a request is on a segment they are travelling, and
            # that is precisely the zero-extra-travel case.
            reachable.append((acc, km))
        else:
            out_of_range.append((acc, km))

    # The radar opens before the first ping, so the family sees the sweep begin
    # rather than a result that appears fully formed.
    await feed.emit(
        "broadcast_started",
        {
            "request_id": str(req.id),
            "dispatch_mode": mode,
            "blood_type": req.blood_type,
            "hospital": req.hospital,
            "hospital_zone": zone_of(req.hospital_location),
            "radius_km": radius,
            "pool_size": len(reachable),
        },
        request_id=str(req.id),
    )

    # Order: on an ICU case the proven donors go to the front of the queue.
    # This is the only thing the Golden Donor badge buys, and it is applied
    # here — after the pool is settled — so it can never change *who* is
    # reachable, only the sequence they are reached in.
    icu = is_icu_critical(req)
    if icu:
        reachable = order_candidates(reachable, req)
    golden_first = sum(1 for acc, _ in reachable if priority_tier(acc, req) == 0)

    results, pinged_count, zone_tally = [], 0, {}

    # Idempotency: /dispatch/evaluate can legitimately be called again for the
    # same request (a later ripple stage widening the radius, an admin re-run),
    # but without this check every re-run re-notifies every eligible donor from
    # scratch — same push, same SMS, same PingLog row — because decide_ping()
    # has no memory of previous rounds. One click multiplying into repeat
    # notifications for the same donor is exactly that gap.
    already_pinged_ids = {
        log.donor_id
        for log in await PingLog.find(
            PingLog.request_id == str(req.id), PingLog.pinged == True  # noqa: E712
        ).to_list()
    }

    for acc, km in reachable:
        if str(acc.id) in already_pinged_ids:
            results.append({
                "donor_id": str(acc.id), "donor_name": acc.name,
                "distance_km": round(km, 2) if km is not None else None,
                "delivery": None, "sms": None,
                "decision": "ALREADY_PINGED", "pinged": False,
                "reason": "Already pinged for this request in an earlier dispatch round — not re-notified.",
                "fcm_priority": "normal", "fcm_bypass_dnd": False,
            })
            continue

        d = decide_ping(acc, req, now_hhmm, now=now)
        delivery = sms = None
        if d["pinged"] and send_pushes:
            delivery = await integrations.send_push(
                acc.fcm_token,
                title=f"{req.blood_type} needed at {req.hospital}",
                body=f"{req.severity.replace('_', ' ').title()} — {req.patient_name}",
                priority=d["fcm_priority"],
                bypass_dnd=d["fcm_bypass_dnd"],
                data={"request_id": str(req.id), "decision": d["decision"]},
            )
            # Rare types get a second channel: too few donors exist to lose one
            # to an expired push token.
            if rare and config.RARE_SMS_ALERTS:
                sms = await integrations.send_emergency_sms(
                    acc.phone, blood_type=req.blood_type,
                    hospital=req.hospital, component=req.component,
                )

        if d["pinged"]:
            pinged_count += 1
            zone = zone_of(acc.current_location)
            zone_tally[zone] = zone_tally.get(zone, 0) + 1
            # Zone and counts only — never a name, an id, or a coordinate.
            await feed.emit(
                "donor_pinged",
                {
                    "request_id": str(req.id),
                    "zone": zone,
                    "zone_count": zone_tally[zone],
                    "reached_so_far": pinged_count,
                    "channels": {
                        "push": bool(delivery),
                        "sms": bool(sms),
                        "simulated": bool(
                            (delivery or {}).get("simulated") or (sms or {}).get("simulated")
                        ),
                    },
                },
                request_id=str(req.id),
            )

        await PingLog(
            request_id=str(req.id),
            donor_id=str(acc.id),
            donor_name=acc.name,
            decision=d["decision"],
            reason=d["reason"],
            pinged=d["pinged"],
            fcm_priority=d["fcm_priority"],
            fcm_bypass_dnd=d["fcm_bypass_dnd"],
            dispatch_mode=mode,
            distance_km=km,
            delivered=bool(delivery and delivery.get("delivered")),
            delivery_simulated=bool(delivery and delivery.get("simulated")),
        ).insert()
        results.append({
            "donor_id": str(acc.id), "donor_name": acc.name,
            "distance_km": round(km, 2) if km is not None else None,
            "priority_tier": TIER_LABELS[priority_tier(acc, req)],
            "golden_donor": acc.golden.is_golden,
            "delivery": delivery, "sms": sms, **d,
        })

    req.dispatch_mode = mode
    req.last_radius_km = radius
    req.dispatch_rounds += 1
    req.last_dispatched_at = now
    await req.save()

    await feed.emit(
        "broadcast_complete",
        {
            "request_id": str(req.id),
            "dispatch_mode": mode,
            "reached": pinged_count,
            "zones": [{"zone": z, "count": n} for z, n in sorted(zone_tally.items())],
            "escalates_in_seconds": config.RARE_ESCALATION_SECONDS if rare else None,
        },
        request_id=str(req.id),
    )

    return {
        **base,
        "broadcast": True,
        "blocked_reason": None,
        "candidates": len(pool),
        "excluded": [
            {"donor_id": str(a.id), "donor_name": a.name, "reason": why} for a, why in excluded
        ],
        "out_of_range": [
            {"donor_id": str(a.id), "donor_name": a.name, "distance_km": round(km, 2)}
            for a, km in out_of_range
        ],
        "reachable": len(reachable),
        "golden_donors_prioritised": golden_first if icu else 0,
        "ping_order": (
            "Golden Donors first, then nearest first." if icu else "Nearest first."
        ),
        "pinged": pinged_count,
        "skipped": len(reachable) - pinged_count,
        "push_delivery": (
            "live" if integrations.push_configured() else "simulated (no FCM credentials)"
        ),
        "results": results,
    }


# ── Rare-blood escalation ────────────────────────────────────────────
def escalation_due(req: BloodRequest, now: Optional[datetime] = None) -> bool:
    """True once a city-wide rare-blood ping has gone unanswered long enough."""
    if not is_rare(req.blood_type) or req.status != "OPEN" or req.escalated:
        return False
    if not req.broadcast or not req.slip_cleared:
        return False        # never dispatched, so nothing to escalate
    created = req.created_at
    now = now or utcnow()
    if created.tzinfo is None:
        created = created.replace(tzinfo=now.tzinfo)
    return now - created >= timedelta(seconds=config.RARE_ESCALATION_SECONDS)


async def sweep_escalations() -> list[Escalation]:
    """Escalate every rare-blood request that has now gone unanswered too long.

    `escalation_due` is also checked whenever a dispatch is evaluated, but that
    only fires if somebody happens to call the API again. The spec says an
    unanswered rare request escalates *automatically*, so this sweep runs on a
    timer (see `escalation_watcher`) and needs no client to poll it.
    """
    open_rare = await BloodRequest.find(BloodRequest.status == "OPEN").to_list()
    escalated = []
    for req in open_rare:
        # dispatch_rounds > 0: only a request that actually reached the donor
        # network can be said to have gone unanswered.
        if req.dispatch_rounds > 0 and escalation_due(req):
            escalated.append(await escalate(
                req,
                f"No {req.blood_type} donor accepted city-wide within "
                f"{config.RARE_ESCALATION_SECONDS}s.",
            ))
    return escalated


async def escalation_watcher() -> None:
    """Background loop: sweep for dead-end rare requests on a fixed interval."""
    while True:
        await asyncio.sleep(config.ESCALATION_SWEEP_SECONDS)
        if not db.ready:
            continue        # nothing to sweep until the database is connected
        try:
            for esc in await sweep_escalations():
                log.info(
                    "Auto-escalated rare request %s (%s) to blood banks / NGO hotlines.",
                    esc.request_id, esc.blood_type,
                )
        except asyncio.CancelledError:
            raise
        except Exception:       # a transient DB error must not kill the watcher
            log.exception("Escalation sweep failed; will retry next interval.")


async def escalate(req: BloodRequest, reason: str) -> Escalation:
    """Hand a dead-end rare-blood request to national blood banks and NGOs."""
    payload = {
        "request_id": str(req.id),
        "blood_type": req.blood_type,
        "component": req.component,
        "units": req.units,
        "hospital": req.hospital,
        "patient_name": req.patient_name,
        "severity": req.severity,
        "opened_at": req.created_at.isoformat(),
    }
    channels = [
        await integrations.escalate_to_blood_bank(payload),
        await integrations.escalate_to_ngo(payload),
    ]
    esc = Escalation(
        request_id=str(req.id),
        blood_type=req.blood_type,
        hospital=req.hospital,
        reason=reason,
        channels=channels,
    )
    await esc.insert()
    req.escalated = True
    await req.save()

    # The family's radar must say so the moment it happens — being handed to a
    # blood bank is the answer to "is anyone coming?", not a background detail.
    await feed.emit(
        "escalated",
        {
            "request_id": str(req.id),
            "blood_type": req.blood_type,
            "reason": reason,
            "channels": [
                {"channel": c["channel"], "delivered": c.get("delivered", False),
                 "simulated": c.get("simulated", False)}
                for c in channels
            ],
        },
        request_id=str(req.id),
    )
    return esc
