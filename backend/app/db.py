"""MongoDB connection + Beanie initialisation."""
import os

from beanie import init_beanie
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

from .models import Donor, BloodRequest, PingLog, Appeal, Admin

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "spondon")

client: AsyncIOMotorClient | None = None


async def init_db() -> None:
    """Open the Motor client and register all Beanie document models."""
    global client
    client = AsyncIOMotorClient(MONGODB_URI)
    # fail fast if Mongo is unreachable
    await client.admin.command("ping")
    await init_beanie(
        database=client[DB_NAME],
        document_models=[Donor, BloodRequest, PingLog, Appeal, Admin],
    )


def get_collection(model):
    """Raw Motor collection for a Beanie model (used for atomic operators)."""
    return model.get_motor_collection()
