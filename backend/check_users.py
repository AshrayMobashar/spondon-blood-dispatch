import asyncio
from app.db import init_db
from app.models import Account

async def main():
    await init_db()
    users = await Account.find().sort("-created_at").limit(3).to_list()
    for u in users:
        print(u.name, u.phone, u.role)

if __name__ == '__main__':
    asyncio.run(main())
