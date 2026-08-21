"""Dummy dataset for Golden Donor Verification (Module 3, Feature 3).

Creates one donor per state the feature can be in, so every rule and both
corner cases can be demonstrated without waiting six months or moving house:

  • Arif Rahman      — 4 confirmed donations, active in Dhaka
                       → badge earned, ICU priority ACTIVE
  • Nusrat Jahan     — 7 confirmed donations, last seen 210 days ago
                       → badge kept, priority SUSPENDED (dormant "ghost")
  • Tanvir Hossain   — 5 confirmed donations, declared living in Chattogram
                       → badge kept, priority SUSPENDED (relocated)
  • Sadia Karim      — 3 confirmed donations, GPS fix 212 km out, no declaration
                       → badge kept, priority SUSPENDED (relocated, by GPS)
  • Rakib Ahmed      — 2 confirmed donations
                       → one short of the badge; the progress bar at 67%
  • Mim Chowdhury    — 0 donations, brand new
                       → the empty state

...plus one ICU request and one routine request at the same hospital, with all
six donors parked at the same distance from it. Distance being identical is the
point: it is the only way to show that the reordering is the badge doing the
work and not geography.

Every donor is dispatchable (eligible, ACTIVE, matching blood type), so a
dispatch run reaches all six and the ping order is the whole result.

Idempotent, and deliberately narrow: it only ever deletes the accounts in its
own reserved phone block and the requests attached to them. It leaves
`seed_admin.py` and `seed_leaderboard.py` data alone, and vice versa.

Run:  python seed_golden.py
"""
import asyncio
import sys
from datetime import timedelta

from app import golden
from app.db import init_db
from app.eligibility import recalculate
from app.models import (
    Account, BloodRequest, GeoPoint, GoldenStatus, HealthProfile,
    ACTIVE, ROLE_DONOR, utcnow,
)

# Seeded donors live in one phone block so this script can find and replace
# exactly its own data without touching a real registration.
PHONE_PREFIX = "0178"

# One hospital, and one spot 1.5 km from it where every seeded donor is parked.
HOSPITAL = (23.7461, 90.3742)          # Dhanmondi
DONOR_SPOT = (23.7561, 90.3842)
CHATTOGRAM = (22.3569, 91.7832)        # ~212 km out — well beyond the 40 km pool

BLOOD_TYPE = "O+"

# The engine's suspension reasons contain em-dashes, and a stock Windows console
# is cp1252 — printing them there raises UnicodeEncodeError and kills the seed
# half-way through. Widen stdout rather than dumbing the messages down, so what
# this script prints is exactly what the API returns.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def phone(n: int) -> str:
    return f"{PHONE_PREFIX}{n:07d}"


async def _wipe() -> int:
    """Delete only this script's own donors and their requests."""
    mine = await Account.find(
        {"phone": {"$regex": f"^{PHONE_PREFIX}"}}
    ).to_list()
    ids = [str(a.id) for a in mine]
    if ids:
        await BloodRequest.find({"requester_id": {"$in": ids}}).delete()
    await BloodRequest.find({"hospital": "Dhanmondi General (seed)"}).delete()
    for account in mine:
        await account.delete()
    return len(mine)


async def _donor(
    index: int,
    name: str,
    donations: int,
    *,
    days_since_seen: int = 0,
    declared_city: str | None = None,
    location: tuple[float, float] = DONOR_SPOT,
) -> Account:
    """One donor, in one of the states the feature distinguishes."""
    now = utcnow()
    seen = now - timedelta(days=days_since_seen)

    account = Account(
        name=name,
        role=ROLE_DONOR,
        blood_type=BLOOD_TYPE,
        phone=phone(index),
        phone_verified=True,
        status=ACTIVE,
        address="Dhanmondi, Dhaka",
        health=HealthProfile(
            weight_kg=68.0,
            weight_updated_at=now,
            donation_count=donations,
            # Far enough back that nobody is sitting in a cooldown — an
            # ineligible donor never reaches the pool, and the ordering this
            # script exists to show would have nothing to order.
            last_donation_date=now - timedelta(days=200) if donations else None,
            last_donation_type="WHOLE_BLOOD" if donations else None,
        ),
        current_location=GeoPoint(lat=location[0], lng=location[1], updated_at=now),
        golden=GoldenStatus(home_city=declared_city, last_active_at=seen),
        last_login_at=seen,
        created_at=seen,
    )
    recalculate(account, now=now)
    # The one writer, exactly as the live app calls it — so what this script
    # produces cannot disagree with what the API would.
    golden.recalculate(account, now=now)
    await account.insert()
    return account


async def _request(requester: Account, *, icu: bool, patient: str) -> BloodRequest:
    req = BloodRequest(
        patient_name=patient,
        hospital="Dhanmondi General (seed)",
        blood_type=BLOOD_TYPE,
        component="WHOLE_BLOOD",
        units=2,
        severity="CRITICAL" if icu else "NORMAL",
        icu=icu,
        road_segment="Dhanmondi 27",
        hospital_location=GeoPoint(lat=HOSPITAL[0], lng=HOSPITAL[1]),
        requester_id=str(requester.id),
        requester_name=requester.name,
        # Pre-cleared: the doctor's-slip gate is a different feature, and
        # leaving it PENDING would block the dispatch this seed exists to show.
        slip_status="VERIFIED",
    )
    await req.insert()
    return req


async def seed() -> None:
    await init_db()

    removed = await _wipe()
    if removed:
        print(f"Cleared {removed} previously seeded donor(s).\n")

    people = [
        await _donor(1, "Arif Rahman", 4),
        await _donor(2, "Nusrat Jahan", 7, days_since_seen=210),
        await _donor(3, "Tanvir Hossain", 5, declared_city="Chattogram"),
        await _donor(4, "Sadia Karim", 3, location=CHATTOGRAM),
        await _donor(5, "Rakib Ahmed", 2),
        await _donor(6, "Mim Chowdhury", 0),
    ]

    icu_req = await _request(people[0], icu=True, patient="ICU Bleed (seed)")
    routine = await _request(people[0], icu=False, patient="Routine Top-up (seed)")

    print("Donors")
    print("-" * 78)
    print(f"  {'Name':<18}{'Phone':<12}{'Don.':<6}{'Badge':<8}{'Status':<12}Priority")
    print("-" * 78)
    for person in people:
        g = person.golden
        print(
            f"  {person.name:<18}{person.phone:<12}"
            f"{person.health.donation_count:<6}"
            f"{'yes' if g.is_golden else 'no':<8}{g.status:<12}"
            f"{'ACTIVE' if g.priority_active else 'paused'}"
        )
        for reason in g.suspended_reasons:
            print(f"      └─ {reason}")

    print("\nRequests")
    print("-" * 78)
    print(f"  ICU      {icu_req.id}   severity=CRITICAL  icu=True")
    print(f"  Routine  {routine.id}   severity=NORMAL    icu=False")

    print("\nEvery donor is parked 1.5 km from the hospital, so distance cannot")
    print("explain the ordering — only the badge can.")
    print("\nTry it:")
    print(f"  GET  /api/golden/requests/{icu_req.id}/priority   → Arif first")
    print(f"  GET  /api/golden/requests/{routine.id}/priority   → plain distance order")
    print(f"  POST /api/requests/{icu_req.id}/dispatch          → the real ping order")
    print("\nSign in as any of them with the phone above (the OTP is returned in")
    print("the response while no SMS gateway is configured), then open /donor/golden.")


if __name__ == "__main__":
    asyncio.run(seed())
