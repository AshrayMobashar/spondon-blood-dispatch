"""Keeping the timed sweeps honest on a serverless host.

On a normal always-on process the four sweeps in this app run from `while True`
watchers started in `main.lifespan`. On Vercel there is no such process: a
function instance is created for a request and suspended once it goes idle, so
a watcher's `await asyncio.sleep(20)` may simply never come back.

What saves this is that no deadline in this codebase lives in an in-process
timer. `expires_at` on a bounty, `escalation_due` on a rare request and the
last-ping timestamp on a trip are all *facts in the database*, checked against
the clock at sweep time. So the sweep does not have to happen on schedule to
produce the right answer — it has to happen. Running it off the next incoming
request makes it late, not wrong: a bounty whose window lapsed while the
instance was asleep gets its promo code the moment anyone touches the API.

Late is a real degradation and it is worth naming: with nobody using the app,
nothing sweeps at all. A donor who is owed a ride code at 14:03 gets it when
the next request arrives, which in a quiet hour could be much later. On the
always-on deployment described in DEPLOYMENT.md this module does nothing.

Only active when the platform sets `VERCEL`, so local runs, Docker Compose and
any always-on host keep exactly the behaviour they had before.
"""
import asyncio
import logging
import os
import time

from . import config, db as db_module

log = logging.getLogger("spondon.serverless")

#: True on Vercel's build and runtime containers, unset everywhere else.
ON_SERVERLESS = bool(os.getenv("VERCEL"))

#: Monotonic timestamp of the last completed run, per sweep name. Per-instance
#: by nature — a second warm instance keeps its own. That only costs a
#: duplicated sweep, never a wrong one: every sweep is a conditional write
#: against a deadline, so a second pass over the same document finds nothing
#: left to do.
_last_run: dict[str, float] = {}

#: Set while a sweep is in flight, so a burst of requests fans into one pass.
_running: set[str] = set()


async def _run(name: str, interval: float, fn) -> None:
    """Run `fn` if `interval` seconds have passed since it last completed."""
    now = time.monotonic()
    if now - _last_run.get(name, 0.0) < interval or name in _running:
        return
    _running.add(name)
    try:
        await fn()
    except Exception:
        # A sweep failing must never surface on the request that happened to
        # trigger it — the caller asked for something else entirely.
        log.debug("Request-triggered %s sweep failed", name, exc_info=True)
    finally:
        _running.discard(name)
        _last_run[name] = time.monotonic()


async def sweep_due() -> None:
    """Run whichever of the four sweeps is due, honouring its normal interval."""
    if not db_module.ready:
        return
    # Imported here, not at module scope: main.py imports this module while the
    # routers are still being assembled, and dispatch/bounty import back into
    # that same package.
    from .bounty import sweep_bounties
    from .dispatch import sweep_escalations
    from .routers import calling, tracking

    await asyncio.gather(
        _run("escalation", config.ESCALATION_SWEEP_SECONDS, sweep_escalations),
        _run("trip", config.TRIP_SWEEP_SECONDS, tracking.mark_lost_signals),
        _run("calls", config.TRIP_SWEEP_SECONDS, calling.expire_stale_sessions),
        _run("bounty", config.BOUNTY_SWEEP_SECONDS, sweep_bounties),
    )


def nudge() -> None:
    """Fire the due sweeps in the background. Never blocks the caller.

    Deliberately not awaited by the request that triggers it. A family loading
    the tracker should not wait on a bounty sweep to get their page.
    """
    if not ON_SERVERLESS:
        return
    task = asyncio.create_task(sweep_due())
    # Hold a reference or the loop may garbage-collect the task mid-flight.
    _pending.add(task)
    task.add_done_callback(_pending.discard)


_pending: set[asyncio.Task] = set()
