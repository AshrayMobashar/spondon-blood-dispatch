import asyncio
from app.db import init_db
from app.models import RideBounty
from bson import ObjectId

async def main():
    await init_db()
    bounties = await RideBounty.find().to_list()
    count = 0
    for b in bounties:
        if not ObjectId.is_valid(b.donor_id):
            await b.delete()
            count += 1
    print(f"Deleted {count} mock bounties with invalid donor IDs.")

if __name__ == '__main__':
    asyncio.run(main())
