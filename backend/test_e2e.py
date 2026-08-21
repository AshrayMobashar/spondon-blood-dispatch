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
        
        # Requester 5
        token5 = get_token("01711000005")
        headers5 = {"Authorization": f"Bearer {token5}"}
        
        # Platelet Donor 7
        token7 = get_token("01711000007")
        headers7 = {"Authorization": f"Bearer {token7}"}
        me7 = client.get(f"{API}/auth/me", headers=headers7).json()["account"]
        
        # Requester 5 creates request
        res = client.post(f"{API}/requests", headers=headers5, json={
            "patient_name": "Test Platelets Patient 5",
            "hospital": "Test Hospital",
            "blood_type": me7["blood_type"],
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
        
        # Donor 7 accepts
        res = client.post(f"{API}/requests/{req_id}/accept", headers=headers7, json={"donor_id": me7["id"]})
        print("Donor 7 accepted request:", res.status_code)
        
        # Donor 7 marks arrival
        res = client.post(f"{API}/requests/{req_id}/arrival", headers=headers7, json={"donor_id": me7["id"], "showed_up": True})
        print("Arrival Result:", res.status_code, res.json())
        
        time.sleep(2)
        
if __name__ == '__main__':
    main()
