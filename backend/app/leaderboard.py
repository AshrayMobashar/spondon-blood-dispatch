"""Module 3, Feature 1 — the Varsity Node Leaderboard.

A live, public ranking of universities by the number of emergency blood
requests their students fulfilled in a given calendar month. Two rules carry
the whole feature:

**Scoring.** One point per request that reached FULFILLED — an arrival that was
actually confirmed, not an acceptance. A donor who taps Accept and never shows
up scores nothing for their campus, which is what stops the board from becoming
a race to tap first.

**The tie-break.** Two universities finishing a month on the exact same number of
fulfilled requests are separated by their average *ping-to-acceptance* time —
the gap between the ping landing on a student's phone and that student securing
the request — and the faster campus ranks higher. Counting alone would leave
the two frozen in whatever order the database happened to return, so the board
would silently rank by insertion order and call it a result.

Months are calendar months in the deployment's local zone (Asia/Dhaka), not
UTC: a request fulfilled at 2 a.m. on 1 September in Dhaka belongs to
September, and bucketing it by UTC would score it for August.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException

from .config import TZ
from .models import Account, BloodRequest, University
from .services import local_now

# How many months of history the board publishes, counting the current one. A
# fixed window is what makes "you cannot look at next month" enforceable at the
# API rather than being a thing the UI politely declines to render.
MONTH_WINDOW = 12

MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

TIE_BREAK_RULE = (
    "Universities finishing level on fulfilled requests are separated by their "
    "average ping-to-acceptance time — the faster campus ranks higher."
)


# ── Month arithmetic ─────────────────────────────────────────────────
def month_label(year: int, month: int) -> str:
    return f"{MONTH_NAMES[month - 1]} {year}"


def month_key(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def current_month(now: Optional[datetime] = None) -> tuple[int, int]:
    """The month it is *locally*, which is the only month that can be 'current'."""
    local = local_now(now)
    return local.year, local.month


def shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    index = year * 12 + (month - 1) + delta
    return index // 12, index % 12 + 1


def parse_month(key: str) -> tuple[int, int]:
    """`"2026-08"` → `(2026, 8)`, or a 400 explaining the shape."""
    try:
        year_str, month_str = key.strip().split("-")
        year, month = int(year_str), int(month_str)
        if not (1 <= month <= 12) or year < 1970:
            raise ValueError
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=400,
            detail=f"month must look like 2026-08 (year-month) — got {key!r}.",
        )
    return year, month


def month_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    """The [start, end) instants of a local calendar month, in UTC.

    Mongo stores UTC, so the local month boundary has to be converted rather
    than compared directly — otherwise every month is six hours out of place on
    an Asia/Dhaka deployment.
    """
    start_local = datetime(year, month, 1, tzinfo=TZ)
    next_year, next_month = shift_month(year, month, 1)
    end_local = datetime(next_year, next_month, 1, tzinfo=TZ)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def published_months(now: Optional[datetime] = None) -> list[dict]:
    """The selectable window, oldest first, ending with the month in progress."""
    year, month = current_month(now)
    out = []
    for back in range(MONTH_WINDOW - 1, -1, -1):
        y, m = shift_month(year, month, -back)
        out.append({
            "key": month_key(y, m),
            "label": month_label(y, m),
            "short_label": MONTH_NAMES[m - 1][:3],
            "year": y,
            "month": m,
            "is_current": back == 0,
        })
    return out


def validate_month(key: Optional[str], now: Optional[datetime] = None) -> tuple[int, int]:
    """Resolve a requested month, refusing anything outside the published window.

    A future month is rejected rather than answered with an empty board: an
    empty board reads as "nobody donated", which is a very different claim from
    "that month has not happened yet".
    """
    cur_year, cur_month = current_month(now)
    if not key:
        return cur_year, cur_month

    year, month = parse_month(key)
    requested = year * 12 + month
    current = cur_year * 12 + cur_month

    if requested > current:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{month_label(year, month)} has not happened yet — the leaderboard "
                f"only publishes months up to {month_label(cur_year, cur_month)}."
            ),
        )
    if requested <= current - MONTH_WINDOW:
        oldest_y, oldest_m = shift_month(cur_year, cur_month, -(MONTH_WINDOW - 1))
        raise HTTPException(
            status_code=400,
            detail=(
                f"The leaderboard publishes the last {MONTH_WINDOW} months — "
                f"{month_label(year, month)} is older than "
                f"{month_label(oldest_y, oldest_m)}."
            ),
        )
    return year, month


# ── Formatting ───────────────────────────────────────────────────────
def format_duration(seconds: Optional[float]) -> Optional[str]:
    """Response times read as "4m 12s", not "252.0"."""
    if seconds is None:
        return None
    total = int(round(seconds))
    minutes, secs = divmod(total, 60)
    if minutes >= 60:
        hours, minutes = divmod(minutes, 60)
        return f"{hours}h {minutes}m"
    if minutes:
        return f"{minutes}m {secs}s"
    return f"{secs}s"


# ── Aggregation ──────────────────────────────────────────────────────
async def _score_month(start: datetime, end: datetime) -> dict[str, dict]:
    """Per-university totals for one month, keyed by university name.

    Done as a database aggregation rather than by pulling the month's requests
    into Python: the board is public and polled, and a month's fulfilled
    requests only ever grow.
    """
    pipeline = [
        {"$match": {
            "status": "FULFILLED",
            "fulfilled_at": {"$gte": start, "$lt": end},
            "secured_donor_university": {"$nin": [None, ""]},
        }},
        {"$group": {
            "_id": "$secured_donor_university",
            "fulfilled": {"$sum": 1},
            "units": {"$sum": {"$ifNull": ["$units", 1]}},
            # $avg and $min skip nulls, so a request whose ping was never logged
            # dilutes nothing — it simply does not vote on the tie-break.
            "avg_response_seconds": {"$avg": "$response_seconds"},
            "fastest_response_seconds": {"$min": "$response_seconds"},
            "responses_measured": {"$sum": {
                "$cond": [
                    {"$in": [{"$type": "$response_seconds"},
                             ["double", "int", "long", "decimal"]]},
                    1, 0,
                ]
            }},
            "donor_ids": {"$addToSet": "$secured_donor_id"},
        }},
    ]
    rows = await BloodRequest.aggregate(pipeline).to_list()
    return {row["_id"]: row for row in rows}


async def _registered_students() -> dict[str, int]:
    """How many donors each campus has on the platform — context for a rank.

    Ten fulfilments from a fifteen-student node is a different achievement from
    ten out of two hundred, and the board would be misleading without it.
    """
    pipeline = [
        {"$match": {"role": "donor", "university": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$university", "students": {"$sum": 1}}},
    ]
    rows = await Account.aggregate(pipeline).to_list()
    return {row["_id"]: row["students"] for row in rows}


def rank_entries(entries: list[dict]) -> list[dict]:
    """Order by fulfilled count, then by the tie-break, and annotate the ties.

    A university with no measured response times sorts last within its tie
    group: it has not shown it can answer faster, so it cannot claim the
    higher rank on that basis.
    """
    def sort_key(e):
        avg = e["avg_response_seconds"]
        return (
            -e["fulfilled"],
            avg if avg is not None else float("inf"),
            e["university"],           # deterministic when even the tie-break ties
        )

    ordered = sorted(entries, key=sort_key)

    # Competition ranking: only a genuinely inseparable pair — same score AND
    # the same average response — shares a rank.
    previous = None
    for index, entry in enumerate(ordered):
        signature = (entry["fulfilled"], entry["avg_response_seconds"])
        if previous is not None and signature == previous[0]:
            entry["rank"] = previous[1]
        else:
            entry["rank"] = index + 1
            previous = (signature, index + 1)

    _annotate_ties(ordered)
    return ordered


def _annotate_ties(ordered: list[dict]) -> None:
    """Explain, on each tied entry, why it landed above or below its rivals."""
    groups: dict[int, list[dict]] = {}
    for entry in ordered:
        groups.setdefault(entry["fulfilled"], []).append(entry)

    for fulfilled, group in groups.items():
        if fulfilled == 0 or len(group) < 2:
            continue
        names = [e["university"] for e in group]
        for position, entry in enumerate(group):
            entry["tied_with"] = [n for n in names if n != entry["university"]]
            entry["tie_broken"] = True
            avg = format_duration(entry["avg_response_seconds"])
            others = _humanise(entry["tied_with"])
            if entry["avg_response_seconds"] is None:
                entry["tie_break_note"] = (
                    f"Level with {others} on {fulfilled} fulfilled, but no "
                    "ping-to-acceptance times were recorded — ranked last of the tie."
                )
            elif position == 0:
                entry["tie_break_note"] = (
                    f"Level with {others} on {fulfilled} fulfilled — ranked higher on a "
                    f"faster {avg} average ping-to-acceptance."
                )
            else:
                ahead = group[position - 1]
                entry["tie_break_note"] = (
                    f"Level with {others} on {fulfilled} fulfilled — ranked below "
                    f"{ahead['university']}, whose "
                    f"{format_duration(ahead['avg_response_seconds'])} average "
                    f"ping-to-acceptance beat this node's {avg}."
                )


def _humanise(names: list[str]) -> str:
    if len(names) == 1:
        return names[0]
    return ", ".join(names[:-1]) + f" and {names[-1]}"


async def build_board(year: int, month: int, now: Optional[datetime] = None) -> dict:
    """The published board for one month, ranks and tie-break notes included."""
    start, end = month_bounds(year, month)
    scores = await _score_month(start, end)
    students = await _registered_students()

    roster = await University.find_all().sort(University.name).to_list()
    short_names = {u.name: u.short_name for u in roster}
    # Any campus that scored is on the board whether or not it is on the roster,
    # so a donor whose university was added by hand is never quietly unscored.
    names = sorted(set(short_names) | set(scores) | set(students))

    entries = []
    for name in names:
        row = scores.get(name, {})
        entries.append({
            "university": name,
            "short_name": short_names.get(name) or _initials(name),
            "fulfilled": row.get("fulfilled", 0),
            "units": row.get("units", 0),
            "donors": len([d for d in row.get("donor_ids", []) if d]),
            "registered_students": students.get(name, 0),
            "avg_response_seconds": row.get("avg_response_seconds"),
            "avg_response_label": format_duration(row.get("avg_response_seconds")),
            "fastest_response_seconds": row.get("fastest_response_seconds"),
            "fastest_response_label": format_duration(row.get("fastest_response_seconds")),
            "responses_measured": row.get("responses_measured", 0),
            "tied_with": [],
            "tie_broken": False,
            "tie_break_note": None,
        })

    ranked = rank_entries(entries)

    # Movement against the month before, so a rank reads as a change and not
    # just a number. The month before the window's oldest is still in the
    # database, so the oldest published month gets real movement too.
    prev_year, prev_month = shift_month(year, month, -1)
    prev_start, prev_end = month_bounds(prev_year, prev_month)
    prev_scores = await _score_month(prev_start, prev_end)
    prev_ranked = rank_entries([
        {
            "university": name,
            "fulfilled": row.get("fulfilled", 0),
            "avg_response_seconds": row.get("avg_response_seconds"),
        }
        for name, row in prev_scores.items()
    ])
    prev_rank = {e["university"]: e["rank"] for e in prev_ranked if e["fulfilled"] > 0}

    for entry in ranked:
        was = prev_rank.get(entry["university"])
        entry["previous_rank"] = was
        # Positive = climbed. A node with no score last month has nothing to
        # have climbed from, so it reports "new" rather than a fake +8.
        entry["movement"] = (was - entry["rank"]) if was and entry["fulfilled"] else None

    scored = [e for e in ranked if e["fulfilled"] > 0]
    measured = [e for e in scored if e["avg_response_seconds"] is not None]
    cur_year, cur_month = current_month(now)

    return {
        "month": month_key(year, month),
        "label": month_label(year, month),
        "is_current_month": (year, month) == (cur_year, cur_month),
        "generated_at": local_now(now).isoformat(),
        "tie_break_rule": TIE_BREAK_RULE,
        "totals": {
            "fulfilled": sum(e["fulfilled"] for e in scored),
            "units": sum(e["units"] for e in scored),
            "universities_scored": len(scored),
            "universities_listed": len(ranked),
            "donors": sum(e["donors"] for e in scored),
            "avg_response_seconds": (
                sum(e["avg_response_seconds"] for e in measured) / len(measured)
                if measured else None
            ),
        },
        "ties": sorted({e["fulfilled"] for e in scored if e["tie_broken"]}, reverse=True),
        "entries": ranked,
    }


async def resolve_university(name: Optional[str]) -> Optional[str]:
    """Canonical roster name for whatever a client sent, or a 400.

    Sign-up sends a campus as free text, and letting "BRACU", "bracu" and "BRAC
    University" through as written would split one node into three on the board
    — each with a third of the score. Matching against the roster (by full name
    or short name, case-insensitively) collapses them back to one.

    An empty string clears the campus, which is how a donor says "not a student".
    """
    if name is None:
        return None
    cleaned = " ".join(name.split())
    if not cleaned:
        return None

    key = cleaned.casefold()
    roster = await University.find_all().to_list()
    for uni in roster:
        if key in (uni.name.casefold(), uni.short_name.casefold()):
            return uni.name

    known = ", ".join(sorted(u.short_name for u in roster)) or "none registered yet"
    raise HTTPException(
        status_code=400,
        detail=f"{cleaned!r} is not a registered varsity node. Known nodes: {known}.",
    )


def _initials(name: str) -> str:
    """Fallback short name for a campus that was never added to the roster."""
    letters = [w[0] for w in name.split() if w and w[0].isalpha()]
    return ("".join(letters[:4]) or name[:4]).upper()
