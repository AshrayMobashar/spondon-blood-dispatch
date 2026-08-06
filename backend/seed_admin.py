"""Seed data for the Spondon demo.

Creates:
  • one admin account            → login  admin@spondon.com / spondon123
  • donor + patient accounts      → incl. one BANNED and one SHADOW_BANNED, one
                                    in whole-blood cooldown, one underweight
  • blood requests                → incl. a NEEDS_REVIEW slip, a rare O- ripple,
                                    and a shadow-banned requester's request that
                                    reads OPEN but is never broadcast
  • one pending medical certificate appealing an over-long cooldown

Every donor is run through the real eligibility engine rather than having flags
written by hand, so the seeded state is always self-consistent.

Idempotent: wipes the seeded collections, then reinserts.
Run:  python seed_admin.py
"""
import asyncio
from datetime import timedelta

from app.config import PLATELETS, WHOLE_BLOOD
from app.db import init_db
from app.eligibility import recalculate
from app.models import (
    Account, BloodRequest, Admin, GeoPoint, HealthProfile, MedicalCertificate,
    Escalation, OtpChallenge, PingLog, Reliability,
    ACTIVE, BANNED, SHADOW_BANNED, ROLE_DONOR, ROLE_PATIENT, utcnow,
)
from app.security import hash_password

ADMIN_EMAIL = "admin@spondon.com"
ADMIN_PASSWORD = "spondon123"

# Rough Dhaka coordinates, so the expanding ripple has something real to measure.
DHAKA_MEDICAL = (23.7261, 90.3969)
SQUARE_HOSPITAL = (23.7529, 90.3789)

# Neighbourhoods spread across the city. The rare-blood override only *means*
# something when the donor pool it reaches is genuinely scattered — with every
# rare donor sitting inside the first 3 km ring there is nothing for skipping
# the ripple to demonstrate.
UTTARA = (23.8759, 90.3795)
MIRPUR_10 = (23.8069, 90.3687)
GULSHAN = (23.7925, 90.4078)
DHANMONDI = (23.7461, 90.3742)
MOTIJHEEL = (23.7330, 90.4172)
MOHAMMADPUR = (23.7590, 90.3580)
JATRABARI = (23.7104, 90.4344)
SAVAR = (23.8583, 90.2667)


