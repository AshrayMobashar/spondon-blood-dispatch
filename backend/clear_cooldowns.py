import asyncio
from app.db import init_db
from app.models import Account
from app.eligibility import recalculate

async def main():
    await init_db()
    donors = await Account.find(Account.role == "donor").to_list()
    count = 0
    for donor in donors:
        # Reset health restrictions so they are eligible to donate
        donor.health.last_donation_date = None
        donor.health.weight_kg = max(donor.health.weight_kg or 0, 70.0) # Ensure they meet minimum weight
        donor.eligibility.eligible = True
        donor.eligibility.cooldown_waived_by = "Admin"
        
        # Recalculate just in case
        from app.models import utcnow
        recalculate(donor, now=utcnow())
        
        await donor.save()
        count += 1
    
    print(f"Cleared cooldowns and set weight to 70kg for {count} donors!")

if __name__ == '__main__':
    asyncio.run(main())
