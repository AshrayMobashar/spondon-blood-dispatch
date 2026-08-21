import httpx

API = "http://localhost:1184/api"

def get_token(email, password):
    res = httpx.post(f"{API}/admin/login", json={"email": email, "password": password})
    return res.json()["access_token"]

def main():
    with httpx.Client() as client:
        admin_token = get_token("admin@spondon.com", "spondon123")
        admin_headers = {"Authorization": f"Bearer {admin_token}"}
        
        res_otp = client.post(f"{API}/auth/otp/request", json={"phone": "01711000021", "purpose": "LOGIN"})
        code = res_otp.json()["dev_code"]
        res_verify = client.post(f"{API}/auth/otp/verify", json={"phone": "01711000021", "code": code})
        donor_token = res_verify.json()["access_token"]
        donor_headers = {"Authorization": f"Bearer {donor_token}"}
        donor_data = client.get(f"{API}/auth/me", headers=donor_headers).json()["account"]
        
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
        
        client.patch(f"{API}/admin/requests/{req_id}", headers=admin_headers, json={"status": "OPEN", "slip_status": "VERIFIED"})
        
        res_accept = client.post(f"{API}/requests/{req_id}/accept", headers=donor_headers, json={"donor_id": donor_data["id"]})
        print("Accept status:", res_accept.status_code, res_accept.json())

if __name__ == '__main__':
    main()
