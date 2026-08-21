"""Dummy dataset for the Varsity Node Leaderboard (Module 3, Feature 1).

Creates:
  • 10 universities                → the roster the board ranks
  • ~110 student donors            → phones in the reserved 0179xxxxxxx block
  • 13 months of fulfilled requests → 12 published months + one extra behind the
                                      window, so the oldest published month has
                                      a real month to show movement against
  • deliberate ties                 → the current month ends level at the top,
                                      and a past month ends in a three-way tie,
                                      so the tie-break rule is visible rather
                                      than theoretical
  • requests that must NOT score    → OPEN, LOCKED and NO_SHOW requests in the
                                      current month, plus fulfilments by donors
                                      who belong to no campus

Every fulfilled request carries the two fields the board reads: `fulfilled_at`
(the arrival, which is what scores) and `response_seconds` (ping-to-acceptance,
which breaks a tie). In the live app both are stamped by the accept/arrival
endpoints; here they are generated directly.

Idempotent, and deliberately narrow: it only ever deletes the universities and
the accounts in its own reserved phone block, plus the requests attached to
them. Running it leaves `seed_admin.py`'s data alone, and vice versa.

Run:  python seed_leaderboard.py
"""
import asyncio
import random
from datetime import datetime, timedelta

from beanie import PydanticObjectId

from app.config import WHOLE_BLOOD, PLATELETS
from app.db import init_db
from app.eligibility import recalculate
from app.leaderboard import build_board, current_month, month_bounds, shift_month
from app.models import (
    Account, BloodRequest, GeoPoint, HealthProfile, University,
    ACTIVE, ROLE_DONOR, utcnow,
)

# Seeded students live in one phone block so this script can find and replace
# exactly its own data without touching a real registration.
PHONE_PREFIX = "0179"

# Reproducible: the same run produces the same board, so the tie-break can be
# demonstrated twice and give the same answer both times.
RNG = random.Random(1184)

# name, short name, monthly volume, base ping-to-acceptance seconds
# The speeds are what decide a tie: BRACU and NSU are seeded to finish the
# current month level on points, with BRACU answering meaningfully faster.
UNIVERSITIES = [
    ("BRAC University",                            "BRACU", 9, 165),
    ("North South University",                     "NSU",   9, 305),
    ("University of Dhaka",                        "DU",    8, 250),
    ("Bangladesh University of Engineering and Technology", "BUET", 7, 195),
    ("Jahangirnagar University",                   "JU",    6, 340),
    ("East West University",                       "EWU",   5, 275),
    ("Independent University, Bangladesh",         "IUB",   5, 230),
    ("American International University-Bangladesh", "AIUB", 4, 410),
    ("United International University",            "UIU",   4, 290),
    ("Daffodil International University",          "DIU",   3, 360),
]

FIRST_NAMES = [
    "Rafiul", "Nadia", "Karim", "Tanvir", "Shovon", "Mitu", "Sabbir", "Farhana",
    "Rezaul", "Nusrat", "Adnan", "Sharmin", "Tanjim", "Rumana", "Zahid", "Priya",
    "Shakil", "Naznin", "Arif", "Sadia", "Mahmudul", "Ishrat", "Fahim", "Tasnim",
    "Rakib", "Anika", "Sabbith", "Jarin", "Nafis", "Maliha", "Sourav", "Raisa",
    "Ontor", "Samira", "Tahmid", "Zarin", "Ashraf", "Lamia", "Sifat", "Nabila",
]
LAST_NAMES = [
    "Islam", "Akter", "Uddin", "Hasan", "Ahmed", "Rahman", "Khan", "Chowdhury",
    "Haque", "Sultana", "Kabir", "Mahmud", "Das", "Noor", "Jahan", "Alam",
]

BLOOD_TYPES = ["O+", "A+", "B+", "AB+", "O-", "A-", "B-", "AB-"]
BLOOD_WEIGHTS = [30, 22, 20, 8, 8, 5, 5, 2]      # roughly the Bangladeshi mix

HOSPITALS = [
    ("Dhaka Medical College", 23.7261, 90.3969),
    ("Square Hospital", 23.7529, 90.3789),
    ("United Hospital", 23.8029, 90.4152),
    ("Ibn Sina Hospital", 23.7465, 90.3745),
    ("Popular Diagnostic Centre", 23.7508, 90.3812),
    ("Evercare Hospital", 23.8103, 90.4256),
    ("BIRDEM General Hospital", 23.7387, 90.3960),
    ("Labaid Specialized Hospital", 23.7452, 90.3801),
]

