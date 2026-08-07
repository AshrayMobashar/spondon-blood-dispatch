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


feed = DispatchFeed()
