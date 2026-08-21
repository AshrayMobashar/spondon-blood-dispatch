import asyncio
from app.db import init_db
from app.models import RideBounty, Account

async def main():
    await init_db()
    acc = await Account.find_one()
    # Test queries
    q1 = await RideBounty.find().to_list()
    q2 = await RideBounty.find({"status": "OPEN"}).to_list()
    q3 = await RideBounty.find({"": [{"status": "OPEN"}, {"driver_id": str(acc.id)}]}).to_list()
    
    print(f"Total: {len(q1)}, Status OPEN: {len(q2)}, OR query: {len(q3)}")

if __name__ == "__main__":
    asyncio.run(main())
