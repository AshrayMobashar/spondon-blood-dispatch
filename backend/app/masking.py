"""Number masking and the rentable GSM proxy pool behind Direct-Connect calling.

The promise the feature makes is narrow and worth stating exactly: a family and
their donor can talk, and **neither ever learns the other's number, nor is the
pairing of the two numbers ever written down**. Two mechanisms enforce it.

*Masking.* Real numbers are read from `Account` at dial time and dropped. Nothing
that persists — the call session, its audit trail, the server log — holds more
than the last two digits, which are there so a support ticket can say "the call
to the line ending 47" without becoming a way to ring it.

*A borrowed number, not a forwarded one.* The GSM fallback lends the pair a
Spondon-owned number from a pool. Both sides dial that; the bridge decides who
they reach by which of them is calling. The number is safe to display precisely
because it belongs to the platform, and it stops resolving the moment the call
ends and it goes back in the pool.

The pool is a Mongo collection rather than a config list because a claim must be
atomic. Two calls degrading in the same second and being handed the same number
would connect each family to the other's donor — a privacy failure produced by a
race, which is exactly the class of bug the concurrency lock already taught this
codebase to take seriously.
"""
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from pymongo import ReturnDocument

from . import config
from .db import get_collection
from .models import ProxyNumber

log = logging.getLogger("spondon.masking")


def mask_phone(phone: Optional[str]) -> Optional[str]:
    """`01711000047` → `•••••••••47`.

    Two digits is a label, not a lead: it distinguishes two lines in a support
    conversation while leaving 10^9 candidates for anyone hoping to dial it.
    """
    if not phone:
        return None
    digits = "".join(ch for ch in phone if ch.isdigit())
    if len(digits) <= 2:
        return "•" * len(digits)
    return "•" * (len(digits) - 2) + digits[-2:]


def new_room() -> str:
    """An unguessable VOIP room name.

    Deriving it from the request id would let anyone who learned that id join a
    stranger's call; 128 bits of randomness means the room name itself is the
    capability, on top of the authorisation check the endpoint already does.
    """
    return f"spondon-{secrets.token_urlsafe(16)}"


def voice_bridge_configured() -> bool:
    return bool(config.VOICE_BRIDGE_URL)


# ── The pool ─────────────────────────────────────────────────────────
async def ensure_pool() -> int:
    """Make the configured numbers exist as pool rows. Idempotent.

    Called lazily on first allocation rather than at startup, so the API still
    boots while Mongo is down — the same reasoning as everywhere else here.
    """
    created = 0
    for number in config.GSM_PROXY_NUMBERS:
        existing = await ProxyNumber.find_one(ProxyNumber.number == number)
        if existing is None:
            await ProxyNumber(number=number).insert()
            created += 1
    return created


async def claim_number(session_id: str) -> Optional[str]:
    """Rent one free number, atomically. None when the pool is exhausted.

    The conditional update is the whole safety property: `in_use: False` is
    tested and flipped in one document write, so of any number of simultaneous
    fallbacks exactly one can win each number.
    """
    await ensure_pool()
    collection = get_collection(ProxyNumber)
    claimed = await collection.find_one_and_update(
        {"in_use": False},
        {
            "$set": {
                "in_use": True,
                "session_id": session_id,
                "claimed_at": datetime.now(timezone.utc),
                "released_at": None,
            },
            "$inc": {"lifetime_claims": 1},
        },
        return_document=ReturnDocument.AFTER,
    )
    if claimed is None:
        log.warning("GSM proxy pool exhausted — no number free for session %s", session_id)
        return None
    return claimed["number"]


async def release_number(session_id: str) -> Optional[str]:
    """Return this session's number to the pool and break its mapping."""
    collection = get_collection(ProxyNumber)
    released = await collection.find_one_and_update(
        {"session_id": session_id, "in_use": True},
        {
            "$set": {
                "in_use": False,
                "session_id": None,
                "released_at": datetime.now(timezone.utc),
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    return released["number"] if released else None


async def pool_status() -> dict:
    """Free/total counts — surfaced to the admin console, never the numbers."""
    await ensure_pool()
    total = await ProxyNumber.find_all().count()
    in_use = await ProxyNumber.find(ProxyNumber.in_use == True).count()  # noqa: E712
    return {"total": total, "in_use": in_use, "free": total - in_use}


# ── The bridge leg ───────────────────────────────────────────────────
async def open_gsm_leg(proxy_number: str, *, caller: Optional[str],
                       callee: Optional[str], session_id: str) -> dict:
    """Register the pair → proxy mapping with the telephony provider.

    Real numbers pass through this call and are not returned by it. With no
    provider configured the leg is simulated and says so — the number is still
    allocated and still displayed, so the fallback is demonstrable end to end
    without a telephony account, and the response never claims a call was placed.
    """
    if not voice_bridge_configured():
        log.info(
            "[voice:simulated] session=%s proxy=%s caller=%s callee=%s",
            session_id, proxy_number, mask_phone(caller), mask_phone(callee),
        )
        return {
            "connected": False,
            "simulated": True,
            "note": "No voice bridge configured — set VOICE_BRIDGE_URL to place real calls.",
        }

    import httpx

    payload = {
        "session_id": session_id,
        "proxy_number": proxy_number,
        "participants": [caller, callee],
        "ttl_minutes": config.CALL_SESSION_TTL_MINUTES,
    }
    headers = {"Authorization": f"Bearer {config.VOICE_BRIDGE_KEY}"} if config.VOICE_BRIDGE_KEY else {}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
            res = await client.post(config.VOICE_BRIDGE_URL, json=payload, headers=headers)
        return {
            "connected": res.status_code < 400,
            "simulated": False,
            "status_code": res.status_code,
        }
    except Exception as exc:
        # A dead bridge must not swallow the call: the caller still gets the
        # number and can dial it manually.
        log.warning("Voice bridge failed for session %s: %s", session_id, exc)
        return {"connected": False, "simulated": False, "error": str(exc)}


async def close_gsm_leg(proxy_number: Optional[str], session_id: str) -> None:
    if not proxy_number or not voice_bridge_configured():
        return
    import httpx

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
            await client.delete(
                f"{config.VOICE_BRIDGE_URL.rstrip('/')}/{session_id}",
                headers=(
                    {"Authorization": f"Bearer {config.VOICE_BRIDGE_KEY}"}
                    if config.VOICE_BRIDGE_KEY else {}
                ),
            )
    except Exception as exc:
        log.warning("Voice bridge teardown failed for %s: %s", session_id, exc)


def session_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(minutes=config.CALL_SESSION_TTL_MINUTES)
