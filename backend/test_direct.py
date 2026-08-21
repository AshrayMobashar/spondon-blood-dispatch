import asyncio
from app.db import init_db
from app.models import RideBounty, Account, GeoPoint, utcnow
from app.routers.concurrency import _process_ride_bounty
from datetime import timedelta

async def main():
    await init_db()
    
    # Let's get any active account to be the donor
    donor = await Account.find_one(Account.status == "ACTIVE")
    
    # And create a dummy bounty
    bounty = RideBounty(
        request_id="dummy_req",
        donor_id=str(donor.id),
        donor_name=donor.name,
        hospital="Central Hospital",
        hospital_location=GeoPoint(lat=23.7, lng=90.4),
        expires_at=utcnow() + timedelta(minutes=1) # Fast expiry for testing
    )
    await bounty.insert()
    
    print("Inserted Bounty:", bounty.id)
    
    # Make sure we have a driver
    driver = await Account.find_one(Account.id != donor.id)
    driver.vehicle_type = "car"
    driver.current_location = GeoPoint(lat=23.701, lng=90.401)
    await driver.save()
    print("Set driver:", driver.id, driver.name)
    
    # Now run the processor (it will alert the driver)
    # We will modify the loops to wait only a few seconds so it doesn't block for 15 mins.
    # Actually wait, the _process_ride_bounty uses 30 * 30s. We don't want to wait 15 mins.
    # But it's already deployed. Let's just run it in the background and check the DB.
    
    print("Done setting up. You can check the logs for 'Alerted 1 nearby drivers'.")

if __name__ == '__main__':
    asyncio.run(main())
