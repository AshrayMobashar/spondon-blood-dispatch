import asyncio
from app.db import init_db
from app.models import RideBounty, utcnow, GeoPoint
from datetime import timedelta

async def main():
    await init_db()
    b = RideBounty(
        request_id="dummy-request",
        donor_id="dummy-donor",
        donor_name="Hasnat Abdullah",
        hospital="Square Hospital",
        hospital_location=GeoPoint(type="Point", coordinates=[90.3813, 23.7530], lat=23.7530, lng=90.3813),
        expires_at=utcnow() + timedelta(minutes=10)
    )
    await b.save()
    print("Created mock bounty")

if __name__ == "__main__":
    asyncio.run(main())
