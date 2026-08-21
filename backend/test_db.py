from app.db import init_db, RideBounty, CbcReport
import asyncio

async def main():
    await init_db()
    bounties = await RideBounty.find().to_list()
    print("Bounties:", [b.dict() for b in bounties])
    
    reports = await CbcReport.find().to_list()
    print("CBC Reports:", [r.dict() for r in reports])

if __name__ == '__main__':
    asyncio.run(main())
