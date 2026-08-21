import re

with open("app/routers/concurrency.py", "r", encoding="utf-8") as f:
    code = f.read()

# Fix 1
code = code.replace(
'''                    await send_push(driver.fcm_token, {
                        "title": "Community Bounty: Ride Home Needed!",
                        "body": f"{bounty.donor_name} just finished a platelet donation at {bounty.hospital}. Can you offer them a ride home?",
                        "type": "RIDE_BOUNTY",
                        "bounty_id": str(bounty.id),
                    })''',
'''                    await send_push(
                        driver.fcm_token,
                        "Community Bounty: Ride Home Needed!",
                        f"{bounty.donor_name} just finished a platelet donation at {bounty.hospital}. Can you offer them a ride home?",
                        data={"type": "RIDE_BOUNTY", "bounty_id": str(bounty.id)}
                    )'''
)

# Fix 2
code = code.replace(
'''            await send_push(bounty_donor.fcm_token, {
                "title": "Thank you! Here is a ride home.",
                "body": f"No community drivers are nearby, but we've got you covered. Use code {fresh_bounty.promo_code} on {promo['partner']} for a free ride home.",
                "type": "PROMO_ISSUED"
            })''',
'''            await send_push(
                bounty_donor.fcm_token,
                "Thank you! Here is a ride home.",
                f"No community drivers are nearby, but we've got you covered. Use code {fresh_bounty.promo_code} on {promo['partner']} for a free ride home.",
                data={"type": "PROMO_ISSUED"}
            )'''
)

# Fix 3
code = code.replace(
'''        await send_push(donor.fcm_token, {
            "title": "Your ride is here!",
            "body": f"Community member {account.name} has offered you a ride home. Thank you for your donation!",
            "type": "BOUNTY_ACCEPTED"
        })''',
'''        await send_push(
            donor.fcm_token,
            "Your ride is here!",
            f"Community member {account.name} has offered you a ride home. Thank you for your donation!",
            data={"type": "BOUNTY_ACCEPTED"}
        )'''
)

with open("app/routers/concurrency.py", "w", encoding="utf-8") as f:
    f.write(code)

print("Fixed send_push calls")
