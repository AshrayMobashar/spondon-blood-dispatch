"""Seed data for the Admin console.

Creates:
  • one admin account            → login  admin@spondon.com / spondon123
  • several donor accounts        → incl. one already BANNED and one SHADOW_BANNED
  • several blood requests        → incl. a NEEDS_REVIEW OCR slip and a shadow-banned
                                    requester's request that shows OPEN but broadcast=False

Idempotent: wipes the admins collection and any seed-tagged docs, then reinserts.
Run:  python seed_admin.py
"""
import asyncio
from datetime import timedelta

from app.db import init_db
from app.models import (
    Donor, BloodRequest, Admin, Reliability, Eligibility, EligibilityCertificate,
    ACTIVE, BANNED, SHADOW_BANNED, WHOLE_BLOOD, PLATELET, utcnow,
)
from app import eligibility as engine
from app.security import hash_password

ADMIN_EMAIL = "admin@spondon.com"
ADMIN_PASSWORD = "spondon123"


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

    # ── Fresh donor + request sets (clear previous seed) ────────────
    await Donor.find_all().delete()
    await BloodRequest.find_all().delete()
    await EligibilityCertificate.find_all().delete()

    donors_spec = [
        # name, blood, phone, status, reason, flagged
        ("Rafiul Islam",  "O+", "01711000001", ACTIVE, None, 0),
        ("Nadia Akter",   "O+", "01711000002", ACTIVE, None, 0),
        ("Karim Uddin",   "B+", "01711000003", ACTIVE, None, 0),
        ("Tanvir Hasan",  "A+", "01711000004", BANNED, "Repeatedly abused emergency pings", 5),
        ("Shovon Ahmed",  "AB-","01711000005", SHADOW_BANNED, "Submitted 3 fake requests", 3),
    ]
    donors = {}
    # Feature 3 demo states, keyed by donor name:
    #   (weight_kg, days_since_donation or None, donation_type)
    elig_spec = {
        "Rafiul Islam": (68.0, 130, WHOLE_BLOOD),   # cooldown elapsed  → eligible
        "Nadia Akter":  (70.0, 40, WHOLE_BLOOD),    # 120-day lock      → locked (~80 left)
        "Karim Uddin":  (72.0, 5, PLATELET),        # 14-day lock       → locked (~9 left)
        "Tanvir Hasan": (48.0, 200, WHOLE_BLOOD),   # underweight       → weight-locked
        "Shovon Ahmed": (66.0, None, WHOLE_BLOOD),  # never donated     → eligible
    }

    for name, blood, phone, status, reason, flagged in donors_spec:
        weight, days_ago, dtype = elig_spec[name]
        last_donation = (now - timedelta(days=days_ago)) if days_ago is not None else None
        # Build the eligibility sub-document, then compute the flag from it.
        elig = Eligibility(weight_kg=weight, last_donation_date=last_donation, donation_type=dtype)
        result = engine.recalculate(weight, last_donation, dtype, now=now)
        elig.eligible = result["eligible"]
        elig.cooldown_locked = result["cooldown_locked"]
        elig.weight_locked = result["weight_locked"]
        elig.next_eligible_date = last_donation + timedelta(days=engine.lock_days_for(dtype)) if last_donation else None
        elig.last_recalculated = now

        d = Donor(
            name=name, blood_type=blood, phone=phone,
            status=status,
            status_reason=reason,
            status_by=admin.email if status != ACTIVE else None,
            status_at=now if status != ACTIVE else None,
            flagged_fake_requests=flagged,
            reliability=Reliability(),
            eligibility=elig,
        )
        await d.insert()
        donors[name] = d

    shovon = donors["Shovon Ahmed"]   # the shadow-banned account
    rafiul = donors["Rafiul Islam"]

    requests_spec = [
        # patient, hospital, blood, severity, status, requester, broadcast, slip_status, ocr_conf, age_min
        ("Mehedi Hassan",  "Dhaka Medical College",   "B+",  "LIFE_THREATENING", "OPEN",   rafiul, True,  "OCR_CONFIRMED", 0.97, 4),
        ("Ayesha Siddiqua","Square Hospital",         "O-",  "CRITICAL",         "OPEN",   rafiul, True,  "NEEDS_REVIEW",  0.42, 12),
        ("Rakib Hossain",  "United Hospital",         "A+",  "CRITICAL",         "LOCKED", None,   True,  "VERIFIED",      0.88, 40),
        ("Imran Kabir",    "Popular Diagnostic",      "AB+", "NORMAL",           "FULFILLED", None,True,  "OCR_CONFIRMED", 0.91, 180),
        # Shadow-banned requester: still OPEN (looks active to them) but never broadcast.
        ("Sultana Begum",  "Ibn Sina Hospital",       "O+",  "CRITICAL",         "OPEN",   shovon, False, "PENDING",       0.55, 8),
    ]
    for (patient, hospital, blood, severity, status, requester,
         broadcast, slip_status, ocr_conf, age_min) in requests_spec:
        r = BloodRequest(
            patient_name=patient, hospital=hospital, blood_type=blood,
            severity=severity, status=status,
            requester_id=str(requester.id) if requester else None,
            requester_name=requester.name if requester else None,
            broadcast=broadcast,
            slip_status=slip_status, ocr_confidence=ocr_conf,
            created_at=now - timedelta(minutes=age_min),
        )
        await r.insert()

    # ── Feature 3: a pending medical certificate for the admin review queue ──
    # Karim Uddin is mid-cooldown (platelet, ~9 days left). He claims his
    # donation date was mistyped and uploads a certificate to unlock early.
    karim = donors["Karim Uddin"]
    cert = EligibilityCertificate(
        donor_id=str(karim.id),
        donor_name=karim.name,
        file_url="https://files.spondon.app/cert/karim-demo.pdf",
        note="My platelet donation was 2 weeks earlier than recorded — please review.",
        claimed_donation_date=now - timedelta(days=20),
    )
    await cert.insert()

    print("Seed complete.")
    print(f"  Admin login  : {ADMIN_EMAIL} / {ADMIN_PASSWORD}")
    print(f"  Donors       : {len(donors_spec)}  (1 banned, 1 shadow-banned)")
    print(f"  Requests     : {len(requests_spec)}  (1 needs-review slip, 1 shadow-muted)")
    print(f"  Eligibility  : 2 eligible, 2 cooldown-locked, 1 weight-locked")
    print(f"  Certificates : 1 pending admin review (Karim Uddin)")


if __name__ == "__main__":
    asyncio.run(seed())
