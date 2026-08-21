"""Module 3, Feature 1 — Varsity Node Leaderboard endpoints.

Public and unauthenticated by design: the board is the gamification, and a
ranking nobody can see without an account cannot start an inter-campus
competition. Nothing here exposes an individual — the response carries campus
totals and counts, never a donor name, phone number or location, the same line
the dispatch radar draws in `app.zones`.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..leaderboard import (
    MONTH_WINDOW, TIE_BREAK_RULE, build_board, published_months, validate_month,
)
from ..models import University

router = APIRouter(prefix="/leaderboard", tags=["Module 3 — Varsity Node Leaderboard"])


@router.get("/months", summary="The months the leaderboard publishes")
async def months():
    """The selectable window: the last 12 months, ending with the one in progress.

    The client builds its month picker from this rather than from the device
    clock, so "no future months" is one rule, enforced once, on the server.
    """
    window = published_months()
    return {
        "months": window,
        "current": next(m["key"] for m in window if m["is_current"]),
        "window_months": MONTH_WINDOW,
    }


@router.get("/universities", summary="Campuses registered as varsity nodes")
async def universities():
    """The roster, for the board and for the campus picker at donor sign-up."""
    roster = await University.find_all().sort(University.name).to_list()
    return [
        {"id": str(u.id), "name": u.name, "short_name": u.short_name, "city": u.city}
        for u in roster
    ]


@router.get("", summary="Monthly ranking of universities by fulfilled requests")
async def leaderboard(
    month: Optional[str] = Query(
        None,
        description="Calendar month as YYYY-MM. Defaults to the month in progress. "
                    "A future month is refused.",
        examples=["2026-08"],
    ),
):
    """Rank the varsity nodes for one month.

    Points are fulfilled requests. Universities level on points are separated by
    average ping-to-acceptance time, fastest first — each tied entry carries a
    `tie_break_note` saying exactly why it sits where it does.
    """
    year, month_num = validate_month(month)
    return await build_board(year, month_num)


@router.get("/{university_name}", summary="One campus's month in detail")
async def university_month(university_name: str, month: Optional[str] = Query(None)):
    """The single row for one campus, with its rank in context.

    Used by a node's own students to check their standing without parsing the
    whole board.
    """
    year, month_num = validate_month(month)
    board = await build_board(year, month_num)
    # Either name works: students say "BRACU", the roster says "BRAC University".
    key = university_name.strip().casefold()
    match = next(
        (e for e in board["entries"]
         if key in (e["university"].casefold(), e["short_name"].casefold())),
        None,
    )
    if match is None:
        raise HTTPException(
            status_code=404,
            detail=f"{university_name!r} is not a registered varsity node.",
        )
    return {
        "month": board["month"],
        "label": board["label"],
        "tie_break_rule": TIE_BREAK_RULE,
        "of_universities": board["totals"]["universities_listed"],
        "entry": match,
    }
