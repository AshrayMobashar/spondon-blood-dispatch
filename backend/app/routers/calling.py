"""Module 3, Feature 2 — Direct-Connect Masked Calling.

A donor accepts; a call button appears for both sides; they sort out which gate
of the hospital to meet at. Neither ever sees the other's number, and no record
pairing the two numbers is written anywhere — see `app.masking` for how that is
enforced rather than merely intended.

The corner case is the one that actually happens: VOIP inside a hospital
building, on a congested 3G cell two floors underground, degrading to unusable.
The client measures its own leg and, when it drops below the configured floor
for long enough, calls `/fallback` here. The **same session** switches to a
borrowed GSM number both parties dial, so the conversation continues rather than
being restarted. Session id, participants and audit trail are unchanged — only
the transport moves.

Placement note: the fallback is triggered client-side because the client is the
only party that can measure its own media quality. The server keeps everything
that matters — who may open a channel, which number is lent out, and when it is
taken back — so a client that lies about call quality can force a transport
switch and nothing more.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from .. import config, masking
from ..models import (
    Account, BloodRequest, CallSession,
    CALL_ACTIVE, CALL_ENDED, CALL_EXPIRED, CALL_MODE_GSM, CALL_MODE_VOIP,
)
from ..realtime import feed, trip_room
from ..schemas import CallEndIn, CallFallbackIn
from ..security import get_current_account
from ..services import to_oid, utcnow

log = logging.getLogger("spondon.calling")

router = APIRouter()


# ── Serialisation ────────────────────────────────────────────────────
def _public_session(session: CallSession, *, peer_label: str,
                    peer_masked: Optional[str] = None) -> dict:
    """What a participant may know about their own call.

    `peer_masked` carries the last two digits and nothing more — enough to tell
    one line from another in a support conversation, useless for dialling. The
    only dialable value here is the platform's own proxy number.
    """
    return {
        "session_id": str(session.id),
        "request_id": session.request_id,
        "status": session.status,
        "mode": session.mode,
        # The room name is the capability that actually admits a client to the
        # media session, so it is returned only while the session is live and
        # only to an authorised participant.
        "room": session.room if session.status == CALL_ACTIVE else None,
        "dial_number": session.proxy_number if session.mode == CALL_MODE_GSM else None,
        "peer_label": peer_label,
        "peer_masked": peer_masked,
        "fallback_reason": session.fallback_reason,
        "fallback_at": session.fallback_at.isoformat() if session.fallback_at else None,
        "fallback_count": session.fallback_count,
        "expires_at": session.expires_at.isoformat() if session.expires_at else None,
        "quality_floor": {
            "min_mos": config.CALL_MIN_MOS,
            "max_packet_loss_pct": config.CALL_MAX_PACKET_LOSS_PCT,
            "degraded_seconds": config.CALL_DEGRADED_SECONDS,
        },
        "bridge": "live" if masking.voice_bridge_configured() else "simulated",
        # The VOIP leg is a real WebRTC peer connection between the two
        # browsers. These are the servers it uses to find a path through NAT;
        # the audio itself never reaches Spondon.
        "ice_servers": config.ice_servers(),
        "turn_configured": bool(config.TURN_URLS),
    }


async def _authorise(request_id: str, account: Account) -> tuple[BloodRequest, str]:
    """Only the two people this emergency connects may touch its call channel."""
    req = await BloodRequest.get(to_oid(request_id))
    if not req:
        raise HTTPException(status_code=404, detail="Blood request not found")

    me = str(account.id)
    if req.secured_donor_id == me:
        return req, "donor"
    if req.requester_id and req.requester_id == me:
        return req, "family"
    raise HTTPException(
        status_code=403,
        detail="Only the family who opened this request and the donor who accepted it "
               "can use its call channel.",
    )


async def authorise_session(session_id: str, account: Account
                           ) -> tuple[CallSession, BloodRequest, str]:
    """Same participant check as the REST routes, for the signalling socket.

    The socket carries the live audio negotiation, so it cannot be a softer
    gate than the endpoint that opened the channel: a third party who learned a
    session id must not be able to join the room and answer the offer.
    """
    session = await CallSession.get(to_oid(session_id))
    if not session:
        raise HTTPException(status_code=404, detail="Call session not found")
    if session.status != CALL_ACTIVE:
        raise HTTPException(status_code=409, detail=f"Call session is {session.status}.")
    req, role = await _authorise(session.request_id, account)
    return session, req, role


async def _peer_view(session: CallSession, req: BloodRequest, role: str) -> dict:
    """The caller's view. The peer's real number is read here and not returned."""
    peer_id = session.family_id if role == "donor" else session.donor_id
    peer = await Account.get(peer_id) if peer_id else None
    label = (
        (req.secured_donor_name or "Donor")
        if role == "family"
        else (req.requester_name or "Requesting family")
    )
    return _public_session(
        session,
        peer_label=label,
        peer_masked=masking.mask_phone(peer.phone) if peer else None,
    )


async def _live_session(request_id: str) -> Optional[CallSession]:
    session = await CallSession.find_one(
        CallSession.request_id == request_id, CallSession.status == CALL_ACTIVE
    )
    if session is None:
        return None
    expires = session.expires_at
    if expires is not None:
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=utcnow().tzinfo)
        if expires <= utcnow():
            await _tear_down(session, CALL_EXPIRED, "TTL_EXPIRED")
            return None
    return session


# ── Opening the channel ──────────────────────────────────────────────
async def open_session(req: BloodRequest) -> Optional[CallSession]:
    """Create the call channel for a freshly-locked request. Idempotent.

    Called from the accept handler, so the button is already live when the
    family's screen flips to "Donor Secured" — a family told to ring their donor
    should not then wait on a channel being provisioned.
    """
    if not req.secured_donor_id:
        return None
    existing = await CallSession.find_one(
        CallSession.request_id == str(req.id), CallSession.status == CALL_ACTIVE
    )
    if existing:
        return existing

    session = CallSession(
        request_id=str(req.id),
        donor_id=req.secured_donor_id,
        family_id=req.requester_id,
        room=masking.new_room(),
        expires_at=masking.session_expiry(),
        events=[{"at": utcnow().isoformat(), "event": "OPENED", "mode": CALL_MODE_VOIP}],
    )
    await session.insert()
    return session


@router.post("/requests/{request_id}/call", status_code=201,
             summary="Open (or re-join) the masked call channel")
async def create_call(request_id: str, account: Account = Depends(get_current_account)):
    """Unlock the temporary call channel for a locked request.

    Idempotent by design: both parties hit this on page load, and a family who
    refreshes mid-conversation must land back in the call they were already in
    rather than starting a second one against the same donor.
    """
    req, role = await _authorise(request_id, account)
    if req.status not in ("LOCKED", "FULFILLED"):
        raise HTTPException(
            status_code=409,
            detail=f"Request is {req.status} — a call channel opens once a donor accepts.",
        )

    session = await _live_session(request_id) or await open_session(req)
    if session is None:
        raise HTTPException(status_code=409, detail="This request has no secured donor.")
    return await _peer_view(session, req, role)


@router.get("/requests/{request_id}/call", summary="Current call channel")
async def get_call(request_id: str, account: Account = Depends(get_current_account)):
    req, role = await _authorise(request_id, account)
    session = await _live_session(request_id)
    if session is None:
        return {"request_id": request_id, "status": "NONE", "session_id": None}
    return await _peer_view(session, req, role)


# ── The corner case: VOIP fails, GSM takes over ──────────────────────
@router.post("/calls/{session_id}/fallback", summary="Switch a failing VOIP call to GSM")
async def call_fallback(
    session_id: str, body: CallFallbackIn, account: Account = Depends(get_current_account)
):
    """Move a degraded call onto a temporary GSM proxy number.

    Called automatically by the client after the media leg has been below the
    quality floor for `CALL_DEGRADED_SECONDS`, and manually if a user taps
    "switch to phone line". The delay matters: a single bad second is a blip,
    and yanking people onto a different transport for it would be worse than
    the stutter.

    Two properties survive the switch. The session is the same one — same id,
    same participants, same audit trail — so this is one conversation that
    changed transport, not a new call. And the masking still holds: what comes
    back is a Spondon-owned number, so the fix for a network problem does not
    quietly cost the donor their privacy.

    Already on GSM? This returns the existing number rather than renting a
    second. Both clients detect the same bad network at roughly the same moment
    and both will call this; the second must be a no-op, or the pool drains at
    two numbers per call and the pair ends up on different lines.
    """
    session = await CallSession.get(to_oid(session_id))
    if not session:
        raise HTTPException(status_code=404, detail="Call session not found")
    req, role = await _authorise(session.request_id, account)
    if session.status != CALL_ACTIVE:
        raise HTTPException(status_code=409, detail=f"Call session is {session.status}.")

    if session.mode == CALL_MODE_GSM and session.proxy_number:
        view = await _peer_view(session, req, role)
        return {**view, "message": "Already on the backup phone line.", "reused": True}

    number = await masking.claim_number(str(session.id))
    if number is None:
        # Honest failure. Telling the user to keep struggling with a VOIP leg
        # that is already failing is useless, but so is inventing a number.
        raise HTTPException(
            status_code=503,
            detail={
                "message": "All backup phone lines are currently in use. Stay on the "
                           "internet call — it may recover — or try again in a moment.",
                "pool": await masking.pool_status(),
            },
        )

    donor = await Account.get(session.donor_id)
    family = await Account.get(session.family_id) if session.family_id else None
    bridge = await masking.open_gsm_leg(
        number,
        caller=family.phone if family else None,
        callee=donor.phone if donor else None,
        session_id=str(session.id),
    )

    now = utcnow()
    session.mode = CALL_MODE_GSM
    session.proxy_number = number
    session.fallback_reason = body.reason
    session.fallback_at = now
    session.fallback_count += 1
    # Quality figures are kept; the numbers that were bridged are not.
    session.events.append({
        "at": now.isoformat(),
        "event": "FALLBACK_TO_GSM",
        "reason": body.reason,
        "mos": body.mos,
        "packet_loss_pct": body.packet_loss_pct,
        "rtt_ms": body.rtt_ms,
        "triggered_by": role,
        "bridge_simulated": bridge.get("simulated", True),
    })
    await session.save()

    log.info(
        "Call %s fell back to GSM (%s) — proxy %s lent to the pair",
        session.id, body.reason, number,
    )

    # Both screens must swap transport, including the one that did not trigger
    # it: a donor left tapping a dead VOIP button while the family waits on a
    # phone line is the same failed call, just quieter.
    view = await _peer_view(session, req, role)
    await feed.emit_room(
        trip_room(session.request_id),
        "call_mode_changed",
        {
            "request_id": session.request_id,
            "session_id": str(session.id),
            "mode": CALL_MODE_GSM,
            "dial_number": number,
            "reason": body.reason,
        },
    )
    return {
        **view,
        "reused": False,
        "bridge_result": bridge,
        "message": (
            "Internet call quality was too poor — switched to a temporary phone line. "
            "Both of you dial this number; neither sees the other's."
        ),
    }


# ── Teardown ─────────────────────────────────────────────────────────
async def _tear_down(session: CallSession, status: str, reason: str) -> None:
    """End a session and put its number back in the pool.

    Releasing the number is the point. A proxy that is never returned is a
    permanent line between two strangers and a pool that runs dry, so teardown
    happens on every path out: hang-up, arrival, and TTL expiry.
    """
    released = await masking.release_number(str(session.id))
    await masking.close_gsm_leg(session.proxy_number, str(session.id))
    session.status = status
    session.ended_at = utcnow()
    session.ended_reason = reason
    session.proxy_number = None
    session.events.append({
        "at": session.ended_at.isoformat(),
        "event": status,
        "reason": reason,
        "number_released": bool(released),
    })
    await session.save()


@router.post("/calls/{session_id}/end", summary="Hang up and release the channel")
async def end_call(
    session_id: str, body: CallEndIn, account: Account = Depends(get_current_account)
):
    session = await CallSession.get(to_oid(session_id))
    if not session:
        raise HTTPException(status_code=404, detail="Call session not found")
    await _authorise(session.request_id, account)
    if session.status != CALL_ACTIVE:
        return {"session_id": session_id, "status": session.status, "message": "Already closed."}

    await _tear_down(session, CALL_ENDED, body.reason)
    await feed.emit_room(
        trip_room(session.request_id),
        "call_ended",
        {"request_id": session.request_id, "session_id": session_id, "reason": body.reason},
    )
    return {
        "session_id": session_id,
        "status": CALL_ENDED,
        "message": "Call channel closed and the temporary number returned to the pool.",
    }


async def close_sessions_for_request(request_id: str, reason: str) -> int:
    """Close every live channel for a request — called when the trip ends.

    A channel that outlives the emergency is a standing line between two people
    who met once, so arrival and fulfilment both close it rather than leaving it
    to the TTL.
    """
    sessions = await CallSession.find(
        CallSession.request_id == request_id, CallSession.status == CALL_ACTIVE
    ).to_list()
    for session in sessions:
        await _tear_down(session, CALL_ENDED, reason)
    return len(sessions)


async def expire_stale_sessions() -> int:
    """Sweep sessions past their TTL. Run from the background watcher."""
    now = utcnow()
    expired = 0
    for session in await CallSession.find(CallSession.status == CALL_ACTIVE).to_list():
        expires = session.expires_at
        if expires is None:
            continue
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=now.tzinfo)
        if expires <= now:
            await _tear_down(session, CALL_EXPIRED, "TTL_EXPIRED")
            expired += 1
    return expired


@router.get("/calls/pool", summary="GSM proxy pool utilisation")
async def proxy_pool():
    """Free/total counts for the admin console. Never the numbers themselves —
    publishing the pool would hand anyone a list of lines to probe."""
    return await masking.pool_status()
