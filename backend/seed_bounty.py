"""Dummy dataset for the Post-Donation Ride Community Bounty (Module 3, Feature 4).

Sets the board up so both halves of the feature — the community lift and the
promo-code corner case — can be demonstrated without donating platelets first.

  Donors (each has just finished a platelet donation)
  • Rumi Haque      01770000001 — bounty OPEN, four neighbours asked, clock running
  • Shirin Akter    01770000002 — bounty ACCEPTED, a neighbour is driving her home
  • Nadia Sultana   01770000003 — window ran out unanswered → promo code issued

  Community drivers (all within the bounty radius of the hospital)
  • Imran Chowdhury 01770000011 — car,  0.8 km away
  • Faisal Karim    01770000012 — bike, 1.6 km away
  • Tanya Rahman    01770000013 — car,  2.4 km away
  • Sabbir Hasan    01770000014 — bike, 3.2 km away
  • Jamil Uddin     01770000015 — car, 38 km away  → deliberately out of range,
                                  so the radius can be seen doing real work

Sign in as a driver and open /donor/bounties to see Rumi's open bounty and
offer her a ride. Sign in as Nadia to see the promo code the server issued when
nobody answered. Sign in as Rumi and press "expire now" on the API to watch the
fallback fire live rather than waiting fifteen minutes.

Idempotent, and deliberately narrow: it only ever deletes accounts in its own
reserved 0177000000x / 0177000001x phone block and the requests and bounties
attached to them. It leaves the other seed scripts' data alone.

Run:  python seed_bounty.py
"""
import asyncio
from datetime import timedelta

from app import config, integrations
from app.db import init_db
from app.eligibility import recalculate
from app.models import (
    Account, BloodRequest, GeoPoint, RideBounty,
    BOUNTY_ACCEPTED, BOUNTY_PROMO_GENERATED,
)
from app.services import utcnow

# Square Hospital, Panthapath — the hospital the whole scenario hangs off.
HOSPITAL = "Square Hospital, Panthapath"
HOSPITAL_AT = GeoPoint(lat=23.7521, lng=90.3839)

DONOR_PHONES = [f"017700000{n:02d}" for n in range(1, 4)]
DRIVER_PHONES = [f"017700000{n:02d}" for n in range(11, 16)]
ALL_PHONES = DONOR_PHONES + DRIVER_PHONES

KM_PER_DEG_LNG = 102.0      # good enough at Dhaka's latitude


def _east_of_hospital(km: float) -> GeoPoint:
    return GeoPoint(lat=HOSPITAL_AT.lat, lng=HOSPITAL_AT.lng + km / KM_PER_DEG_LNG)


async def _wipe() -> int:
    """Remove only what this script created, so re-running is safe."""
    accounts = await Account.find({"phone": {"$in": ALL_PHONES}}).to_list()
    ids = [str(a.id) for a in accounts]
    for bounty in await RideBounty.find({"donor_id": {"$in": ids}}).to_list():
        await bounty.delete()
    for req in await BloodRequest.find({"patient_name": {"$regex": r"\(ride seed\)$"}}).to_list():
        await req.delete()
    for acct in accounts:
        await acct.delete()
    return len(accounts)


async def _donor(phone: str, name: str, blood: str) -> Account:
    now = utcnow()
    donor = Account(
        name=name,
        blood_type=blood,
        phone=phone,
        phone_verified=True,
        # They are standing outside the hospital they just donated at.
        current_location=GeoPoint(lat=HOSPITAL_AT.lat, lng=HOSPITAL_AT.lng),
        fcm_token=f"seed-fcm-{phone}",
        address="Dhaka",
    )
    # The platelet donation that opened the bounty, with its 14-day cooldown.
    donor.health.last_donation_date = now
    donor.health.last_donation_type = config.PLATELETS
    donor.health.donation_count += 1
    recalculate(donor, now=now)
    await donor.insert()
    return donor


async def _driver(phone: str, name: str, blood: str, vehicle: str, km: float) -> Account:
    driver = Account(
        name=name,
        blood_type=blood,
        phone=phone,
        phone_verified=True,
        vehicle_type=vehicle,
        current_location=_east_of_hospital(km),
        fcm_token=f"seed-fcm-{phone}",
        address="Dhaka",
    )
    recalculate(driver)
    await driver.insert()
    return driver


async def _fulfilled_request(donor: Account, patient: str) -> BloodRequest:
    """The platelet request this donor turned up for."""
    now = utcnow()
    req = BloodRequest(
        patient_name=f"{patient} (ride seed)",
        hospital=HOSPITAL,
        blood_type=donor.blood_type,
        component="PLATELETS",
        units=1,
        severity="CRITICAL",
        hospital_location=HOSPITAL_AT,
        status="FULFILLED",
        secured_donor_id=str(donor.id),
        fulfilled_at=now,
        slip_status="VERIFIED",
    )
    await req.insert()
    return req


async def _bounty(donor: Account, req: BloodRequest, *, minutes_ago: float,
                  drivers: list[Account]) -> RideBounty:
    now = utcnow()
    created = now - timedelta(minutes=minutes_ago)
    bounty = RideBounty(
        request_id=str(req.id),
        donor_id=str(donor.id),
        donor_name=donor.name,
        hospital=HOSPITAL,
        hospital_location=HOSPITAL_AT,
        alerted_driver_ids=[str(d.id) for d in drivers],
        alerted_count=len(drivers),
        created_at=created,
        expires_at=created + timedelta(minutes=config.BOUNTY_WINDOW_MINUTES),
    )
    await bounty.insert()
    return bounty