PATIENT_NAMES = [
    "Mehedi Hassan", "Ayesha Siddiqua", "Rakib Hossain", "Sultana Begum",
    "Farzana Islam", "Jubayer Alam", "Rehana Parvin", "Omar Faruk",
    "Shirin Akhter", "Nazmul Huda", "Taslima Nasrin", "Kamrul Islam",
]

MONTHS_OF_HISTORY = 13      # 12 published + 1 behind the window, for movement


async def _wipe_previous_seed() -> int:
    """Remove only what a previous run of *this* script created."""
    seeded = await Account.find(
        {"phone": {"$regex": f"^{PHONE_PREFIX}"}}
    ).to_list()
    ids = [str(a.id) for a in seeded]
    removed = 0
    if ids:
        result = await BloodRequest.find(
            {"$or": [{"secured_donor_id": {"$in": ids}}, {"requester_id": {"$in": ids}}]}
        ).delete()
        removed = getattr(result, "deleted_count", 0) or 0
        await Account.find({"_id": {"$in": [a.id for a in seeded]}}).delete()
    await University.find_all().delete()
    return removed


async def seed():
    await init_db()
    now = utcnow()
    removed = await _wipe_previous_seed()

    # ── Roster ──────────────────────────────────────────────────────
    for name, short, _, _ in UNIVERSITIES:
        await University(name=name, short_name=short).insert()

    # ── Student donors ──────────────────────────────────────────────
    students: dict[str, list[Account]] = {}
    phone_seq = 1
    used_names = set()
    for name, short, volume, _speed in UNIVERSITIES:
        # A bigger node fields more students, which is what makes "12 fulfilled
        # from 9 students" and "12 from 31" read differently on the board.
        roll = RNG.randint(volume, volume * 2 + 4)
        cohort = []
        for _ in range(roll):
            student_name = _unique_name(used_names)
            phone = f"{PHONE_PREFIX}{phone_seq:07d}"
            phone_seq += 1
            lat, lng = _campus_jitter()
            account = Account(
                name=student_name,
                blood_type=RNG.choices(BLOOD_TYPES, weights=BLOOD_WEIGHTS)[0],
                role=ROLE_DONOR,
                phone=phone,
                phone_verified=True,
                university=name,
                fcm_token=f"fcm_{short.lower()}_{phone_seq}",
                health=HealthProfile(weight_kg=round(RNG.uniform(52, 88), 1),
                                     weight_updated_at=now),
                status=ACTIVE,
                current_location=GeoPoint(lat=lat, lng=lng, updated_at=now),
                created_at=now - timedelta(days=RNG.randint(200, 900)),
            )
            # Minted here rather than by the insert: the requests below store
            # the donor id, and they are built before anything reaches Mongo.
            account.id = PydanticObjectId()
            cohort.append(account)
        students[name] = cohort

    # A handful of donors who are not students anywhere. Their fulfilments are
    # real donations that simply score for nobody — the board must not invent a
    # campus for them.
    unaffiliated = []
    for _ in range(6):
        phone = f"{PHONE_PREFIX}{phone_seq:07d}"
        phone_seq += 1
        account = Account(
            name=_unique_name(used_names),
            blood_type=RNG.choices(BLOOD_TYPES, weights=BLOOD_WEIGHTS)[0],
            role=ROLE_DONOR, phone=phone, phone_verified=True,
            health=HealthProfile(weight_kg=round(RNG.uniform(52, 88), 1),
                                 weight_updated_at=now),
            current_location=GeoPoint(lat=23.75, lng=90.39, updated_at=now),
            created_at=now - timedelta(days=RNG.randint(200, 900)),
        )
        account.id = PydanticObjectId()
        unaffiliated.append(account)

    # ── Monthly volumes, with the ties engineered in ────────────────
    cur_year, cur_month = current_month(now)
    months = [shift_month(cur_year, cur_month, -back)
              for back in range(MONTHS_OF_HISTORY - 1, -1, -1)]

    speeds = {name: speed for name, _, _, speed in UNIVERSITIES}
    plan: dict[tuple[int, int], dict[str, int]] = {}
    for index, (year, month) in enumerate(months):
        is_current = (year, month) == (cur_year, cur_month)
        # The month in progress is only as far along as today, so it carries a
        # part-month's worth of donations rather than a full one.
        elapsed = _month_progress(year, month, now) if is_current else 1.0
        counts = {}
        for name, _short, volume, _speed in UNIVERSITIES:
            # A slow drift per node across the year, so ranks actually move.
            drift = 1.0 + 0.05 * (index - MONTHS_OF_HISTORY / 2) * RNG.uniform(-1, 1)
            base = volume * drift * elapsed
            counts[name] = max(0, int(round(RNG.gauss(base, base * 0.3))))
        plan[(year, month)] = counts

    _force_tie(plan[(cur_year, cur_month)], size=2)          # live, at the top
    tie_year, tie_month = months[-6]
    _force_tie(plan[(tie_year, tie_month)], size=3)          # a settled month

    # ── Fulfilled requests ──────────────────────────────────────────
    requests: list[BloodRequest] = []
    donations: dict[str, list[datetime]] = {}
    for (year, month), counts in plan.items():
        start, end = month_bounds(year, month)
        end = min(end, now)
        if end <= start:
            continue
        for uni_name, count in counts.items():
            cohort = students[uni_name]
            for _ in range(count):
                donor = RNG.choice(cohort)
                response = _response_seconds(speeds[uni_name])
                req = _fulfilled_request(donor, uni_name, start, end, response)
                requests.append(req)
                donations.setdefault(str(donor.id), []).append(req.fulfilled_at)

    # Fulfilments by unaffiliated donors — excluded from every campus total.
    start, end = month_bounds(cur_year, cur_month)
    end = min(end, now)
    for _ in range(4):
        donor = RNG.choice(unaffiliated)
        req = _fulfilled_request(donor, None, start, end, _response_seconds(280))
        requests.append(req)
        donations.setdefault(str(donor.id), []).append(req.fulfilled_at)

    # One fulfilment accepted with no ping behind it (a donor who opened the
    # request from their dashboard). It scores a point but casts no vote on the
    # tie-break — `$avg` skips it rather than reading the gap as zero.
    donor = RNG.choice(students["University of Dhaka"])
    req = _fulfilled_request(donor, "University of Dhaka", start, end, None)
    requests.append(req)
    donations.setdefault(str(donor.id), []).append(req.fulfilled_at)

    # ── Requests that must not score ────────────────────────────────
    unscored = 0
    for status in ("OPEN", "OPEN", "LOCKED", "LOCKED", "NO_SHOW"):
        donor = RNG.choice(students["BRAC University"])
        hospital, lat, lng = RNG.choice(HOSPITALS)
        created = _between(start, end)
        secured = created + timedelta(seconds=_response_seconds(200))
        requests.append(BloodRequest(
            patient_name=RNG.choice(PATIENT_NAMES),
            hospital=hospital,
            blood_type=donor.blood_type,
            component=WHOLE_BLOOD,
            units=1,
            severity=RNG.choice(["CRITICAL", "LIFE_THREATENING", "NORMAL"]),
            status=status,
            hospital_location=GeoPoint(lat=lat, lng=lng),
            # An accepted-but-unfulfilled request already knows which campus
            # *would* score; it just never reaches `fulfilled_at`.
            secured_donor_id=str(donor.id) if status != "OPEN" else None,
            secured_donor_name=donor.name if status != "OPEN" else None,
            secured_donor_university=donor.university if status != "OPEN" else None,
            secured_at=secured if status != "OPEN" else None,
            response_seconds=(secured - created).total_seconds() if status != "OPEN" else None,
            slip_status="OCR_CONFIRMED",
            ocr_confidence=0.93,
            created_at=created,
        ))
        unscored += 1

    # ── Persist ─────────────────────────────────────────────────────
    # Donation history is derived from the requests each student actually
    # fulfilled, so their cooldown and donation count agree with the board
    # instead of being asserted separately.
    everyone = [a for cohort in students.values() for a in cohort] + unaffiliated
    for account in everyone:
        dates = sorted(donations.get(str(account.id), []))
        if dates:
            account.health.donation_count = len(dates)
            account.health.last_donation_date = dates[-1]
            account.health.last_donation_type = WHOLE_BLOOD
        recalculate(account, now=now)
    await Account.insert_many(everyone)
    await BloodRequest.insert_many(requests)

    # ── Report ──────────────────────────────────────────────────────
    board = await build_board(cur_year, cur_month, now=now)
    scored = [e for e in board["entries"] if e["fulfilled"]]

    print("Varsity Node Leaderboard seed complete.")
    print(f"  Cleared      : {removed} request(s) from a previous run")
    print(f"  Universities : {len(UNIVERSITIES)}")
    print(f"  Students     : {len(everyone) - len(unaffiliated)} "
          f"(+{len(unaffiliated)} donors with no campus)")
    print(f"  Requests     : {len(requests)}  ({unscored} deliberately unscored)")
    print(f"  History      : {MONTHS_OF_HISTORY} months ending {board['label']}")
    print()
    # Plain ASCII: a Windows console defaults to cp1252 and would raise on an
    # em dash rather than print the summary this script exists to show.
    print(f"  {board['label']} - live board (partial month)")
    for entry in scored[:5]:
        flag = "  <- tie-break" if entry["tie_broken"] else ""
        print(f"    {entry['rank']}. {entry['short_name']:<6} "
              f"{entry['fulfilled']:>3} fulfilled   "
              f"avg {entry['avg_response_label'] or '-':>8}{flag}")
    for entry in scored:
        if entry["tie_broken"]:
            note = entry["tie_break_note"].replace("—", "-")
            print(f"\n  Tie-break - {entry['short_name']}: {note}")


