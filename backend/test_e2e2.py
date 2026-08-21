import httpx
import time

API = "http://localhost:1184/api"

def get_token(phone):
    res = httpx.post(f"{API}/auth/otp/request", json={"phone": phone, "purpose": "LOGIN"})
    code = res.json()["dev_code"]
    res = httpx.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": code})
    return res.json()["access_token"]

def main():
    with httpx.Client() as client:
        # Driver 1
        token1 = get_token("01711000001")
        headers1 = {"Authorization": f"Bearer {token1}"}
        
        # Requester 8
        token8 = get_token("01711000008")
        headers8 = {"Authorization": f"Bearer {token8}"}
        
        # Platelet Donor 9
        token9 = get_token("01711000009")
        headers9 = {"Authorization": f"Bearer {token9}"}
        me9 = client.get(f"{API}/auth/me", headers=headers9).json()["account"]
        
        # Requester 8 creates request
        res = client.post(f"{API}/requests", headers=headers8, json={
            "patient_name": "Test Platelets Patient 8",
            "hospital": "Test Hospital",
            "blood_type": me9["blood_type"],
            "component": "PLATELETS",
            "units": 1,
            "severity": "CRITICAL",
            "hospital_lat": 23.701,
            "hospital_lng": 90.401,
        })
        req_id = res.json()["id"]
        
        # Admin approves
        admin_res = client.post(f"{API}/admin/login", json={"email": "admin@spondon.com", "password": "spondon123"})
        admin_headers = {"Authorization": f"Bearer " + admin_res.json()["access_token"]}
        client.patch(f"{API}/admin/requests/{req_id}", headers=admin_headers, json={"status": "OPEN", "slip_status": "VERIFIED"})
        
        # Donor 9 accepts
        res = client.post(f"{API}/requests/{req_id}/accept", headers=headers9, json={"donor_id": me9["id"]})
        print("Donor 9 accepted request:", res.status_code)
        
        # Donor 9 marks arrival
        res = client.post(f"{API}/requests/{req_id}/arrival", headers=headers9, json={"donor_id": me9["id"], "showed_up": True})
        print("Arrival Result:", res.status_code, res.json())
        
        time.sleep(2)
        
if __name__ == '__main__':
    main()