async def seed():
    await init_db()
    now = utcnow()

    # ── Admin account ───────────────────────────────────────────────
    await Admin.find(Admin.email == ADMIN_EMAIL).delete()
    admin = Admin(
        email=ADMIN_EMAIL,
        name="Sadia Rahman",
        password_hash=hash_password(ADMIN_PASSWORD),
        role="superadmin",
    )
    await admin.insert()

    # ── Clear previous seed ─────────────────────────────────────────
    for model in (Account, BloodRequest, PingLog, MedicalCertificate, Escalation, OtpChallenge):
        await model.find_all().delete()

    # name, blood, phone, role, status, reason, flagged, weight, last donation, type, loc
    accounts_spec = [
        ("Rafiul Islam",  "O+",  "01711000001", ROLE_DONOR, ACTIVE, None, 0,
         72.0, None, None, (23.7280, 90.3990)),
        ("Nadia Akter",   "O+",  "01711000002", ROLE_DONOR, ACTIVE, None, 0,
         58.0, 200, WHOLE_BLOOD, (23.7340, 90.4050)),            # cooldown expired
        ("Karim Uddin",   "B+",  "01711000003", ROLE_DONOR, ACTIVE, None, 0,
         80.0, 30, WHOLE_BLOOD, (23.7300, 90.4010)),             # still locked (120d)
        ("Tanvir Hasan",  "A+",  "01711000004", ROLE_DONOR, BANNED,
         "Repeatedly abused emergency pings", 5, 70.0, None, None, (23.7290, 90.3980)),
        ("Shovon Ahmed",  "AB-", "01711000005", ROLE_DONOR, SHADOW_BANNED,
         "Submitted 3 fake requests", 3, 65.0, None, None, (23.7310, 90.4000)),
        ("Mitu Rahman",   "O-",  "01711000006", ROLE_DONOR, ACTIVE, None, 0,
         46.0, None, None, (23.8100, 90.4100)),                  # underweight lock
        ("Sabbir Khan",   "O-",  "01711000007", ROLE_DONOR, ACTIVE, None, 0,
         68.0, 20, PLATELETS, (23.8700, 90.3900)),               # far away, eligible
        ("Imran Kabir",   "AB+", "01711000008", ROLE_PATIENT, ACTIVE, None, 0,
         None, None, None, None),

        # ── Rare negative types, scattered city-wide (Module 1, Feature 3) ──
        # Every one of these sits outside the 3 km first ring of Square
        # Hospital, so the city-wide override reaches donors the expanding
        # ripple would take twenty minutes to consider — or never reach.
        ("Farhana Yasmin",    "O-",  "01711000009", ROLE_DONOR, ACTIVE, None, 0,
         62.0, None, None, DHANMONDI),
        ("Rezaul Karim",      "O-",  "01711000010", ROLE_DONOR, ACTIVE, None, 0,
         74.0, 200, WHOLE_BLOOD, JATRABARI),
        ("Nusrat Jahan",      "A-",  "01711000011", ROLE_DONOR, ACTIVE, None, 0,
         57.0, None, None, MIRPUR_10),
        ("Adnan Chowdhury",   "A-",  "01711000012", ROLE_DONOR, ACTIVE, None, 0,
         81.0, None, None, UTTARA),
        ("Sharmin Akter",     "A-",  "01711000013", ROLE_DONOR, ACTIVE, None, 0,
         60.0, 5, PLATELETS, MOTIJHEEL),          # inside the 14-day lock
        ("Tanjim Ahmed",      "B-",  "01711000014", ROLE_DONOR, ACTIVE, None, 0,
         69.0, None, None, GULSHAN),
        ("Rumana Haque",      "B-",  "01711000015", ROLE_DONOR, ACTIVE, None, 0,
         55.0, 300, WHOLE_BLOOD, MOHAMMADPUR),
        ("Zahid Hasan",       "AB-", "01711000016", ROLE_DONOR, ACTIVE, None, 0,
         78.0, None, None, SAVAR),                # 17 km out — unreachable by ripple
        ("Priya Das",         "AB-", "01711000017", ROLE_DONOR, ACTIVE, None, 0,
         64.0, None, None, DHANMONDI),
        ("Shakil Mahmud",     "B-",  "01711000018", ROLE_DONOR, ACTIVE, None, 0,
         73.0, None, None, UTTARA),
        ("Naznin Sultana",    "B-",  "01711000019", ROLE_DONOR, ACTIVE, None, 0,
         59.0, None, None, JATRABARI),
        ("Arif Mahmood",      "AB-", "01711000020", ROLE_DONOR, ACTIVE, None, 0,
         71.0, None, None, MIRPUR_10),
        ("Sadia Noor",        "O-",  "01711000021", ROLE_DONOR, ACTIVE, None, 0,
         66.0, None, None, GULSHAN),
    ]

    accounts = {}
    for (name, blood, phone, role, status, reason, flagged,
         weight, donated_days_ago, donation_type, loc) in accounts_spec:
        health = HealthProfile(
            weight_kg=weight,
            weight_updated_at=now if weight is not None else None,
            last_donation_date=(
                now - timedelta(days=donated_days_ago) if donated_days_ago else None
            ),
            last_donation_type=donation_type,
            donation_count=1 if donated_days_ago else 0,
        )
        acc = Account(
            name=name, blood_type=blood, phone=phone, role=role,
            phone_verified=True,
            fcm_token=f"fcm_{name.split()[0].lower()}_demo",
            health=health,
            status=status,
            status_reason=reason,
            status_by=admin.email if status != ACTIVE else None,
            status_at=now if status != ACTIVE else None,
            flagged_fake_requests=flagged,
            reliability=Reliability(),
            current_location=(
                GeoPoint(lat=loc[0], lng=loc[1], road_segment="Kazipara", updated_at=now)
                if loc else None
            ),
        )
        # The flag is computed, never asserted.
        recalculate(acc, now=now)
        await acc.insert()
        accounts[name] = acc

    shovon = accounts["Shovon Ahmed"]        # shadow-banned
    rafiul = accounts["Rafiul Islam"]
    karim = accounts["Karim Uddin"]          # locked out by a "mistyped" date

    # patient, hospital, blood, component, severity, status, requester, broadcast,
    # slip_status, ocr_conf, age_min, coords
    requests_spec = [
        ("Mehedi Hassan",  "Dhaka Medical College", "B+",  "WHOLE_BLOOD", "LIFE_THREATENING",
         "OPEN", rafiul, True, "OCR_CONFIRMED", 0.97, 4, DHAKA_MEDICAL),
        ("Ayesha Siddiqua", "Square Hospital",      "O-",  "PLATELETS",   "CRITICAL",
         "OPEN", rafiul, True, "NEEDS_REVIEW", 0.42, 12, SQUARE_HOSPITAL),
        ("Rakib Hossain",  "United Hospital",       "A+",  "WHOLE_BLOOD", "CRITICAL",
         "LOCKED", None, True, "VERIFIED", 0.88, 40, None),
        ("Imran Kabir",    "Popular Diagnostic",    "AB+", "WHOLE_BLOOD", "NORMAL",
         "FULFILLED", None, True, "OCR_CONFIRMED", 0.91, 180, None),
        # Shadow-banned requester: still OPEN (looks active to them), never broadcast.
        ("Sultana Begum",  "Ibn Sina Hospital",     "O+",  "WHOLE_BLOOD", "CRITICAL",
         "OPEN", shovon, False, "OCR_CONFIRMED", 0.93, 8, DHAKA_MEDICAL),
        # A rare request opened just now with its slip already cleared: dispatch
        # it and the escalation countdown runs live, in front of you.
        ("Farzana Islam",  "Square Hospital",       "AB-", "PLATELETS",   "LIFE_THREATENING",
         "OPEN", rafiul, True, "VERIFIED", 0.95, 0, SQUARE_HOSPITAL),
    ]
    for (patient, hospital, blood, component, severity, status, requester,
         broadcast, slip_status, ocr_conf, age_min, coords) in requests_spec:
        r = BloodRequest(
            patient_name=patient, hospital=hospital, blood_type=blood,
            component=component, severity=severity, status=status,
            road_segment="Kazipara",
            hospital_location=(
                GeoPoint(lat=coords[0], lng=coords[1], road_segment="Kazipara")
                if coords else None
            ),
            requester_id=str(requester.id) if requester else None,
            requester_name=requester.name if requester else None,
            broadcast=broadcast,
            slip_status=slip_status, ocr_confidence=ocr_conf,
            ocr_simulated=False,
            created_at=now - timedelta(minutes=age_min),
        )
        await r.insert()

    # A donor locked out by a mistyped donation date, appealing with a certificate.
    await MedicalCertificate(
        donor_id=str(karim.id),
        donor_name=karim.name,
        note="Donation date was entered as 30 days ago; the real donation was 8 months back.",
        issued_at=now - timedelta(days=2),
        corrected_donation_date=now - timedelta(days=240),
    ).insert()

    eligible = [a for a in accounts.values() if a.is_donor and a.eligibility.eligible]
    print("Seed complete.")
    print(f"  Admin login  : {ADMIN_EMAIL} / {ADMIN_PASSWORD}")
    print(f"  Accounts     : {len(accounts_spec)}  (1 banned, 1 shadow-banned, 1 patient)")
    print(f"  Eligible now : {len(eligible)}/{sum(1 for a in accounts.values() if a.is_donor)} donors")
    for a in accounts.values():
        if a.is_donor and not a.eligibility.eligible:
            print(f"    - {a.name}: {'; '.join(a.eligibility.reasons)}")
    rare_types = {"O-", "A-", "B-", "AB-"}
    rare_donors = [a for a in accounts.values() if a.is_donor and a.blood_type in rare_types]
    print(f"  Rare pool    : {len(rare_donors)} donors across the city, "
          f"{sum(1 for a in rare_donors if a.eligibility.eligible)} eligible")
    print(f"  Requests     : {len(requests_spec)}  (1 needs-review slip, 1 shadow-muted, "
          "1 rare O-, 1 live rare AB- ready to dispatch)")
    print("  Certificates : 1 pending review")


if __name__ == "__main__":
    asyncio.run(seed())