# ── helpers ──────────────────────────────────────────────────────────
def _unique_name(used: set) -> str:
    for _ in range(200):
        name = f"{RNG.choice(FIRST_NAMES)} {RNG.choice(LAST_NAMES)}"
        if name not in used:
            used.add(name)
            return name
    name = f"{RNG.choice(FIRST_NAMES)} {RNG.choice(LAST_NAMES)} {len(used)}"
    used.add(name)
    return name


def _campus_jitter() -> tuple[float, float]:
    """A plausible Dhaka address — students are scattered, not stacked on a pin."""
    return round(RNG.uniform(23.70, 23.88), 4), round(RNG.uniform(90.35, 90.44), 4)


def _month_progress(year: int, month: int, now: datetime) -> float:
    """How much of the current month has actually elapsed (0–1)."""
    start, end = month_bounds(year, month)
    return max(0.05, min(1.0, (now - start).total_seconds() / (end - start).total_seconds()))


def _between(start: datetime, end: datetime) -> datetime:
    span = (end - start).total_seconds()
    return start + timedelta(seconds=RNG.uniform(0, max(span, 1)))


def _response_seconds(base: float) -> float:
    """Ping-to-acceptance around a campus's characteristic speed.

    Clamped to a range a phone alert plausibly produces: nobody answers in two
    seconds, and past half an hour the ripple has already widened past them.
    """
    return round(max(25.0, min(1800.0, RNG.gauss(base, base * 0.35))), 1)


