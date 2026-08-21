import asyncio
from app.db import init_db
from app.models import RideBounty

async def main():
    await init_db()
    bounties = await RideBounty.find().to_list()
    for b in bounties:
        print("BOUNTY:", b.id, b.donor_name, b.status)

if __name__ == '__main__':
    asyncio.run(main())
