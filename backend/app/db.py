"""MongoDB connection + Beanie initialisation."""
import asyncio
import logging
import os

from beanie import init_beanie
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

from .models import (
    Account, BloodRequest, PingLog, Appeal, Admin,
    OtpChallenge, MedicalCertificate, Escalation, CallSession, ProxyNumber,
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
            OtpChallenge, MedicalCertificate, Escalation, CallSession, ProxyNumber,
        ],
    )
    ready = True


def get_collection(model):
    """Raw Motor collection for a Beanie model (used for atomic operators)."""
    return model.get_motor_collection()


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
