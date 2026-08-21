"""Spondon backend — FastAPI + Beanie (async MongoDB ODM).

Run:  python -m app.main      (serves on port 1184 = last 4 digits of ID 23101184)
Docs: http://localhost:1184/docs
"""
import asyncio
import logging
from contextlib import asynccontextmanager, suppress

import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
# Raised for any document operation attempted before Beanie has been bound to a
# live database — i.e. every request while Mongo is still down at startup.
from beanie.exceptions import CollectionWasNotInitialized
from pymongo.errors import PyMongoError

from . import config, db as db_module, integrations, zones
from .dispatch import escalation_watcher
from .realtime import feed

log = logging.getLogger("spondon.main")
from .routers import auth, smart_ping, donor_health, concurrency, admin, leaderboard

PORT = config.PORT


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start even if Mongo is down, and keep trying in the background. A server
    # that exits on a missing database leaves the browser saying "cannot reach
    # the backend" — which sends you to restart an API that was never the
    # problem. Serving and answering 503 with the real reason is more useful,
    # and the app connects itself once the database comes back.
    connector = asyncio.create_task(db_module.connect_with_retry())
    # A rare-blood request nobody answers escalates on its own timer, so the
    # hand-off to blood banks and NGO hotlines never waits for a client to poll.
    watcher = asyncio.create_task(escalation_watcher())
    try:
        yield
    finally:
        for task in (watcher, connector):
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


app = FastAPI(
    title="Spondon API",
    version="2.0.0",
    description=(
        "Emergency blood-dispatch APIs — registration & OTP auth, the eligibility "
        "cooldown engine, Smart Ping, the expanding geo-ripple with its rare-blood "
        "city-wide override, concurrency locking, the Varsity Node Leaderboard, "
        "and the admin console."
    ),
    lifespan=lifespan,
)

# Endpoints that answer without touching the database, so the API can still
# describe itself (and diagnose itself) while Mongo is down.
_DB_FREE_PATHS = {"/", "/api/health", "/api/config", "/api/zones", "/docs", "/redoc",
                  "/openapi.json", "/favicon.ico"}


@app.middleware("http")
async def require_database(request: Request, call_next):
    """Refuse data requests up front while the database is disconnected.

    Catching database exceptions per-request is not enough: with Beanie
    un-initialised, a query expression like `OtpChallenge.phone == x` raises
    `AttributeError` before any Mongo call happens, which would escape as a bare
    500. Checking readiness first covers every route uniformly and answers in
    milliseconds instead of after a connection timeout.
    """
    if not db_module.ready and request.url.path not in _DB_FREE_PATHS:
        return JSONResponse(
            status_code=503,
            content={
                "detail": {
                    "message": "The database is unavailable — the API is running but "
                               "cannot reach MongoDB.",
                    "hint": f"Start MongoDB ({db_module.MONGODB_URI}); the API reconnects "
                            "on its own, no restart needed.",
                }
            },
        )
    return await call_next(request)


# Added last so it sits OUTERMOST: the 503 above must still pass back through
# CORS, or the browser blocks it and reports the API as unreachable — exactly
# the misdiagnosis this whole guard exists to prevent.
app.add_middleware(
    CORSMiddleware,
    # Credentials are sent as bearer tokens, but a wildcard origin still lets any
    # page on the internet call this API from a victim's browser.
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api", tags=["Registration & Authentication"])
app.include_router(donor_health.router, prefix="/api")
app.include_router(smart_ping.router, prefix="/api", tags=["Module 1.2 — Smart Ping"])
app.include_router(
    concurrency.router, prefix="/api", tags=["Module 2 — Dispatch, Concurrency & Slips"]
)
app.include_router(
    leaderboard.router, prefix="/api", tags=["Module 3 — Varsity Node Leaderboard"]
)
app.include_router(admin.router, prefix="/api", tags=["Admin — Role & Access Management"])


@app.exception_handler(CollectionWasNotInitialized)
@app.exception_handler(PyMongoError)
async def database_unavailable(request: Request, exc: Exception):
    """Turn a database outage into an honest 503.

    Left unhandled, this surfaces as a bare 500 from Starlette's error
    middleware, which sits *outside* CORSMiddleware — so the response carries no
    `access-control-allow-origin`, the browser blocks it, `fetch` throws, and the
    UI reports "cannot reach the backend". The API was reachable the whole time;
    only the database was down. Handling it here keeps the response inside the
    CORS layer so the real reason reaches the user.
    """
    log.error("Database error on %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=503,
        content={
            "detail": {
                "message": "The database is unavailable — the API is running but cannot "
                           "reach MongoDB.",
                "hint": f"Check that MongoDB is running on {db_module.MONGODB_URI}.",
                "error": str(exc)[:300],
            }
        },
    )


@app.get("/", tags=["meta"])
async def root():
    return {"service": "Spondon API", "port": PORT, "docs": "/docs"}


@app.get("/api/health", tags=["meta"], summary="Liveness + database connectivity")
async def health():
    """Separates "the API is down" from "the database is down" — the two
    failures look identical from the browser otherwise."""
    ok, error = await db_module.ping()
    return JSONResponse(
        status_code=200 if ok else 503,
        content={
            "api": "ok",
            "database": "ok" if ok else "unreachable",
            "database_uri": db_module.MONGODB_URI,
            "error": error,
        },
    )


@app.websocket("/ws/dispatch")
async def dispatch_socket(websocket: WebSocket, request_id: str | None = None):
    """Live dispatch feed behind the City-Wide Radar.

    Connect to `/ws/dispatch?request_id=<id>` to watch one emergency, or omit
    the parameter for the city-wide feed. Events: `broadcast_started`,
    `donor_pinged`, `broadcast_complete`, `donor_secured`, `escalated`.

    Payloads carry a **zone name and counts, never an identity or a coordinate**
    — see `app.zones`. The socket is read-only; nothing a client sends here can
    change dispatch state.
    """
    room = await feed.join(websocket, request_id)
    try:
        await websocket.send_json({
            "event": "connected",
            "watching": request_id or "city-wide",
            "zones": zones.public_zones(),
            "escalation_seconds": config.RARE_ESCALATION_SECONDS,
        })
        while True:
            # No client-driven commands: this just parks until the tab closes.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        log.debug("Radar socket closed unexpectedly", exc_info=True)
    finally:
        await feed.leave(websocket, room)


@app.get("/api/zones", tags=["meta"], summary="Published city zones for the radar")
async def city_zones():
    """The only geography the radar draws. Donor positions are generalised to
    these before anything is broadcast."""
    return {"zones": zones.public_zones()}


@app.get("/api/config", tags=["meta"], summary="Rule constants + integration status")
async def public_config():
    """The thresholds the engine actually enforces.

    The frontend renders these rather than hard-coding its own copies, so a
    screen can never advertise a cooldown or escalation window that differs from
    the one in force.
    """
    return {**config.public_config(), "integrations": integrations.integration_status()}


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=PORT, reload=False)
