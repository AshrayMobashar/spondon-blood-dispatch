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
        # Get Donor 1 (Driver)
        token = get_token("01711000001")
        headers = {"Authorization": f"Bearer {token}"}
        
        # Get Donor 4 (Platelet Donor)
        token4 = get_token("01711000004")
        headers4 = {"Authorization": f"Bearer {token4}"}
        me4 = client.get(f"{API}/auth/me", headers=headers4).json()["account"]
        
        res = client.post(f"{API}/requests", headers=headers4, json={
            "patient_name": "Test Platelets Patient 4",
            "hospital": "Test Hospital",
            "blood_type": me4["blood_type"],
            "component": "PLATELETS",
            "units": 1,
            "severity": "CRITICAL",
            "hospital_lat": 23.701,
            "hospital_lng": 90.401,
        })
        req_id = res.json()["id"]
        
        admin_res = client.post(f"{API}/admin/login", json={"email": "admin@spondon.com", "password": "spondon123"})
        admin_headers = {"Authorization": f"Bearer " + admin_res.json()["access_token"]}
        client.patch(f"{API}/admin/requests/{req_id}", headers=admin_headers, json={"status": "OPEN", "slip_status": "VERIFIED"})
        
        res = client.post(f"{API}/requests/{req_id}/accept", headers=headers4, json={"donor_id": me4["id"]})
        print("Donor 4 accepted request:", res.status_code)
        
        res = client.post(f"{API}/requests/{req_id}/arrival", headers=headers4, json={"donor_id": me4["id"], "showed_up": True})
        print("Arrival Result:", res.status_code)
        
if __name__ == '__main__':
    main()
