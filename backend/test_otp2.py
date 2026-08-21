import httpx
API = "http://localhost:1184/api"
res = httpx.post(f"{API}/auth/otp/request", json={"phone": "01711000003", "purpose": "LOGIN"})
code = res.json().get("dev_code")
print("req", res.json())
res = httpx.post(f"{API}/auth/otp/verify", json={"phone": "01711000003", "code": code})
print("verify", res.json())
