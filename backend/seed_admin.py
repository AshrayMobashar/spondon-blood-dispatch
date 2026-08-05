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
    Donor, BloodRequest, Admin, Reliability,
    ACTIVE, BANNED, SHADOW_BANNED, utcnow,
)
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

    donors_spec = [
        # name, blood, phone, status, reason, flagged
        ("Rafiul Islam",  "O+", "01711000001", ACTIVE, None, 0),
        ("Nadia Akter",   "O+", "01711000002", ACTIVE, None, 0),
        ("Karim Uddin",   "B+", "01711000003", ACTIVE, None, 0),
        ("Tanvir Hasan",  "A+", "01711000004", BANNED, "Repeatedly abused emergency pings", 5),
        ("Shovon Ahmed",  "AB-","01711000005", SHADOW_BANNED, "Submitted 3 fake requests", 3),
    ]
    donors = {}
    for name, blood, phone, status, reason, flagged in donors_spec:
        d = Donor(
            name=name, blood_type=blood, phone=phone,
            status=status,
            status_reason=reason,
            status_by=admin.email if status != ACTIVE else None,
            status_at=now if status != ACTIVE else None,
            flagged_fake_requests=flagged,
            reliability=Reliability(),
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

    print("Seed complete.")
    print(f"  Admin login : {ADMIN_EMAIL} / {ADMIN_PASSWORD}")
    print(f"  Donors      : {len(donors_spec)}  (1 banned, 1 shadow-banned)")
    print(f"  Requests    : {len(requests_spec)}  (1 needs-review slip, 1 shadow-muted)")


if __name__ == "__main__":
    asyncio.run(seed())
