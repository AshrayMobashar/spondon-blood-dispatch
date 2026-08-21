import httpx
import time

API = "http://localhost:1184/api"

def get_token(email, password):
    res = httpx.post(f"{API}/admin/login", json={"email": email, "password": password})
    return res.json()["access_token"]

def main():
    with httpx.Client() as client:
        # 1. Login as Admin
        admin_token = get_token("admin@spondon.com", "spondon123")
        admin_headers = {"Authorization": f"Bearer {admin_token}"}
        
        # 2. Login as a Donor
        res_otp = client.post(f"{API}/auth/otp/request", json={"phone": "01711000021", "purpose": "LOGIN"})
        code = res_otp.json()["dev_code"]
        res_verify = client.post(f"{API}/auth/otp/verify", json={"phone": "01711000021", "code": code})
        donor_token = res_verify.json()["access_token"]
        donor_headers = {"Authorization": f"Bearer {donor_token}"}
        donor_data = client.get(f"{API}/auth/me", headers=donor_headers).json()["account"]
        
        # 3. Create Platelets Request
        print("Creating Platelets request...")
        req_res = client.post(f"{API}/requests", headers=admin_headers, json={
            "patient_name": "E2E Test Patient",
            "hospital": "E2E Hospital",
            "blood_type": "O+",
            "component": "PLATELETS",
            "units": 1,
            "severity": "CRITICAL",
            "hospital_lat": 23.7,
            "hospital_lng": 90.4
        })
        req_id = req_res.json()["id"]
        
        # 4. Admin Approves (OPEN)
        client.patch(f"{API}/admin/requests/{req_id}", headers=admin_headers, json={"status": "OPEN", "slip_status": "VERIFIED"})
        
        # 5. Donor Accepts (LOCKED)
        print("Donor accepting request...")
        client.post(f"{API}/requests/{req_id}/accept", headers=donor_headers, json={"donor_id": donor_data["id"]})
        
        # 6. Admin Marks Arrived
        print("Admin marking as ARRIVED...")
        arr_res = client.post(f"{API}/requests/{req_id}/arrival", headers=admin_headers, json={"donor_id": donor_data["id"], "showed_up": True})
        print("Arrival response:", arr_res.status_code, arr_res.json())
        
        time.sleep(2)
        
        # 7. Check Bounties as a different donor
        res_bounties = client.get(f"{API}/bounties", headers=donor_headers)
        print("Bounties found:", len(res_bounties.json()))
        for b in res_bounties.json():
            if b["hospital"] == "E2E Hospital":
                print("SUCCESS: Found the exact Ride Bounty we just created!")

if __name__ == '__main__':
    main()