def _fulfilled_request(
    donor: Account, university, start: datetime, end: datetime, response
) -> BloodRequest:
    fulfilled_at = _between(start, end)
    accepted_at = fulfilled_at - timedelta(minutes=RNG.randint(35, 220))
    created_at = accepted_at - timedelta(seconds=response or RNG.randint(60, 600))
    hospital, lat, lng = RNG.choice(HOSPITALS)
    component = PLATELETS if RNG.random() < 0.15 else WHOLE_BLOOD
    return BloodRequest(
        patient_name=RNG.choice(PATIENT_NAMES),
        hospital=hospital,
        blood_type=donor.blood_type,
        component=component,
        units=1 if component == PLATELETS else RNG.choice([1, 1, 1, 2]),
        severity=RNG.choices(
            ["NORMAL", "CRITICAL", "LIFE_THREATENING"], weights=[3, 5, 2]
        )[0],
        status="FULFILLED",
        hospital_location=GeoPoint(lat=lat, lng=lng),
        secured_donor_id=str(donor.id),
        secured_donor_name=donor.name,
        secured_donor_phone=donor.phone,
        secured_donor_university=university,
        secured_at=accepted_at,
        response_seconds=response,
        fulfilled_at=fulfilled_at,
        slip_status="OCR_CONFIRMED",
        ocr_confidence=round(RNG.uniform(0.82, 0.99), 2),
        created_at=created_at,
    )


def _force_tie(counts: dict[str, int], size: int) -> None:
    """Make the top `size` universities of a month finish on identical points.

    A tie that only shows up when the random numbers happen to collide is a
    corner case nobody can demonstrate on request. Forcing one guarantees the
    board has a real tie to break — and the campuses' different response speeds
    are what then separates them.
    """
    ordered = sorted(counts, key=lambda n: (-counts[n], n))
    top = ordered[:size]
    target = max(counts[n] for n in top) or 3
    for name in top:
        counts[name] = target


if __name__ == "__main__":
    asyncio.run(seed())
