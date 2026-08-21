import asyncio
from app.db import init_db
from app.models import BloodRequest

async def main():
    await init_db()
    reqs = await BloodRequest.find().to_list()
    for req in reqs:
        print(f"Req: {req.id}, hosp_loc: {req.hospital_location}")

if __name__ == '__main__':
    asyncio.run(main())
