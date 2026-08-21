"""Realtime dispatch feed — the WebSocket behind the City-Wide Radar.

The radar cannot be built on polling: the point of the rare-blood override is
that every donor in the city is reached *at once*, and a screen that refreshes
every few seconds cannot show that. The dispatch engine emits an event per donor
reached, and the family's map lights up as it happens.

Two rules hold everywhere in this module:

  * **Never emit identity or exact position.** Payloads carry a zone name and
    counts. See `app.zones` for why.
  * **Never let a dead socket break a dispatch.** Delivering blood matters;
    a browser tab that closed mid-broadcast does not. Every send is best-effort.

Subscribers join either the feed for one request (`request_id=…`) or the
city-wide feed, which sees everything.
"""
import asyncio
import logging
from typing import Optional

from fastapi import WebSocket

log = logging.getLogger("spondon.realtime")

CITY_FEED = "__city__"


class DispatchFeed:
    """Fan-out hub: sockets grouped by the request they are watching."""

    def __init__(self) -> None:
        self._rooms: dict[str, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def join(self, ws: WebSocket, request_id: Optional[str]) -> str:
        room = request_id or CITY_FEED
        await ws.accept()
        async with self._lock:
            self._rooms.setdefault(room, set()).add(ws)
        log.info("Radar client joined %s (%d watching)", room, len(self._rooms[room]))
        return room

    async def leave(self, ws: WebSocket, room: str) -> None:
        async with self._lock:
            watchers = self._rooms.get(room)
            if watchers:
                watchers.discard(ws)
                if not watchers:
                    self._rooms.pop(room, None)

    async def emit(self, event: str, payload: dict, *, request_id: Optional[str] = None) -> int:
        """Send one event to a request's watchers and the city-wide feed.

        Returns how many sockets received it. Failures are dropped silently —
        a closed tab must never surface as a dispatch error.
        """
        message = {"event": event, **payload}
        rooms = [CITY_FEED] + ([request_id] if request_id else [])
        targets: list[WebSocket] = []
        async with self._lock:
            for room in rooms:
                targets.extend(self._rooms.get(room, ()))

        sent, dead = 0, []
        for ws in targets:
            try:
                await ws.send_json(message)
                sent += 1
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                for room in rooms:
                    watchers = self._rooms.get(room)
                    if watchers:
                        watchers.difference_update(dead)
        return sent

    def watcher_count(self, request_id: Optional[str] = None) -> int:
        room = request_id or CITY_FEED
        return len(self._rooms.get(room, ()))

    # ── Private rooms (Live En-Route Tracker) ────────────────────────
    #
    # The radar's rule — zone names and counts, never a coordinate — is right
    # for a public feed and wrong for the one screen that legitimately needs
    # exact position: the family watching the donor who is bringing *their*
    # blood. That is a different audience, so it gets a different pipe rather
    # than a relaxation of the existing one.
    #
    # A private room is never joined by request id alone. `/ws/trip` verifies a
    # bearer token and that the account is either the requester or the secured
    # donor before calling `join_room`, and `emit_room` never copies to the city
    # feed. The two channels cannot leak into each other by accident, because
    # nothing in `emit` knows these rooms exist.

    async def join_room(self, ws: WebSocket, room: str) -> str:
        """Join an explicitly-named room. The caller has already authorised it."""
        await ws.accept()
        async with self._lock:
            self._rooms.setdefault(room, set()).add(ws)
        log.info("Private client joined %s (%d watching)", room, len(self._rooms[room]))
        return room

    async def emit_room(self, room: str, event: str, payload: dict) -> int:
        """Send to exactly one room — no city-feed copy, ever."""
        message = {"event": event, **payload}
        async with self._lock:
            targets = list(self._rooms.get(room, ()))

        sent, dead = 0, []
        for ws in targets:
            try:
                await ws.send_json(message)
                sent += 1
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                watchers = self._rooms.get(room)
                if watchers:
                    watchers.difference_update(dead)
                    if not watchers:
                        self._rooms.pop(room, None)
        return sent


    def watcher_count_room(self, room: str) -> int:
        """Members of an explicitly-named room (unlike `watcher_count`, which
        treats its argument as a request id and falls back to the city feed)."""
        return len(self._rooms.get(room, ()))

    async def relay(self, room: str, sender: WebSocket, message: dict) -> int:
        """Forward one client's message to the *other* members of a room.

        This is the whole of the signalling server behind Direct-Connect calling.
        SDP offers/answers and ICE candidates are opaque here on purpose: the
        server copies them between two authorised sockets and reads nothing, so
        the audio path is negotiated by the two browsers and never routed
        through this process. Echoing back to the sender would have a caller
        answer their own offer, so the sender is excluded.
        """
        async with self._lock:
            targets = [ws for ws in self._rooms.get(room, ()) if ws is not sender]

        sent, dead = 0, []
        for ws in targets:
            try:
                await ws.send_json(message)
                sent += 1
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                watchers = self._rooms.get(room)
                if watchers:
                    watchers.difference_update(dead)
                    if not watchers:
                        self._rooms.pop(room, None)
        return sent


def trip_room(request_id: str) -> str:
    """Room name for one request's private tracker feed."""
    return f"trip:{request_id}"


def call_room(session_id: str) -> str:
    """Signalling room for one call session — exactly two members, ever."""
    return f"call:{session_id}"


feed = DispatchFeed()
