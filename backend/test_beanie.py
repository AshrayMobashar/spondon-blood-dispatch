import asyncio
from app.db import init_db
from app.models import RideBounty, Account

async def main():
    await init_db()
    acc = await Account.find_one()
    bounties = await RideBounty.find({"": [{"status": "OPEN"}, {"driver_id": str(acc.id)}]}).to_list()
    print("Fetched bounties:", len(bounties))

if __name__ == "__main__":
    asyncio.run(main())
