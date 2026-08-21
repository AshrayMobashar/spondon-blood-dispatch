import httpx
API = "http://localhost:1184/api"
res = httpx.post(f"{API}/auth/otp/request", json={"phone": "01711000001", "purpose": "LOGIN"})
print("req", res.json())
res = httpx.post(f"{API}/auth/otp/verify", json={"phone": "01711000001", "code": "000000"})
print("verify", res.json())
