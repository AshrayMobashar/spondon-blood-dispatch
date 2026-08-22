"""MongoDB connection + Beanie initialisation."""
import asyncio
import logging
import os

from beanie import init_beanie
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

from .models import (
    Account, BloodRequest, PingLog, Appeal, Admin,
    OtpChallenge, MedicalCertificate, Escalation, University, CallSession, ProxyNumber,
    CbcReport, RideBounty
)

load_dotenv()

log = logging.getLogger("spondon.db")

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "spondon")

# Mongo's default server-selection window is 30 s. On a local deployment the
# database is either there or it is not, and making every request hang for half
# a minute before failing turns "the database is down" into "the site is
# broken". Fail fast and say so.
SERVER_SELECTION_TIMEOUT_MS = int(os.getenv("MONGO_SERVER_SELECTION_TIMEOUT_MS", "4000"))

def safe_uri(uri: str | None = None) -> str:
    """`MONGODB_URI` with any password stripped out, safe to show a caller.

    The health endpoint and the 503 hint both name the URI, because on a local
    deployment "mongodb://localhost:27017" is the single most useful thing they
    can tell you. A hosted deployment puts credentials in that same string, and
    those two responses are public and unauthenticated — so the raw value must
    never leave the process. Host and database name survive, which is all the
    diagnostic value there ever was.
    """
    raw = uri if uri is not None else MONGODB_URI
    scheme, sep, rest = raw.partition("://")
    if not sep or "@" not in rest:
        return raw                      # no credentials to strip
    creds, _, host = rest.rpartition("@")
    user, has_pw, _ = creds.partition(":")
    return f"{scheme}://{user}{':***' if has_pw else ''}@{host}"


client: AsyncIOMotorClient | None = None

# Whether Beanie has been initialised against a live database.
ready = False


async def init_db() -> None:
    """Open the Motor client and register all Beanie document models."""
    global client, ready
    client = AsyncIOMotorClient(
        MONGODB_URI, serverSelectionTimeoutMS=SERVER_SELECTION_TIMEOUT_MS
    )
    # fail fast if Mongo is unreachable
    await client.admin.command("ping")
    await init_beanie(
        database=client[DB_NAME],
        document_models=[
            Account, BloodRequest, PingLog, Appeal, Admin,
            OtpChallenge, MedicalCertificate, Escalation, University, CallSession, ProxyNumber,
            CbcReport, RideBounty
        ],
    )
    ready = True


def get_collection(model):
    """Raw Motor collection for a Beanie model (used for atomic operators)."""
    return model.get_motor_collection()


#: Serialises the on-demand connect below, so a burst of requests arriving at a
#: cold instance opens one client rather than one per request.
_connect_lock: asyncio.Lock | None = None


async def ensure_connected() -> bool:
    """Connect now, awaiting the handshake, and report whether we got there.

    The background retry above is right for an always-on process: the server
    boots immediately, says the database is down, and heals itself. On a
    serverless host that same race is a bug — a cold instance answers the very
    first request while `init_db` is still resolving the Atlas SRV record, so a
    perfectly healthy deployment reports "database unavailable" on every wake.

    This is the version to await before deciding a request cannot be served.
    Bounded by `SERVER_SELECTION_TIMEOUT_MS`, so a database that really is gone
    still fails in seconds rather than hanging the request.
    """
    global _connect_lock
    if ready:
        return True
    if _connect_lock is None:
        _connect_lock = asyncio.Lock()
    async with _connect_lock:
        if ready:                       # won by whoever held the lock first
            return True
        try:
            await init_db()
        except Exception as exc:
            log.error("Database connect failed: %s", str(exc)[:200])
            return False
    return True


async def connect_with_retry(interval_seconds: int = 5) -> None:
    """Keep trying to open the database, forever, in the background.

    The API is allowed to start without Mongo so it can *say* the database is
    down — a server that refuses to boot leaves the browser reporting "cannot
    reach the backend", which sends you to debug the wrong thing. Once Mongo
    appears the app connects on its own; no restart needed.
    """
    global ready
    attempt = 0
    while not ready:
        attempt += 1
        try:
            await init_db()
            log.info("Database connected on attempt %d — API is fully operational.", attempt)
            return
        except Exception as exc:
            if attempt == 1:
                log.error(
                    "DATABASE UNAVAILABLE at %s — the API is serving, but every request "
                    "needing data will return 503 until MongoDB is reachable. Retrying "
                    "every %ds. (%s)",
                    MONGODB_URI, interval_seconds, str(exc)[:160],
                )
            await asyncio.sleep(interval_seconds)


async def ping() -> tuple[bool, str | None]:
    """Is the database actually reachable right now? (ok, error)."""
    if client is None:
        return False, "No Mongo client initialised."
    try:
        await client.admin.command("ping")
        return True, None
    except Exception as exc:
        return False, str(exc)
