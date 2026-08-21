import httpx
import base64
import time

API = "http://localhost:1184/api"

def get_token(phone):
    res = httpx.post(f"{API}/auth/otp/request", json={"phone": phone, "purpose": "LOGIN"})
    code = res.json()["dev_code"]
    res = httpx.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": code})
    return res.json()["access_token"]

def main():
    with httpx.Client() as client:
        token = get_token("01711000001")
        headers = {"Authorization": f"Bearer {token}"}
        
        # ── Feature 1: CBC Session ──
        res = client.post(f"{API}/cbc/sessions", headers=headers)
        session_id = res.json()["id"]
        print("Created CBC Session:", session_id)
        
        dummy_png = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff\xff\x00\x05\xfe\x02\xfe\xa4\xce\x1b\xc3\x00\x00\x00\x00IEND\xaeB\x82'
        b64_image = base64.b64encode(dummy_png).decode("utf-8")
        
        print("Uploading dummy image to OpenAI (Expecting 200, INVALID_IMAGE)...")
        res = client.post(f"{API}/cbc/sessions/{session_id}/upload", headers=headers, json={
            "image": f"data:image/png;base64,{b64_image}"
        }, timeout=30.0)
        print("Upload Result:", res.status_code)
        if res.status_code == 200:
            print(res.json())
        else:
            print(res.text)
        
        # ── Feature 2: Ride Bounty ──
        me = client.get(f"{API}/auth/me", headers=headers).json()["account"]
        client.patch(f"{API}/donors/{me['id']}/vehicle", headers=headers, json={"vehicle_type": "car"})
        client.post(f"{API}/donors/{me['id']}/location", headers=headers, json={"lat": 23.7, "lng": 90.4})
        
        token2 = get_token("01711000002")
        headers2 = {"Authorization": f"Bearer {token2}"}
        
        res = client.post(f"{API}/requests", headers=headers2, json={
            "patient_name": "Test Platelets Patient",
            "hospital": "Test Hospital",
            "blood_type": "O+",
            "component": "PLATELETS",
            "units": 1,
            "severity": "CRITICAL",
            "hospital_lat": 23.701,
        })
        req_id = res.json()["id"]
        
        admin_res = client.post(f"{API}/admin/login", json={"email": "admin@spondon.com", "password": "spondon123"})
        admin_headers = {"Authorization": f"Bearer " + admin_res.json()["token"]}
        client.patch(f"{API}/admin/requests/{req_id}", headers=admin_headers, json={"status": "OPEN", "slip_status": "VERIFIED"})
        
        # User 1 accepts the request
        client.post(f"{API}/requests/{req_id}/accept", headers=headers, json={"donor_lat": 23.7, "donor_lng": 90.4})
        
        # User 1 marks arrival (FULFILLED)
        print("User 1 fulfilled the request...")
        res = client.post(f"{API}/requests/{req_id}/arrival", headers=headers, json={"donor_id": me["id"], "showed_up": True})
        
        time.sleep(2) # Give background task a moment
        
        # Check backend logs via powershell/cat next.
        
if __name__ == '__main__':
    main()
