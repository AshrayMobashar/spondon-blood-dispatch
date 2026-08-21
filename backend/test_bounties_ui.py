import httpx
import asyncio

API = "http://localhost:1184/api"

def get_token(phone):
    res = httpx.post(f"{API}/auth/otp/request", json={"phone": phone, "purpose": "LOGIN"})
    code = res.json()["dev_code"]
    res = httpx.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": code})
    return res.json()["access_token"]

def main():
    print("Logging in...")
    token = get_token("01711000020")
    headers = {"Authorization": f"Bearer {token}"}
    
    with httpx.Client() as client:
        # Check bounties list
        res = client.get(f"{API}/bounties", headers=headers)
        print("GET /bounties:", res.status_code)
        bounties = res.json()
        print("Bounties:", bounties)
        
        if bounties:
            b_id = bounties[0]["id"]
            print(f"Accepting bounty {b_id}...")
            res2 = client.post(f"{API}/bounties/{b_id}/accept", headers=headers)
            print("POST /accept:", res2.status_code, res2.json())
        else:
            print("No open bounties to test acceptance.")

if __name__ == '__main__':
    main()