async def seed() -> None:
    await init_db()

    removed = await _wipe()
    if removed:
        print(f"Cleared {removed} previously seeded account(s).\n")

    # ── Community drivers ──
    imran = await _driver(DRIVER_PHONES[0], "Imran Chowdhury", "O+", "car", 0.8)
    faisal = await _driver(DRIVER_PHONES[1], "Faisal Karim", "B+", "bike", 1.6)
    tanya = await _driver(DRIVER_PHONES[2], "Tanya Rahman", "A+", "car", 2.4)
    sabbir = await _driver(DRIVER_PHONES[3], "Sabbir Hasan", "O-", "bike", 3.2)
    jamil = await _driver(DRIVER_PHONES[4], "Jamil Uddin", "AB+", "car", 38.0)
    in_range = [imran, faisal, tanya, sabbir]

    # ── 1. An open bounty, clock still running ──
    rumi = await _donor(DONOR_PHONES[0], "Rumi Haque", "O+")
    rumi_req = await _fulfilled_request(rumi, "Dengue Platelets")
    open_bounty = await _bounty(rumi, rumi_req, minutes_ago=2, drivers=in_range)

    # ── 2. A bounty a neighbour already answered ──
    shirin = await _donor(DONOR_PHONES[1], "Shirin Akter", "B+")
    shirin_req = await _fulfilled_request(shirin, "Post-Surgical Platelets")
    taken = await _bounty(shirin, shirin_req, minutes_ago=6, drivers=in_range)
    taken.status = BOUNTY_ACCEPTED
    taken.driver_id = str(tanya.id)
    taken.driver_name = tanya.name
    taken.driver_phone = tanya.phone
    taken.driver_vehicle = tanya.vehicle_type
    taken.accepted_at = utcnow() - timedelta(minutes=4)
    await taken.save()

    # ── 3. The corner case: nobody answered, so a code was issued ──
    nadia = await _donor(DONOR_PHONES[2], "Nadia Sultana", "A+")
    nadia_req = await _fulfilled_request(nadia, "Leukaemia Platelets")
    lapsed = await _bounty(nadia, nadia_req, minutes_ago=40, drivers=in_range)
    promo = await integrations.generate_ride_promo(HOSPITAL, donor_name=nadia.name)
    issued = utcnow() - timedelta(minutes=25)
    lapsed.status = BOUNTY_PROMO_GENERATED
    lapsed.promo_code = promo["promo_code"]
    lapsed.promo_partner = promo["partner"]
    lapsed.promo_value_bdt = promo.get("value_bdt")
    lapsed.promo_simulated = promo.get("simulated", True)
    lapsed.promo_issued_at = issued
    lapsed.promo_expires_at = issued + timedelta(
        hours=promo.get("ttl_hours", config.BOUNTY_PROMO_TTL_HOURS))
    await lapsed.save()

    # ── Report ──
    line = "-" * 74
    print("Community drivers")
    print(line)
    print(f"  {'Name':<20}{'Phone':<14}{'Vehicle':<9}{'Distance':<11}Asked?")
    print(line)
    for driver, km in ((imran, 0.8), (faisal, 1.6), (tanya, 2.4),
                       (sabbir, 3.2), (jamil, 38.0)):
        asked = "yes" if km <= config.BOUNTY_RADIUS_KM else "no - out of range"
        print(f"  {driver.name:<20}{driver.phone:<14}{driver.vehicle_type:<9}"
              f"{f'{km} km':<11}{asked}")

    print("\nDonors and their ride home")
    print(line)
    print(f"  {'Name':<18}{'Phone':<14}{'Bounty':<18}Outcome")
    print(line)
    print(f"  {rumi.name:<18}{rumi.phone:<14}{'OPEN':<18}"
          f"{config.BOUNTY_WINDOW_MINUTES - 2} min left to answer")
    print(f"  {shirin.name:<18}{shirin.phone:<14}{'ACCEPTED':<18}"
          f"{tanya.name} is driving her home")
    print(f"  {nadia.name:<18}{nadia.phone:<14}{'PROMO_GENERATED':<18}"
          f"{lapsed.promo_partner} code {lapsed.promo_code}")

    print(f"\nBounty window {config.BOUNTY_WINDOW_MINUTES} min · radius "
          f"{config.BOUNTY_RADIUS_KM:g} km · partners "
          f"{', '.join(config.RIDE_PARTNERS)}")
    print("\nTry it:")
    print(f"  Sign in as {imran.phone} (driver) -> /donor/bounties, offer Rumi a ride")
    print(f"  Sign in as {nadia.phone} (donor)  -> /donor/bounties, see the promo code")
    print(f"  POST /api/bounties/{open_bounty.id}/expire-now")
    print("       (as Rumi) -> watch the fallback issue a code immediately")
    print("\nOTPs are returned in the API response while no SMS gateway is configured.")


if __name__ == "__main__":
    asyncio.run(seed())
